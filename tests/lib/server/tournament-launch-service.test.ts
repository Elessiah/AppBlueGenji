import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/bot-logs");

import { launchTournamentNow } from "@/lib/server/tournaments/launch";
import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { computeTournamentState } from "@/lib/shared/tournament-state";

type ExecuteMock = jest.Mock;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Ligne d'un tournoi aux inscriptions, coup d'envoi dans deux jours. */
function registrationRow(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 7,
    name: "BlueGenji Open",
    state: "REGISTRATION",
    start_visibility_at: new Date(now - 3 * DAY),
    registration_open_at: new Date(now - DAY),
    registration_close_at: new Date(now + DAY),
    start_at: new Date(now + 2 * DAY),
    ...overrides,
  };
}

/**
 * Connexion dont le `SELECT … FOR UPDATE` rend `row`, et le `COUNT(*)` des
 * inscriptions rend `entrants`.
 */
function mockTournament(row: Record<string, unknown>, entrants = 8) {
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

  (getDatabase as jest.Mock).mockResolvedValue({
    execute: jest.fn(),
    getConnection: jest.fn(async () => connection),
  } as never);

  return { execute, connection };
}

/** Les paramètres du seul `UPDATE bg_tournaments` émis, sous forme de dates. */
function writtenMilestones(execute: ExecuteMock): Date[] {
  const call = execute.mock.calls.find((c) => /UPDATE bg_tournaments/.test(String((c as [string])[0])));
  if (!call) throw new Error("aucun UPDATE bg_tournaments émis");
  return (call as [string, unknown[]])[1].slice(0, 4) as Date[];
}

describe("launchTournamentNow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // La synchronisation rend la ligne telle qu'elle est après lancement.
    (syncTournamentState as jest.Mock).mockResolvedValue({
      row: { state: "RUNNING" },
      stateChanged: true,
    } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("abrège les jalons puis délègue le coup d'envoi à la synchronisation", async () => {
    const { execute, connection } = mockTournament(registrationRow(), 12);

    const launched = await launchTournamentNow(7);

    expect(launched).toEqual({
      id: 7,
      name: "BlueGenji Open",
      state: "RUNNING",
      entrantCount: 12,
    });
    // Le module n'écrit jamais `state` : ce sont les dates qui font foi, et
    // c'est `syncTournamentState` qui en tire le lancement.
    expect(String(execute.mock.calls.find((c) => /UPDATE bg_tournaments/.test(String((c as [string])[0])))?.[0])).not.toMatch(
      /state\s*=/,
    );
    expect(syncTournamentState).toHaveBeenCalledWith(connection, 7);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("écrit des jalons qui font « en cours » dès l'instant du lancement", async () => {
    const { execute } = mockTournament(registrationRow());

    await launchTournamentNow(7);

    const [startVisibilityAt, registrationOpenAt, registrationCloseAt, startAt] =
      writtenMilestones(execute);

    expect(
      computeTournamentState(
        {
          state: "REGISTRATION",
          registrationOpenAt,
          registrationCloseAt,
          startAt,
        },
        Date.now(),
      ),
    ).toBe("RUNNING");
    expect(startVisibilityAt.getTime()).toBeLessThanOrEqual(registrationOpenAt.getTime());
  });

  it("verrouille la ligne pour sérialiser deux lancements concurrents", async () => {
    const { execute } = mockTournament(registrationRow());

    await launchTournamentNow(7);

    const select = execute.mock.calls
      .map((c) => String((c as [string])[0]))
      .find((sql) => /FROM bg_tournaments/.test(sql));
    expect(select).toMatch(/FOR UPDATE/);
  });

  it("purge le journal Discord seulement après le commit", async () => {
    const { connection } = mockTournament(registrationRow());

    await launchTournamentNow(7);

    // La synchronisation a pu réserver une ligne (départ, ou clôture faute
    // d'adversaires) : elle ne part qu'une fois la transaction acquise.
    expect(flushBotLogs).toHaveBeenCalledWith(connection);
    expect(discardBotLogs).toHaveBeenCalledWith(connection);
  });

  it("remonte l'état réel quand le plateau se clôt faute d'adversaires", async () => {
    mockTournament(registrationRow(), 1);
    (syncTournamentState as jest.Mock).mockResolvedValue({
      row: { state: "FINISHED" },
      stateChanged: true,
    } as never);

    await expect(launchTournamentNow(7)).resolves.toMatchObject({
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

    await expect(launchTournamentNow(7)).rejects.toThrow("TOURNAMENT_ALREADY_STARTED");

    expect(execute.mock.calls.some((c) => /UPDATE bg_tournaments/.test(String((c as [string])[0])))).toBe(
      false,
    );
    expect(syncTournamentState).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse un tournoi terminé", async () => {
    mockTournament(registrationRow({ state: "FINISHED" }));

    await expect(launchTournamentNow(7)).rejects.toThrow("TOURNAMENT_ALREADY_FINISHED");
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
    (getDatabase as jest.Mock).mockResolvedValue({
      execute: jest.fn(),
      getConnection: jest.fn(async () => connection),
    } as never);

    await expect(launchTournamentNow(7)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("annule les dates abrégées si l'initialisation du format échoue", async () => {
    const { connection } = mockTournament(registrationRow());
    (syncTournamentState as jest.Mock).mockRejectedValue(new Error("ER_LOCK_DEADLOCK") as never);

    await expect(launchTournamentNow(7)).rejects.toThrow("ER_LOCK_DEADLOCK");

    // Sans ce rollback, le tournoi resterait marqué « en cours » sans plateau
    // ni classement — le pire des deux mondes.
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(flushBotLogs).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});
