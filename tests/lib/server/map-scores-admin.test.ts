import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/byes");

import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments/admin";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";

/**
 * Connexion factice de l'arbitrage (`docs/features/MAP_SCORES.md`) : un match
 * prêt à deux équipes, le format demandé, et le journal de ce qui touche
 * `bg_match_maps`.
 */
function fakeConnection(matchFormat: { type: string; value: number }) {
  const updates: unknown[][] = [];
  const maps: { sql: string; params: unknown }[] = [];
  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.includes("bg_match_maps")) {
        maps.push({ sql: q, params });
        return [[], []];
      }
      if (q.startsWith("UPDATE")) {
        updates.push(params);
        return [{ affectedRows: 1 }, []];
      }
      if (q.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        return [[{ round_number: 1, status: "READY", winner_team_id: null, format: "SINGLE" }], []];
      }
      if (q.includes("match_format_type")) {
        return [[{ format: "SINGLE", game: "OW", match_format_type: matchFormat.type, match_format_value: matchFormat.value }], []];
      }
      if (q.includes("FROM bg_matches")) {
        return [[{
          id: 10,
          tournament_id: 1,
          team1_id: 100,
          team2_id: 200,
          next_winner_match_id: null,
          next_winner_slot: null,
          next_loser_match_id: null,
          next_loser_slot: null,
          winner_team_id: null,
        }], []];
      }
      return [[], []];
    },
  } as unknown as PoolConnection;
  return { conn, updates, maps };
}

const CLEAR_FINAL = "DELETE FROM bg_match_maps WHERE match_id = ? AND source = ?";

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(finalizeMatch).mockResolvedValue(undefined);
  jest.mocked(tryAutoResolveByes).mockResolvedValue(undefined);
});

describe("arbitrage — détail map par map", () => {
  it("« Enregistrer » avec des maps écrit le score dérivé et le détail retenu", async () => {
    const { conn, updates, maps } = fakeConnection({ type: "BO", value: 5 });
    await adminSaveMatchScores(conn, 10, undefined, undefined, undefined, {
      maps: [
        { replayCode: "AAA111", team1Score: 2, team2Score: 0 },
        { replayCode: "BBB222", team1Score: 1, team2Score: 1 },
      ],
      userId: 3,
    });
    expect(updates.at(-1)).toEqual([1, 0, 10]);
    expect(maps.some((m) => m.sql.startsWith("INSERT INTO bg_match_maps"))).toBe(true);
  });

  it("un forfait enregistré efface le détail, même sans maps envoyées", async () => {
    const { conn, maps } = fakeConnection({ type: "BO", value: 1 });
    await adminSaveMatchScores(conn, 10, undefined, undefined, 200);
    expect(maps).toEqual([{ sql: CLEAR_FINAL, params: [10, "FINAL"] }]);
  });

  it("un score à la main avec une liste vide efface le détail ; sans liste, il n'y touche pas", async () => {
    const first = fakeConnection({ type: "BO", value: 5 });
    await adminSaveMatchScores(first.conn, 10, 1, 0, undefined, { maps: [], userId: 3 });
    expect(first.maps.map((m) => m.sql)).toEqual([CLEAR_FINAL]);

    const second = fakeConnection({ type: "BO", value: 5 });
    await adminSaveMatchScores(second.conn, 10, 1, 0);
    expect(second.maps).toEqual([]);
  });

  it("un forfait tranché efface le détail, même déclaré par une engagée (sans mapEntry)", async () => {
    const { conn, maps } = fakeConnection({ type: "BO", value: 1 });
    await adminResolveMatch(conn, 10, undefined, undefined, 200);
    expect(maps.map((m) => m.sql)).toContain(CLEAR_FINAL);
  });

  it("« Valider le résultat » avec des maps tranche sur le score dérivé", async () => {
    const { conn } = fakeConnection({ type: "BO", value: 3 });
    await adminResolveMatch(conn, 10, undefined, undefined, undefined, false, {
      maps: [
        { replayCode: "AAA111", team1Score: 0, team2Score: 2 },
        { replayCode: "BBB222", team1Score: 3, team2Score: 1 },
        { replayCode: "CCC333", team1Score: 2, team2Score: 0 },
      ],
      userId: 3,
    });
    expect(finalizeMatch).toHaveBeenCalledWith(
      conn,
      1,
      expect.anything(),
      { team1Score: 2, team2Score: 1, winnerTeamId: 100, loserTeamId: 200 },
    );
  });

  it("refuse des maps invalides avec leur code, sans rien écrire", async () => {
    const { conn, updates } = fakeConnection({ type: "BO", value: 5 });
    await expect(
      adminResolveMatch(conn, 10, undefined, undefined, undefined, false, {
        maps: [{ replayCode: "AB12", team1Score: 1, team2Score: 0 }],
        userId: 3,
      }),
    ).rejects.toThrow("MAP_REPLAY_CODE_INVALID");
    expect(updates).toHaveLength(0);
  });
});
