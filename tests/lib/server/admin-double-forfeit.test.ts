import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/byes");

import { adminResolveMatch } from "@/lib/server/tournaments/admin";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";

/**
 * L'arbitrage d'un double forfait : la rencontre se clôt sans vainqueur, sans
 * perdant nommé et **sans score** — un 0-0 se lirait comme un match nul partout
 * où l'on relit les colonnes.
 */
function fakeConnection(match: Record<string, unknown> = {}) {
  const writes: { sql: string; params: unknown[] }[] = [];

  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("UPDATE")) {
        writes.push({ sql: q, params });
        return [{ affectedRows: 1 }, []];
      }
      // Verrou aval : match encore indécis, rien à verrouiller.
      if (q.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        return [[{ round_number: 1, status: "READY", winner_team_id: null, format: "SINGLE" }], []];
      }
      if (q.includes("FROM bg_matches")) {
        return [
          [
            {
              id: 10,
              tournament_id: 1,
              round_number: 1,
              team1_id: 100,
              team2_id: 200,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
              winner_team_id: null,
              ...match,
            },
          ],
          [],
        ];
      }
      return [[], []];
    },
  } as unknown as PoolConnection;

  return { conn, writes };
}

describe("adminResolveMatch — double forfait", () => {
  beforeEach(() => jest.clearAllMocks());

  it("clôt la rencontre sans vainqueur, sans perdant et sans score", async () => {
    const { conn, writes } = fakeConnection();

    await adminResolveMatch(conn, 10, undefined, undefined, undefined, true);

    expect(finalizeMatch).toHaveBeenCalledWith(conn, 1, expect.objectContaining({ id: 10 }), {
      team1Score: null,
      team2Score: null,
      winnerTeamId: null,
      loserTeamId: null,
    });
    const flag = writes.find((w) => w.sql.includes("double_forfeit = ?"));
    expect(flag?.params).toEqual([null, 1, 10]);
  });

  it("efface le drapeau quand un double forfait est corrigé en résultat", async () => {
    const { conn, writes } = fakeConnection();

    await adminResolveMatch(conn, 10, 3, 1);

    const flag = writes.find((w) => w.sql.includes("double_forfeit = ?"));
    expect(flag?.params).toEqual([null, 0, 10]);
  });

  it("garde le forfait nominatif exclusif du double forfait", async () => {
    const { conn, writes } = fakeConnection();

    await adminResolveMatch(conn, 10, undefined, undefined, 200);

    const flag = writes.find((w) => w.sql.includes("double_forfeit = ?"));
    expect(flag?.params).toEqual([200, 0, 10]);
  });

  it("refuse un double forfait mêlé à un score ou à une équipe", async () => {
    const { conn } = fakeConnection();

    await expect(adminResolveMatch(conn, 10, 1, 0, undefined, true)).rejects.toThrow(
      "INVALID_REQUEST",
    );
    await expect(adminResolveMatch(conn, 10, undefined, undefined, 100, true)).rejects.toThrow(
      "INVALID_REQUEST",
    );
    expect(finalizeMatch).not.toHaveBeenCalled();
  });

  it("refuse un match qui n'a pas ses deux engagées", async () => {
    const { conn } = fakeConnection({ team2_id: null });

    await expect(adminResolveMatch(conn, 10, undefined, undefined, undefined, true)).rejects.toThrow(
      "MATCH_NOT_READY",
    );
  });
});
