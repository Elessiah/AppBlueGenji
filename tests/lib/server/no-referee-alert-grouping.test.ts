import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/cast-notices");
jest.mock("@/lib/server/tournaments/referee-notices");
jest.mock("@/lib/server/tournaments/bot-logs", () => ({
  queueRefereeAlert: jest.fn(async () => true),
  queueRoundNoRefereeAlert: jest.fn(async () => true),
  flushBotLogs: jest.fn(),
  discardBotLogs: jest.fn(),
}));

import type { PoolConnection } from "mysql2/promise";
import { queueNoRefereeAlerts } from "@/lib/server/tournaments/match-launch";
import { queueRefereeAlert, queueRoundNoRefereeAlert } from "@/lib/server/tournaments/bot-logs";
import type { NoRefereeCandidate } from "@/lib/shared/match-referee";

/**
 * Décision de l'utilisateur du 2026-10-27 (`MATCH_REFEREE.md` § Avertissement) :
 * match planifié → une alerte par match (clé par appariement) ; matchs sans
 * horaire → une alerte par manche, qui les liste — chacun y garde sa
 * réservation par appariement (`queueRoundNoRefereeAlert`).
 */
function connection(): PoolConnection {
  return {
    execute: async (sql: string) => {
      throw new Error(`requête inattendue : ${sql}`);
    },
  } as unknown as PoolConnection;
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
  jest.mocked(queueRoundNoRefereeAlert).mockClear();
});

describe("queueNoRefereeAlerts", () => {
  it("match planifié : une alerte par match, par appariement", async () => {
    await queueNoRefereeAlerts(connection(), [
      candidate({ matchId: 101, pairing: "10:20", scheduled: true }),
      candidate({ matchId: 102, pairing: "30:40", scheduled: true }),
    ]);
    expect(jest.mocked(queueRefereeAlert).mock.calls.map(([, entry]) => entry)).toEqual([
      { kind: "match_no_referee", matchId: 101, pairing: "10:20" },
      { kind: "match_no_referee", matchId: 102, pairing: "30:40" },
    ]);
    expect(queueRoundNoRefereeAlert).not.toHaveBeenCalled();
  });

  it("manche sans horaire : une seule alerte qui liste ses N matchs, chacun avec son appariement", async () => {
    await queueNoRefereeAlerts(connection(), [
      candidate({ matchId: 105, pairing: "5:6" }),
      candidate({ matchId: 103, pairing: "1:2" }),
      candidate({ matchId: 104, pairing: "3:4" }),
    ]);
    expect(queueRefereeAlert).not.toHaveBeenCalled();
    expect(jest.mocked(queueRoundNoRefereeAlert).mock.calls.map(([, matches]) => matches)).toEqual([
      [
        { matchId: 103, pairing: "1:2" },
        { matchId: 104, pairing: "3:4" },
        { matchId: 105, pairing: "5:6" },
      ],
    ]);
  });

  it("manche mixte : le match planifié à part, les sans horaire groupés", async () => {
    await queueNoRefereeAlerts(connection(), [
      candidate({ matchId: 110, pairing: "1:2", scheduled: true }),
      candidate({ matchId: 111, pairing: "3:4" }),
      candidate({ matchId: 112, pairing: "5:6" }),
    ]);
    expect(jest.mocked(queueRefereeAlert).mock.calls.map(([, entry]) => entry)).toEqual([
      { kind: "match_no_referee", matchId: 110, pairing: "1:2" },
    ]);
    expect(jest.mocked(queueRoundNoRefereeAlert).mock.calls.map(([, matches]) => matches)).toEqual([
      [
        { matchId: 111, pairing: "3:4" },
        { matchId: 112, pairing: "5:6" },
      ],
    ]);
  });

  it("deux manches sans horaire : une alerte chacune", async () => {
    await queueNoRefereeAlerts(connection(), [
      candidate({ matchId: 120 }),
      candidate({ matchId: 121, roundNumber: 3 }),
    ]);
    expect(queueRoundNoRefereeAlert).toHaveBeenCalledTimes(2);
  });

  it("une erreur de réservation remonte telle quelle (interblocage)", async () => {
    const deadlock = Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" });
    jest.mocked(queueRoundNoRefereeAlert).mockRejectedValueOnce(deadlock);
    await expect(queueNoRefereeAlerts(connection(), [candidate({ matchId: 130 })])).rejects.toBe(deadlock);
  });

  it("rien à signaler : aucune alerte", async () => {
    await queueNoRefereeAlerts(connection(), []);
    expect(queueRefereeAlert).not.toHaveBeenCalled();
    expect(queueRoundNoRefereeAlert).not.toHaveBeenCalled();
  });
});
