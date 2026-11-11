import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/admin", () => ({ adminResolveMatch: jest.fn() }));

import { adminResolveMatch } from "@/lib/server/tournaments/admin";
import {
  forfeitDeletedEntryNextMatch,
  hasOpenDeletedEntryMatch,
  lockDeletedSoloEntryStillForfeitable,
} from "@/lib/server/tournaments/deleted-entry-forfeit";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/*
 * E1 — forfait du prochain match de l'entrée d'un compte en suppression, tout
 * relu sous verrou : un match qu'un arbitre vient de trancher n'est jamais
 * « corrigé » en forfait.
 */

type Options = {
  state?: string;
  entryDeleted?: boolean;
  neverPlayed?: boolean;
  openMatch?: number | null;
  /** Engagées du match ouvert (40 contre 41 par défaut). */
  pairing?: [number, number];
  /** L'adversaire 41 est lui aussi une entrée en suppression jamais jouée. */
  opponentDeleted?: boolean;
};

function fakeTx(options: Options) {
  const queries: string[] = [];
  const execute = jest.fn(async (sql: string, params?: unknown) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push(q);
    if (q.startsWith("SELECT state FROM bg_tournaments")) return [[{ state: options.state ?? "RUNNING" }]];
    if (q.startsWith("SELECT s.solo_user_id FROM bg_teams s")) {
      const isOpponent = Array.isArray(params) && params[0] === 41;
      if (isOpponent) return [options.opponentDeleted ? [{ solo_user_id: 71 }] : []];
      return [options.neverPlayed === false ? [] : [{ solo_user_id: 70 }]];
    }
    if (q.startsWith("SELECT is_deleted FROM bg_users")) {
      return [[{ is_deleted: options.entryDeleted === false ? 0 : 1 }]];
    }
    if (q.startsWith("SELECT id, team1_id, team2_id FROM bg_matches")) {
      const id = options.openMatch === undefined ? 101 : options.openMatch;
      const [team1_id, team2_id] = options.pairing ?? [40, 41];
      return [id === null ? [] : [{ id, team1_id, team2_id }]];
    }
    return [[]];
  });
  return { connection: fakeConnection({ execute }), queries };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("forfeitDeletedEntryNextMatch", () => {
  it("forfeitDeletedEntryNextMatch_open_forfeitsAndReturnsId", async () => {
    const { connection, queries } = fakeTx({});

    expect(await forfeitDeletedEntryNextMatch(connection, 4, 40)).toBe(101);
    expect(adminResolveMatch).toHaveBeenCalledWith(connection, 101, { forfeitTeamId: 40 });
    expect(queries[0]).toBe("SELECT id FROM bg_tournaments WHERE id = ? FOR UPDATE");
  });

  it("forfeitDeletedEntryNextMatch_tournamentNotRunning_null", async () => {
    const { connection } = fakeTx({ state: "FINISHED" });

    expect(await forfeitDeletedEntryNextMatch(connection, 4, 40)).toBeNull();
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitDeletedEntryNextMatch_accountReactivatedOrPlayed_null", async () => {
    const { connection } = fakeTx({ entryDeleted: false });

    expect(await forfeitDeletedEntryNextMatch(connection, 4, 40)).toBeNull();
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitDeletedEntryNextMatch_noOpenMatch_null", async () => {
    const { connection } = fakeTx({ openMatch: null });

    expect(await forfeitDeletedEntryNextMatch(connection, 4, 40)).toBeNull();
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitDeletedEntryNextMatch_matchQuery_locksRowWithoutJoin", async () => {
    const { connection, queries } = fakeTx({});

    await forfeitDeletedEntryNextMatch(connection, 4, 40);

    const matchQuery = queries.find((q) => q.startsWith("SELECT id, team1_id, team2_id FROM bg_matches"));
    expect(matchQuery).toContain("FOR UPDATE");
    expect(matchQuery).not.toContain("JOIN");
  });

  it("forfeitDeletedEntryNextMatch_opponentAlsoDeleted_doubleForfeit", async () => {
    const { connection } = fakeTx({ opponentDeleted: true });

    expect(await forfeitDeletedEntryNextMatch(connection, 4, 40)).toBe(101);
    expect(adminResolveMatch).toHaveBeenCalledWith(connection, 101, { doubleForfeit: true });
  });

  it("forfeitDeletedEntryNextMatch_entryIsTeam2_checksTeam1AsOpponent", async () => {
    const { connection } = fakeTx({ pairing: [41, 40], opponentDeleted: true });

    await forfeitDeletedEntryNextMatch(connection, 4, 40);

    expect(adminResolveMatch).toHaveBeenCalledWith(connection, 101, { doubleForfeit: true });
  });
});

describe("hasOpenDeletedEntryMatch", () => {
  it("hasOpenDeletedEntryMatch_openMatch_trueWithoutLock", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ 1: 1 }], undefined]);

    expect(await hasOpenDeletedEntryMatch(fakeConnection({ execute }), 4, 40)).toBe(true);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).not.toContain("FOR UPDATE");
    expect(params).toEqual([4, 40, 40]);
  });

  it("hasOpenDeletedEntryMatch_noOpenMatch_false", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);

    expect(await hasOpenDeletedEntryMatch(fakeConnection({ execute }), 4, 40)).toBe(false);
  });
});

describe("lockDeletedSoloEntryStillForfeitable", () => {
  it("lockDeletedSoloEntryStillForfeitable_pendingNeverPlayed_trueAndLocksUserAlone", async () => {
    const { connection, queries } = fakeTx({});

    expect(await lockDeletedSoloEntryStillForfeitable(connection, 4, 40)).toBe(true);
    expect(queries[2]).toBe("SELECT is_deleted FROM bg_users WHERE id = ? FOR UPDATE");
  });

  it("lockDeletedSoloEntryStillForfeitable_entryPlayed_falseWithoutUserLock", async () => {
    const { connection, queries } = fakeTx({ neverPlayed: false });

    expect(await lockDeletedSoloEntryStillForfeitable(connection, 4, 40)).toBe(false);
    expect(queries).toHaveLength(2);
  });

  it("lockDeletedSoloEntryStillForfeitable_tournamentFinished_falseWithoutEntryRead", async () => {
    const { connection, queries } = fakeTx({ state: "FINISHED" });

    expect(await lockDeletedSoloEntryStillForfeitable(connection, 4, 40)).toBe(false);
    expect(queries).toHaveLength(1);
  });

  it("lockDeletedSoloEntryStillForfeitable_reactivated_false", async () => {
    const { connection } = fakeTx({ entryDeleted: false });

    expect(await lockDeletedSoloEntryStillForfeitable(connection, 4, 40)).toBe(false);
  });
});
