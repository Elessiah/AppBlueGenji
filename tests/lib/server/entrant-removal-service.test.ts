import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/bot-logs");

import { removeTournamentEntrant } from "@/lib/server/tournaments/registration-removal";
import { getDatabase } from "@/lib/server/database";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { syncTournamentState } from "@/lib/server/tournaments/state";

/**
 * `removeTournamentEntrant` — ce que la transaction doit garantir.
 *
 * Quatre invariants, dont deux qu'aucune relecture ne rattrape :
 *
 * 1. **le verrou est la première instruction** — sous `REPEATABLE READ`, une
 *    lecture ordinaire placée avant lui figerait l'instantané *avant* l'attente,
 *    et la fenêtre se déciderait sur un monde périmé ;
 * 2. **l'entretien précède la règle** — sans lui, un tournoi dont l'heure de
 *    début est passée reste `REGISTRATION` en base, et le retrait passerait
 *    après le coup d'envoi au seul motif que personne n'avait ouvert sa page ;
 * 3. **rien d'autre que la ligne d'inscription n'est effacé** — ni équipe, ni
 *    match, ni classement ;
 * 4. **les rangs se referment**, et le journal ne part qu'après le commit.
 */

type ExecuteMock = jest.Mock;

const HOUR = 3_600_000;

/** Ligne d'un tournoi aux inscriptions, coup d'envoi dans deux heures. */
function registrationRow(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 7,
    name: "BlueGenji Open",
    state: "REGISTRATION",
    max_teams: 16,
    participant_type: "TEAM",
    finished_at: null,
    registration_open_at: new Date(now - 48 * HOUR),
    registration_close_at: new Date(now + HOUR),
    start_at: new Date(now + 2 * HOUR),
    ...overrides,
  };
}

/**
 * Connexion factice.
 *
 * `remaining` est l'ordre des inscrites **après** effacement : c'est ce que la
 * renumérotation relit, et ce que le comptage final doit rendre.
 */
function mockConnection(
  row: Record<string, unknown> | null,
  options: { entrantName?: string | null; remaining?: number[] } = {},
) {
  const { entrantName = "Team Nova", remaining = [101, 103, 104] } = options;
  const sqls: string[] = [];

  const execute = jest.fn(async (sql: string) => {
    sqls.push(sql.replace(/\s+/g, " ").trim());

    if (/FOR UPDATE/.test(sql)) return [[{ id: 7 }]];
    // `loadEntries` de `./seeding`, relu par `resequenceSeeds`. Testé **avant**
    // la lecture du nom : les deux joignent `bg_teams`, seul l'ordre les
    // distingue.
    if (/ORDER BY COALESCE/.test(sql)) {
      return [
        remaining.map((teamId, index) => ({
          team_id: teamId,
          team_name: `Team ${teamId}`,
          seed: index + 4,
          registered_at: new Date(),
        })),
      ];
    }
    if (/JOIN bg_teams/.test(sql)) {
      return [entrantName === null ? [] : [{ team_name: entrantName }]];
    }
    if (/COUNT\(\*\)/.test(sql)) return [[{ c: remaining.length }]];
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

  (syncTournamentState as jest.Mock).mockResolvedValue({
    row,
    stateChanged: false,
    contentChanged: false,
  } as never);

  return { execute, connection, sqls };
}

describe("removeTournamentEntrant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("verrouille la ligne du tournoi avant toute lecture", () => {
    const { sqls } = mockConnection(registrationRow());

    return removeTournamentEntrant(7, 102).then(() => {
      // Pas « le verrou figure quelque part » : **le premier**. Une lecture
      // ordinaire glissée avant lui figerait l'instantané `REPEATABLE READ` de
      // la transaction, et le verrou n'aurait plus rien à protéger.
      expect(sqls[0]).toMatch(/SELECT id FROM bg_tournaments WHERE id = \? FOR UPDATE/);
    });
  });

  it("synchronise l'état avant d'appliquer la règle", async () => {
    mockConnection(registrationRow());

    await removeTournamentEntrant(7, 102);

    expect(syncTournamentState).toHaveBeenCalledTimes(1);
    expect(syncTournamentState).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("efface la seule ligne d'inscription visée, et rien d'autre", async () => {
    const { sqls } = mockConnection(registrationRow());

    await removeTournamentEntrant(7, 102);

    const deletes = sqls.filter((sql) => sql.startsWith("DELETE"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(
      /DELETE FROM bg_tournament_registrations WHERE tournament_id = \? AND team_id = \?/,
    );
    // Aucune équipe n'est touchée : la fantôme resservira, l'entrée solo est
    // une identité d'engagé. Aucun match non plus — la fenêtre garantit qu'il
    // n'y en a pas.
    expect(sqls.some((sql) => /DELETE FROM bg_teams/.test(sql))).toBe(false);
    expect(sqls.some((sql) => /bg_matches/.test(sql))).toBe(false);
    expect(sqls.some((sql) => /standings/.test(sql))).toBe(false);
  });

  it("referme les rangs sans toucher au drapeau de seeding manuel", async () => {
    const { execute, sqls } = mockConnection(registrationRow(), { remaining: [101, 103, 104] });

    await removeTournamentEntrant(7, 102);

    const seedWrites = execute.mock.calls.filter((call) =>
      /UPDATE bg_tournament_registrations SET seed/.test(String((call as [string])[0]).replace(/\s+/g, " ")),
    );
    expect(seedWrites.map((call) => (call as [string, unknown[]])[1])).toEqual([
      [1, 7, 101],
      [2, 7, 103],
      [3, 7, 104],
    ]);
    // Refermer un trou n'est pas un ordre choisi par le staff : basculer
    // `manual_seeding` ferait passer un tournoi seedé au classement du site à
    // l'ordre d'inscription, sans que personne l'ait demandé.
    expect(sqls.some((sql) => /manual_seeding/.test(sql))).toBe(false);
  });

  it("rend le nom de l'engagé et l'effectif restant", async () => {
    mockConnection(registrationRow(), { entrantName: "Team Nova", remaining: [101, 103, 104] });

    const removed = await removeTournamentEntrant(7, 102);

    expect(removed).toEqual({
      tournamentId: 7,
      tournamentName: "BlueGenji Open",
      teamId: 102,
      entrantName: "Team Nova",
      registeredTeams: 3,
      maxTeams: 16,
      participantType: "TEAM",
    });
  });

  it("commite, vide la file de journal puis publie", async () => {
    const { connection } = mockConnection(registrationRow());

    await removeTournamentEntrant(7, 102);

    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    // La synchronisation a pu réserver une ligne de journal : elle ne part
    // qu'une fois la transaction acquise.
    expect(flushBotLogs).toHaveBeenCalledWith(connection);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["en cours", { state: "RUNNING" }, "ENTRANT_REMOVAL_TOURNAMENT_STARTED"],
    ["terminé", { state: "FINISHED" }, "ENTRANT_REMOVAL_TOURNAMENT_FINISHED"],
    [
      "dont l'heure de début est passée",
      {
        registration_close_at: new Date(Date.now() - 2 * HOUR),
        start_at: new Date(Date.now() - HOUR),
      },
      "ENTRANT_REMOVAL_TOURNAMENT_STARTED",
    ],
  ])("refuse un tournoi %s", async (_label, overrides, code) => {
    const { connection, sqls } = mockConnection(registrationRow(overrides));

    await expect(removeTournamentEntrant(7, 102)).rejects.toThrow(code);

    expect(sqls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
    // La file est jetée sur l'échec : un tournoi n'est jamais annoncé lancé par
    // une transaction qui a rendu la main sur une erreur.
    expect(discardBotLogs).toHaveBeenCalledWith(connection);
  });

  it("refuse un tournoi inconnu sans rien écrire", async () => {
    const { connection, sqls } = mockConnection(null);

    await expect(removeTournamentEntrant(7, 102)).rejects.toThrow("TOURNAMENT_NOT_FOUND");

    expect(sqls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("refuse un engagé qui n'est pas inscrit", async () => {
    const { connection, sqls } = mockConnection(registrationRow(), { entrantName: null });

    await expect(removeTournamentEntrant(7, 999)).rejects.toThrow("TEAM_NOT_IN_TOURNAMENT");

    expect(sqls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("rend la connexion même quand la transaction échoue", async () => {
    const { connection } = mockConnection(registrationRow({ state: "RUNNING" }));

    await expect(removeTournamentEntrant(7, 102)).rejects.toThrow();

    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
