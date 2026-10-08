import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/bg-survie/reconcile");
jest.mock("@/lib/server/tournaments/phases");

import { cancelTournamentForfeit } from "@/lib/server/tournaments/forfeit-cancellation";
import { getDatabase } from "@/lib/server/database";
import { flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { reconcileSurvival } from "@/lib/server/tournaments/survival";
import { reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie/reconcile";
import { reconcilePhases } from "@/lib/server/tournaments/phases";
import { connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

/**
 * `cancelTournamentForfeit` : le verrou d'abord, la fenêtre ensuite, et une
 * seule écriture — le statut — avant le rejeu du moteur concerné.
 */

type Head = {
  format?: string;
  state?: string;
  endurance_playoffs_started?: number;
};

function setup(options: {
  head?: Head | null;
  phase?: { id: number; format: string } | null;
  standing?: { status: string } | null;
} = {}) {
  const head =
    options.head === null
      ? null
      : {
          name: "BlueGenji Open",
          format: "SURVIVAL",
          state: "RUNNING",
          participant_type: "TEAM",
          endurance_playoffs_started: 0,
          ...options.head,
        };
  const standing = options.standing === undefined ? { status: "FORFEIT" } : options.standing;
  const sqls: string[] = [];
  const params: unknown[] = [];
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql: string, values?: unknown) => {
    const flat = sql.replace(/\s+/g, " ").trim();
    sqls.push(flat);
    params.push(values);
    if (/FOR UPDATE/.test(flat)) return [[{ id: 7 }]];
    if (/FROM bg_tournaments WHERE id/.test(flat)) return [head ? [head] : []];
    if (/bg_tournament_phases/.test(flat)) return [options.phase ? [options.phase] : []];
    if (/^SELECT s.status/.test(flat)) {
      return [standing ? [{ ...standing, team_name: "Team Nova" }] : []];
    }
    return [{ affectedRows: 1 }];
  });
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ getConnection: jest.fn(async () => connection) }),
  );
  return { connection, sqls, params };
}

describe("cancelTournamentForfeit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("verrouille la ligne du tournoi en toute première instruction", async () => {
    const { sqls } = setup();

    await cancelTournamentForfeit(7, 102);

    expect(sqls[0]).toMatch(/SELECT id FROM bg_tournaments WHERE id = \? FOR UPDATE/);
  });

  it("remet l'engagé en lice puis rejoue la Survie, et publie après le commit", async () => {
    const { sqls, params, connection } = setup();

    const result = await cancelTournamentForfeit(7, 102);

    const update = sqls.findIndex((sql) => sql.startsWith("UPDATE bg_survival_standings"));
    expect(sqls[update]).toContain("s.status = 'ACTIVE'");
    expect(sqls[update]).toContain("s.eliminated_round = NULL");
    expect(params[update]).toEqual([7, 0, 102]);
    expect(reconcileSurvival).toHaveBeenCalledWith(7, fakeConnection(connection), { phaseId: 0 });
    expect(reconcilePhases).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalled();
    expect(flushBotLogs).toHaveBeenCalled();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
    expect(result).toEqual({
      tournamentId: 7,
      tournamentName: "BlueGenji Open",
      teamId: 102,
      entrantName: "Team Nova",
      participantType: "TEAM",
    });
  });

  it("n'écrit que le statut : le match perdu par forfait reste perdu", async () => {
    const { sqls } = setup();

    await cancelTournamentForfeit(7, 102);

    expect(sqls.some((sql) => /bg_matches/.test(sql))).toBe(false);
  });

  it("efface la ronde de sortie en Ronde suisse", async () => {
    const { sqls, connection } = setup({ head: { format: "SWISS" } });

    await cancelTournamentForfeit(7, 102);

    expect(sqls.find((sql) => sql.startsWith("UPDATE bg_swiss_standings"))).toContain(
      "s.forfeit_round = NULL",
    );
    expect(reconcileSwiss).toHaveBeenCalledWith(7, fakeConnection(connection), { phaseId: 0 });
  });

  it("rejoue l'endurance en BG Survie, sans phase", async () => {
    const { sqls, params, connection } = setup({ head: { format: "BG_SURVIE" } });

    await cancelTournamentForfeit(7, 102);

    const update = sqls.findIndex((sql) => sql.startsWith("UPDATE bg_endurance_standings"));
    expect(params[update]).toEqual([7, 102]);
    expect(reconcileEndurance).toHaveBeenCalledWith(7, fakeConnection(connection));
  });

  it("suit la phase en cours d'un multi-phases, puis réconcilie les phases", async () => {
    const { params, sqls, connection } = setup({
      head: { format: "MULTI" },
      phase: { id: 12, format: "SWISS" },
    });

    await cancelTournamentForfeit(7, 102);

    const update = sqls.findIndex((sql) => sql.startsWith("UPDATE bg_swiss_standings"));
    expect(params[update]).toEqual([7, 12, 102]);
    expect(reconcileSwiss).toHaveBeenCalledWith(7, fakeConnection(connection), { phaseId: 12 });
    expect(reconcilePhases).toHaveBeenCalledWith(7, fakeConnection(connection));
  });

  it.each([
    ["TOURNAMENT_NOT_FOUND", { head: null }],
    ["TOURNAMENT_NOT_RUNNING", { head: { state: "FINISHED" } }],
    ["FORMAT_WITHOUT_FORFEIT", { head: { format: "SINGLE" } }],
    ["FORMAT_WITHOUT_FORFEIT", { head: { format: "MULTI" }, phase: { id: 3, format: "DOUBLE" } }],
    ["ENDURANCE_PLAYOFFS_STARTED", { head: { format: "BG_SURVIE", endurance_playoffs_started: 1 } }],
    ["TEAM_NOT_IN_TOURNAMENT", { standing: null }],
    ["TEAM_NOT_FORFEITED", { standing: { status: "ACTIVE" } }],
    ["TEAM_NOT_FORFEITED", { standing: { status: "ELIMINATED" } }],
  ])("refuse en %s, sans rien écrire", async (code, options) => {
    const { sqls, connection } = setup(options);

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow(code);

    expect(sqls.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });
});
