import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/cast-notices");
jest.mock("@/lib/server/tournaments/referee-notices");
jest.mock("@/lib/server/tournaments/bot-logs", () => ({
  queueRefereeAlert: jest.fn(async () => true),
  flushBotLogs: jest.fn(),
  discardBotLogs: jest.fn(),
}));

import type { PoolConnection } from "mysql2/promise";
import { queueNoRefereeAlerts } from "@/lib/server/tournaments/match-launch";
import { queueRefereeAlert } from "@/lib/server/tournaments/bot-logs";
import type { NoRefereeCandidate } from "@/lib/shared/match-referee";

/**
 * Décision de l'utilisateur du 2026-10-27 (`MATCH_REFEREE.md` § Avertissement) :
 * match planifié → une alerte par match (clé par appariement) ; matchs sans
 * horaire → une alerte par manche, qui les liste, réservée sur le premier
 * match de la manche.
 */
const ANCHOR = 100;

function connection(): { conn: PoolConnection; anchorQueries: unknown[][] } {
  const anchorQueries: unknown[][] = [];
  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT MIN(id) AS id FROM bg_matches")) {
        anchorQueries.push(params);
        return [[{ id: ANCHOR }], []];
      }
      throw new Error(`requête inattendue : ${sql}`);
    },
  } as unknown as PoolConnection;
  return { conn, anchorQueries };
}

const candidate = (overrides: Partial<NoRefereeCandidate>): NoRefereeCandidate => ({
  matchId: 1,
  pairing: "10:20",
  scheduled: false,
  phaseId: 3,
  bracket: "UPPER",
  roundNumber: 2,
  ...overrides,
});

beforeEach(() => {
  jest.mocked(queueRefereeAlert).mockClear();
});

describe("queueNoRefereeAlerts", () => {
  it("match planifié : une alerte par match, par appariement", async () => {
    const { conn, anchorQueries } = connection();
    await queueNoRefereeAlerts(conn, 7, [
      candidate({ matchId: 101, pairing: "10:20", scheduled: true }),
      candidate({ matchId: 102, pairing: "30:40", scheduled: true }),
    ]);
    expect(jest.mocked(queueRefereeAlert).mock.calls.map(([, entry]) => entry)).toEqual([
      { kind: "match_no_referee", matchId: 101, pairing: "10:20" },
      { kind: "match_no_referee", matchId: 102, pairing: "30:40" },
    ]);
    expect(anchorQueries).toEqual([]);
  });

  it("manche sans horaire : une seule alerte qui liste ses N matchs, portée par le premier match de la manche", async () => {
    const { conn, anchorQueries } = connection();
    await queueNoRefereeAlerts(conn, 7, [
      candidate({ matchId: 105 }),
      candidate({ matchId: 103 }),
      candidate({ matchId: 104 }),
    ]);
    expect(jest.mocked(queueRefereeAlert)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(queueRefereeAlert).mock.calls[0][1]).toEqual({
      kind: "match_no_referee",
      matchId: ANCHOR,
      pairing: "ROUND",
      roundMatchIds: [103, 104, 105],
    });
    expect(anchorQueries).toEqual([[7, 3, "UPPER", 2]]);
  });

  it("manche mixte : le match planifié à part, les sans horaire groupés", async () => {
    const { conn } = connection();
    await queueNoRefereeAlerts(conn, 7, [
      candidate({ matchId: 110, pairing: "1:2", scheduled: true }),
      candidate({ matchId: 111 }),
      candidate({ matchId: 112 }),
    ]);
    expect(jest.mocked(queueRefereeAlert).mock.calls.map(([, entry]) => entry)).toEqual([
      { kind: "match_no_referee", matchId: 110, pairing: "1:2" },
      { kind: "match_no_referee", matchId: ANCHOR, pairing: "ROUND", roundMatchIds: [111, 112] },
    ]);
  });

  it("lecture du premier match en échec : l'alerte de la manche se tait, l'entretien continue", async () => {
    const conn = {
      execute: async () => {
        throw new Error("ER_LOCK_WAIT_TIMEOUT");
      },
    } as unknown as PoolConnection;
    await expect(queueNoRefereeAlerts(conn, 7, [candidate({ matchId: 120 })])).resolves.toBeUndefined();
    expect(queueRefereeAlert).not.toHaveBeenCalled();
  });

  it("transaction défaite pendant la lecture : l'erreur remonte", async () => {
    const aborted = Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    const conn = {
      execute: async () => {
        throw aborted;
      },
    } as unknown as PoolConnection;
    await expect(queueNoRefereeAlerts(conn, 7, [candidate({ matchId: 121 })])).rejects.toBe(aborted);
  });

  it("rien à signaler : aucune alerte, aucune lecture", async () => {
    const { conn, anchorQueries } = connection();
    await queueNoRefereeAlerts(conn, 7, []);
    expect(queueRefereeAlert).not.toHaveBeenCalled();
    expect(anchorQueries).toEqual([]);
  });
});
