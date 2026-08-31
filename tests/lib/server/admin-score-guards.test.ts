import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/byes");

import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments/admin";

/**
 * Garde-fous d'écriture de l'arbitrage, indépendants du format de match (voir
 * `match-format-admin.test.ts` pour celui-là).
 *
 * Le match factice oppose 100 à 200 et n'a aucun aval saisi : le verrou
 * descendant sort donc immédiatement, et il ne reste à observer que les deux
 * contrôles ajoutés ici.
 */
function fakeConnection(options: { winnerTeamId?: number | null } = {}): {
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

      // Verrou aval : les dépendants sont vierges.
      if (q.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        return [[{ round_number: 1, winner_team_id: null, format: "SINGLE" }], []];
      }

      if (q.includes("match_format_type")) {
        return [[{ match_format_type: null, match_format_value: null }], []];
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
              winner_team_id: options.winnerTeamId ?? null,
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

describe("adminSaveMatchScores — match déjà tranché", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuse d'enregistrer un score par-dessus un résultat acquis", async () => {
    // Cette route n'écrit que les scores : appliquée à un match tranché, elle
    // laissait `winner_team_id` et la qualifiée du tour suivant sur l'ancien
    // résultat — un match affiché 2-1 pour l'équipe portée perdante.
    const { conn, writes } = fakeConnection({ winnerTeamId: 100 });

    await expect(adminSaveMatchScores(conn, 10, 1, 2)).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    expect(writes).toHaveLength(0);
  });

  it("refuse aussi un forfait par-dessus un résultat acquis", async () => {
    const { conn, writes } = fakeConnection({ winnerTeamId: 100 });

    await expect(adminSaveMatchScores(conn, 10, undefined, undefined, 200)).rejects.toThrow(
      "MATCH_ALREADY_COMPLETED",
    );
    expect(writes).toHaveLength(0);
  });

  it("laisse enregistrer tant que le match n'est pas tranché", async () => {
    const { conn, writes } = fakeConnection();

    await expect(adminSaveMatchScores(conn, 10, 1, 0)).resolves.toBeUndefined();
    expect(writes).toHaveLength(1);
  });

  it("laisse re-trancher un match acquis : le vainqueur est recalculé", async () => {
    // La correction d'un résultat passe par là, et non par l'enregistrement.
    const { conn } = fakeConnection({ winnerTeamId: 100 });

    await expect(adminResolveMatch(conn, 10, 1, 2)).resolves.toBeUndefined();
  });
});

describe("forfait — l'équipe doit jouer le match", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuse un forfait déclaré pour une équipe étrangère (enregistrement)", async () => {
    const { conn, writes } = fakeConnection();

    await expect(adminSaveMatchScores(conn, 10, undefined, undefined, 999)).rejects.toThrow(
      "INVALID_FORFEIT_TEAM_ID",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse un forfait déclaré pour une équipe étrangère (validation)", async () => {
    // Sans ce contrôle, `adminResolveMatch` en déduisait un vainqueur par
    // défaut : l'équipe 1 gagnait parce qu'aucune des deux n'était la forfait.
    const { conn } = fakeConnection();

    await expect(adminResolveMatch(conn, 10, undefined, undefined, 999)).rejects.toThrow(
      "INVALID_FORFEIT_TEAM_ID",
    );
  });

  it("accepte le forfait de chacune des deux engagées", async () => {
    for (const teamId of [100, 200]) {
      const { conn, writes } = fakeConnection();
      await expect(
        adminSaveMatchScores(conn, 10, undefined, undefined, teamId),
      ).resolves.toBeUndefined();
      expect(writes).toHaveLength(1);
    }
  });
});
