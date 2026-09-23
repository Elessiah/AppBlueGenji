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
function fakeConnection(
  options: {
    winnerTeamId?: number | null;
    /**
     * Statut du match **tel que le verrou aval le lit** (première requête, celle
     * qui joint `bg_tournaments`). Par défaut `READY` : rien de propagé, donc
     * rien à verrouiller, et les cas écrits avant n'observent que les contrôles
     * qui les intéressent.
     */
    lockStatus?: "READY" | "COMPLETED";
    /** Manche suivante, telle que la rend la seconde requête du verrou. */
    dependents?: Record<string, unknown>[];
  } = {},
): {
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

      // Verrou aval, premier temps : le match édité, avec le format du tournoi.
      if (q.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        // `status` autant que `winner_team_id` : depuis que le verrou lit le statut
        // (`isMatchPlayed`), une ligne factice sans cette colonne le fait sortir
        // aussitôt — le garde-fou était donc neutralisé dans tous les tests qui
        // l'atteignent.
        return [
          [
            {
              round_number: 1,
              status: options.lockStatus ?? "READY",
              winner_team_id: options.lockStatus === "COMPLETED" ? 100 : null,
              next_winner_match_id: options.dependents ? 11 : null,
              next_loser_match_id: null,
              tournament_id: 1,
              format: "SINGLE",
            },
          ],
          [],
        ];
      }

      // Verrou aval, second temps : le plateau de la phase, que le verrou
      // parcourt depuis les liens du match édité (`dependentMatches`, qui
      // traverse les exemptions posées par le moteur). Les dépendants factices
      // portent l'identifiant de la cible (11).
      if (q.includes("next_winner_match_id, next_loser_match_id FROM bg_matches WHERE tournament_id")) {
        return [
          (options.dependents ?? []).map((row) => ({
            next_winner_match_id: null,
            next_loser_match_id: null,
            ...row,
            id: 11,
          })),
          [],
        ];
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
              // « Déjà tranché » se lit sur le statut : un match nul est
              // terminé sans avoir de vainqueur. Le fake dérive donc l'un de
              // l'autre pour que les cas écrits avant disent la même chose.
              status: options.winnerTeamId != null ? "COMPLETED" : "READY",
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

/**
 * Le verrou de manche **atteint par les points d'entrée de l'arbitrage**, et
 * pas seulement par son helper.
 *
 * Les connexions factices de ce fichier et de ses voisins rendaient la ligne du
 * verrou sans colonne `status` : depuis le passage à `isMatchPlayed`, le
 * garde-fou sortait donc aussitôt, et on aurait pu retirer entièrement son
 * appel d'`adminSaveMatchScores` et d'`adminResolveMatch` sans qu'un seul test
 * bronche. Ces deux cas ferment le trou du côté du chemin réel.
 */
describe("verrou de manche — depuis l'arbitrage, pas depuis l'helper", () => {
  /** Manche suivante déjà saisie : rien en amont ne doit plus bouger. */
  const PLAYED_NEXT_ROUND = [
    {
      id: 11,
      round_number: 2,
      team1_id: 100,
      team2_id: 300,
      team1_score: 3,
      team2_score: 1,
      winner_team_id: 100,
      forfeit_team_id: null,
      status: "COMPLETED",
      team1_reported_at: null,
      team2_reported_at: null,
    },
  ];

  it("refuse l'enregistrement quand la manche suivante porte une saisie", async () => {
    const { conn, writes } = fakeConnection({
      lockStatus: "COMPLETED",
      dependents: PLAYED_NEXT_ROUND,
    });

    await expect(adminSaveMatchScores(conn, 10, 2, 1)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse la validation du résultat dans le même cas", async () => {
    const { conn, writes } = fakeConnection({
      lockStatus: "COMPLETED",
      dependents: PLAYED_NEXT_ROUND,
    });

    await expect(adminResolveMatch(conn, 10, 2, 1)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
    expect(writes).toHaveLength(0);
  });

  it("laisse passer tant que la manche suivante est vierge", async () => {
    const { conn, writes } = fakeConnection({
      lockStatus: "COMPLETED",
      dependents: [
        {
          id: 11,
          round_number: 2,
          team1_id: 100,
          team2_id: null,
          team1_score: null,
          team2_score: null,
          winner_team_id: null,
          forfeit_team_id: null,
          status: "PENDING",
          team1_reported_at: null,
          team2_reported_at: null,
        },
      ],
    });

    await expect(adminResolveMatch(conn, 10, 2, 1)).resolves.toBeUndefined();
    expect(writes.length).toBeGreaterThan(0);
  });
});
