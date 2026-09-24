import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/bot-logs");

import { advanceTournamentNow } from "@/lib/server/tournaments/advance";
import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { computeTournamentState } from "@/lib/shared/tournament-state";
import { type SqlMock, fakePool } from "../../helpers/sql-double";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import type { RowOverrides } from "../../helpers/row-overrides";
import { tournamentRow } from "../../helpers/tournament-rows";

type ExecuteMock = SqlMock;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Ligne d'un tournoi aux inscriptions **closes**, coup d'envoi dans un jour :
 * l'étape suivante est le lancement.
 */
function registrationRow(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  const now = Date.now();
  return tournamentRow({
    id: 7,
    name: "BlueGenji Open",
    state: "UPCOMING",
    start_visibility_at: new Date(now - 3 * DAY),
    registration_open_at: new Date(now - 2 * DAY),
    registration_close_at: new Date(now - HOUR),
    start_at: new Date(now + DAY),
    ...overrides,
  });
}

/**
 * Connexion dont le `SELECT … FOR UPDATE` rend `row`, et le `COUNT(*)` des
 * inscriptions rend `entrants`.
 */
function mockTournament(row: TournamentRow, entrants = 8) {
  const execute = jest.fn(async (sql: string) => {
    if (/FROM bg_tournaments/.test(sql)) return [[row]];
    if (/FROM bg_tournament_registrations/.test(sql)) return [[{ c: entrants }]];
    return [{ affectedRows: 1 }];
  }) as unknown as ExecuteMock;

  const connection = {
    execute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };

  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute: jest.fn(),
    getConnection: jest.fn(async () => connection),
  }));

  return { execute, connection };
}

/** Les paramètres du seul `UPDATE bg_tournaments` émis, sous forme de dates. */
function writtenMilestones(execute: ExecuteMock): Date[] {
  const call = execute.mock.calls.find((c) => /UPDATE bg_tournaments/.test(String((c as [string])[0])));
  if (!call) throw new Error("aucun UPDATE bg_tournaments émis");
  return (call as [string, unknown[]])[1].slice(0, 4) as Date[];
}

describe("advanceTournamentNow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // La synchronisation rend la ligne telle qu'elle est après lancement.
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: registrationRow({ state: "RUNNING" }),
      stateChanged: true,
      contentChanged: false,
      launchesChanged: false,
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("abrège les jalons puis délègue le coup d'envoi à la synchronisation", async () => {
    const { execute, connection } = mockTournament(registrationRow(), 12);

    const launched = await advanceTournamentNow(7);

    expect(launched).toEqual({
      id: 7,
      name: "BlueGenji Open",
      target: "RUNNING",
      state: "RUNNING",
      entrantCount: 12,
    });
    // Le module n'écrit jamais `state` : ce sont les dates qui font foi, et
    // c'est `syncTournamentState` qui en tire le lancement.
    expect(String(execute.mock.calls.find((c) => /UPDATE bg_tournaments/.test(String((c as [string])[0])))?.[0])).not.toMatch(
      /state\s*=/,
    );
    expect(syncTournamentState).toHaveBeenCalledWith(connection as never, 7);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("écrit des jalons qui font « en cours » dès l'instant du lancement", async () => {
    const { execute } = mockTournament(registrationRow());

    await advanceTournamentNow(7);

    const [startVisibilityAt, registrationOpenAt, registrationCloseAt, startAt] =
      writtenMilestones(execute);

    expect(
      computeTournamentState(
        {
          state: "UPCOMING",
          registrationOpenAt,
          registrationCloseAt,
          startAt,
        },
        Date.now(),
      ),
    ).toBe("RUNNING");
    expect(startVisibilityAt.getTime()).toBeLessThanOrEqual(registrationOpenAt.getTime());
  });

  it("depuis les inscriptions, les clôt sans lancer le tournoi", async () => {
    const now = Date.now();
    const start = new Date(now + 2 * DAY);
    const { execute } = mockTournament(
      registrationRow({
        state: "REGISTRATION",
        registration_open_at: new Date(now - DAY),
        registration_close_at: new Date(now + DAY),
        start_at: start,
      }),
    );
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: registrationRow({ state: "UPCOMING" }),
      stateChanged: true,
      contentChanged: false,
      launchesChanged: false,
    });

    await expect(advanceTournamentNow(7)).resolves.toMatchObject({
      target: "LOCKED",
      state: "UPCOMING",
    });

    const [, registrationOpenAt, registrationCloseAt, startAt] = writtenMilestones(execute);
    expect(registrationCloseAt.getTime()).toBeLessThan(Date.now());
    // Le coup d'envoi n'a pas bougé : clore n'est pas lancer.
    expect(startAt.getTime()).toBe(start.getTime());
    expect(
      computeTournamentState(
        { state: "REGISTRATION", registrationOpenAt, registrationCloseAt, startAt },
        Date.now(),
      ),
    ).toBe("UPCOMING");
  });

  it("depuis l'étape « masqué », ouvre les inscriptions en publiant le tournoi", async () => {
    const now = Date.now();
    const { execute } = mockTournament(
      registrationRow({
        state: "UPCOMING",
        start_visibility_at: new Date(now + DAY),
        registration_open_at: new Date(now + 2 * DAY),
        registration_close_at: new Date(now + 3 * DAY),
        start_at: new Date(now + 4 * DAY),
      }),
    );
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: registrationRow({ state: "REGISTRATION" }),
      stateChanged: true,
      contentChanged: false,
      launchesChanged: false,
    });

    await expect(advanceTournamentNow(7)).resolves.toMatchObject({
      target: "REGISTRATION",
      state: "REGISTRATION",
    });

    const [startVisibilityAt, registrationOpenAt, registrationCloseAt, startAt] =
      writtenMilestones(execute);
    expect(startVisibilityAt.getTime()).toBeLessThanOrEqual(registrationOpenAt.getTime());
    expect(registrationOpenAt.getTime()).toBeLessThan(Date.now());
    expect(registrationCloseAt.getTime()).toBeGreaterThan(Date.now());
    expect(startAt.getTime()).toBeGreaterThan(registrationCloseAt.getTime());
  });

  it("verrouille la ligne pour sérialiser deux lancements concurrents", async () => {
    const { execute } = mockTournament(registrationRow());

    await advanceTournamentNow(7);

    const select = execute.mock.calls
      .map((c) => String((c as [string])[0]))
      .find((sql) => /FROM bg_tournaments/.test(sql));
    expect(select).toMatch(/FOR UPDATE/);
  });

  it("purge le journal Discord seulement après le commit", async () => {
    const { connection } = mockTournament(registrationRow());

    await advanceTournamentNow(7);

    // La synchronisation a pu réserver une ligne (départ, ou clôture faute
    // d'adversaires) : elle ne part qu'une fois la transaction acquise.
    expect(flushBotLogs).toHaveBeenCalledWith(connection as never);
    expect(discardBotLogs).toHaveBeenCalledWith(connection as never);
  });

  it("remonte l'état réel quand le plateau se clôt faute d'adversaires", async () => {
    mockTournament(registrationRow(), 1);
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: registrationRow({ state: "FINISHED" }),
      stateChanged: true,
      contentChanged: false,
      launchesChanged: false,
    });

    await expect(advanceTournamentNow(7)).resolves.toMatchObject({
      state: "FINISHED",
      entrantCount: 1,
    });
  });

  it("refuse un tournoi déjà lancé, sans rien écrire", async () => {
    const now = Date.now();
    const { execute, connection } = mockTournament(
      registrationRow({
        registration_close_at: new Date(now - DAY),
        start_at: new Date(now - HOUR),
      }),
    );

    await expect(advanceTournamentNow(7)).rejects.toThrow("TOURNAMENT_ALREADY_STARTED");

    expect(execute.mock.calls.some((c) => /UPDATE bg_tournaments/.test(String((c as [string])[0])))).toBe(
      false,
    );
    expect(syncTournamentState).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse un tournoi terminé", async () => {
    mockTournament(registrationRow({ state: "FINISHED" }));

    await expect(advanceTournamentNow(7)).rejects.toThrow("TOURNAMENT_ALREADY_FINISHED");
  });

  it("refuse un identifiant inconnu", async () => {
    const execute = jest.fn(async () => [[]]) as unknown as ExecuteMock;
    const connection = {
      execute,
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    jest.mocked(getDatabase).mockResolvedValue(fakePool({
      execute: jest.fn(),
      getConnection: jest.fn(async () => connection),
    }));

    await expect(advanceTournamentNow(7)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("annule les dates abrégées si l'initialisation du format échoue", async () => {
    const { connection } = mockTournament(registrationRow());
    jest.mocked(syncTournamentState).mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));

    await expect(advanceTournamentNow(7)).rejects.toThrow("ER_LOCK_DEADLOCK");

    // Sans ce rollback, le tournoi resterait marqué « en cours » sans plateau
    // ni classement — le pire des deux mondes.
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(flushBotLogs).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});
