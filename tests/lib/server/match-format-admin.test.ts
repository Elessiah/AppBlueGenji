import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/byes");

import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments/admin";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";

/**
 * Connexion factice pour les deux entrées d'arbitrage. Le match n'a pas encore
 * de vainqueur, donc le verrou aval (`checkDownstreamMatchesHaveNoScores`) sort
 * immédiatement : il ne reste que le contrôle de format à observer.
 */
function fakeConnection(matchFormat: { type: string; value: number } | null): {
  conn: PoolConnection;
  writes: string[];
} {
  const writes: string[] = [];

  const conn = {
    execute: async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();

      if (q.startsWith("UPDATE")) {
        writes.push(q);
        return [{ affectedRows: 1 }, []];
      }

      // Verrou aval : match indécis → la saisie reste ouverte.
      if (q.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        return [[{ round_number: 1, winner_team_id: null, format: "SINGLE" }], []];
      }

      if (q.includes("match_format_type")) {
        return [
          [
            {
              match_format_type: matchFormat?.type ?? null,
              match_format_value: matchFormat?.value ?? null,
            },
          ],
          [],
        ];
      }

      if (q.includes("FROM bg_matches")) {
        return [
          [
            {
              id: 10,
              tournament_id: 1,
              team1_id: 100,
              team2_id: 200,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
              winner_team_id: null,
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

describe("adminSaveMatchScores — respect du format de match", () => {
  beforeEach(() => jest.clearAllMocks());

  it("accepte un score partiel : l'arbitrage note un match en cours", async () => {
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });
    await adminSaveMatchScores(conn, 10, 2, 1);
    expect(writes.some((q) => q.includes("team1_score"))).toBe(true);
  });

  it("refuse un score au-dessus du plafond, sans écrire", async () => {
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });
    await expect(adminSaveMatchScores(conn, 10, 4, 0)).rejects.toThrow(
      "SCORE_EXCEEDS_MATCH_FORMAT",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse une somme au-dessus des manches jouables", async () => {
    const { conn } = fakeConnection({ type: "FT", value: 3 });
    await expect(adminSaveMatchScores(conn, 10, 3, 3)).rejects.toThrow(
      "SCORE_EXCEEDS_MATCH_FORMAT",
    );
  });

  it("ne contraint rien en saisie libre", async () => {
    const { conn, writes } = fakeConnection(null);
    await adminSaveMatchScores(conn, 10, 12, 9);
    expect(writes.some((q) => q.includes("team1_score"))).toBe(true);
  });

  it("laisse passer un forfait sans regarder le format", async () => {
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });
    await adminSaveMatchScores(conn, 10, undefined, undefined, 200);
    expect(writes.some((q) => q.includes("forfeit_team_id"))).toBe(true);
  });
});

describe("adminResolveMatch — respect du format de match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (finalizeMatch as jest.Mock).mockResolvedValue(undefined as never);
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
  });

  it("accepte un 3-2 en BO5 et désigne le vainqueur", async () => {
    const { conn } = fakeConnection({ type: "BO", value: 5 });
    await adminResolveMatch(conn, 10, 3, 2);
    expect(finalizeMatch).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.anything(),
      expect.objectContaining({ team1Score: 3, team2Score: 2, winnerTeamId: 100 }),
    );
  });

  it("refuse un score qui n'atteint pas l'objectif — rien n'est finalisé", async () => {
    const { conn } = fakeConnection({ type: "BO", value: 5 });
    await expect(adminResolveMatch(conn, 10, 2, 1)).rejects.toThrow("SCORE_BELOW_MATCH_FORMAT");
    expect(finalizeMatch).not.toHaveBeenCalled();
  });

  it("refuse un score au-dessus de l'objectif", async () => {
    const { conn } = fakeConnection({ type: "FT", value: 3 });
    await expect(adminResolveMatch(conn, 10, 5, 1)).rejects.toThrow("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(finalizeMatch).not.toHaveBeenCalled();
  });

  it("finalise un forfait quel que soit le format", async () => {
    const { conn } = fakeConnection({ type: "BO", value: 5 });
    await adminResolveMatch(conn, 10, undefined, undefined, 100);
    expect(finalizeMatch).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.anything(),
      expect.objectContaining({ winnerTeamId: 200, team1Score: null }),
    );
  });
});
