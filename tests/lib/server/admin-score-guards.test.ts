import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/byes");

import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments/admin";
import { mapsFor } from "../../helpers/match-maps";
import type { MatchMapInput } from "@/lib/shared/match-maps";
import { SINGLE_REPORT_SQL } from "@/lib/server/tournaments/score-report-sql";

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
    /** Horaire et lancement du match édité ; absents = sans date, non lancé. */
    startAt?: Date | null;
    launchedAt?: Date | null;
    /** Option du tournoi « matchs planifiés par l'arbitrage ». */
    refereeScheduling?: boolean;
    /**
     * Le match n'a qu'un report (`SINGLE_REPORT_SQL`) : la suspension de la
     * validation d'office touche une ligne. Par défaut, aucun report seul.
     */
    singleReport?: boolean;
    /** La validation d'office était déjà suspendue avant cette saisie. */
    alreadyPaused?: boolean;
    /** Maps `FINAL` déjà portées par le match (`loadStoredMapSet`, ids 501…) ; aucune par défaut. */
    finalMaps?: MatchMapInput[];
  } = {},
): {
  conn: PoolConnection;
  writes: string[];
  /** Toutes les instructions, aplaties, dans l'ordre. */
  statements: string[];
  /** Suspensions de la validation d'office tentées (`pauseAutoValidation`), avec leurs paramètres. */
  pauses: { sql: string; params: unknown[] }[];
} {
  const writes: string[] = [];
  const statements: string[] = [];
  const pauses: { sql: string; params: unknown[] }[] = [];

  // Suspension de la validation d'office (report seul), comptée à part : elle
  // ne touche une ligne que si le match n'a qu'un report.
  const update = (q: string, params: unknown[]) => {
    if (q.startsWith("UPDATE bg_matches m SET m.score_validation_paused_at")) {
      pauses.push({ sql: q, params });
      return [{ affectedRows: options.singleReport ? 1 : 0 }, []];
    }
    writes.push(q);
    return [{ affectedRows: 1 }, []];
  };

  // Écritures, et lectures des maps FINAL (`loadStoredMapSet`, `clearMapSets`) ; `null` pour le reste.
  const finalMaps = options.finalMaps ?? [];
  const writeOrProbe = (q: string, params: unknown[]) => {
    if (q.startsWith("UPDATE")) return update(q, params);
    if (q.startsWith("SELECT id, map_number, replay_code, team1_score, team2_score FROM bg_match_maps")) {
      const rows = finalMaps.map((map, index) => ({
        id: 501 + index,
        map_number: index + 1,
        replay_code: map.replayCode,
        team1_score: map.team1Score,
        team2_score: map.team2Score,
      }));
      return [rows, []];
    }
    // Sonde de l'effacement sur forfait (`clearMapSets`).
    if (q.startsWith("SELECT 1 FROM bg_match_maps")) return [finalMaps.length > 0 ? [{ 1: 1 }] : [], []];
    return null;
  };

  // État d'avant la saisie, lu par la lecture verrouillante du match.
  const pausedFlag = options.alreadyPaused ? 1 : 0;

  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      statements.push(q);

      const direct = writeOrProbe(q, params);
      if (direct) return direct;

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

      // Règles du tournoi, lues une fois (`loadTournamentMatchRules`) : format,
      // jeu et programmation par l'arbitrage (ERREUR.txt EF-15).
      if (q.includes("match_format_type")) {
        return [
          [{ match_format_type: null, match_format_value: null, referee_scheduling: options.refereeScheduling ? 1 : 0 }],
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
              winner_team_id: options.winnerTeamId ?? null,
              // « Déjà tranché » se lit sur le statut : un match nul est
              // terminé sans avoir de vainqueur. Le fake dérive donc l'un de
              // l'autre pour que les cas écrits avant disent la même chose.
              status: options.winnerTeamId != null ? "COMPLETED" : "READY",
              start_at: options.startAt ?? null,
              launched_at: options.launchedAt ?? null,
              launch_pairing: "100:200",
              score_validation_paused: pausedFlag,
            },
          ],
          [],
        ];
      }

      return [[], []];
    },
  } as unknown as PoolConnection;

  return { conn, writes, statements, pauses };
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

    await expect(adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 2), userId: 1 })).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    expect(writes).toHaveLength(0);
  });

  it("refuse aussi un forfait par-dessus un résultat acquis", async () => {
    const { conn, writes } = fakeConnection({ winnerTeamId: 100 });

    await expect(adminSaveMatchScores(conn, 10, { forfeitTeamId: 200 })).rejects.toThrow(
      "MATCH_ALREADY_COMPLETED",
    );
    expect(writes).toHaveLength(0);
  });

  it("laisse enregistrer tant que le match n'est pas tranché", async () => {
    const { conn, writes } = fakeConnection();

    await expect(adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 })).resolves.toEqual({ saved: expect.objectContaining({ id: 10 }), paused: false, pausedNow: false });
    expect(writes).toHaveLength(1);
  });

  it("laisse re-trancher un match acquis : le vainqueur est recalculé", async () => {
    // La correction d'un résultat passe par là, et non par l'enregistrement.
    const { conn } = fakeConnection({ winnerTeamId: 100 });

    await expect(adminResolveMatch(conn, 10, { maps: mapsFor(1, 2), userId: 1 })).resolves.toBeUndefined();
  });
});

describe("forfait — l'équipe doit jouer le match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refuse un forfait déclaré pour une équipe étrangère (enregistrement)", async () => {
    const { conn, writes } = fakeConnection();

    await expect(adminSaveMatchScores(conn, 10, { forfeitTeamId: 999 })).rejects.toThrow(
      "INVALID_FORFEIT_TEAM_ID",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse un forfait déclaré pour une équipe étrangère (validation)", async () => {
    // Sans ce contrôle, `adminResolveMatch` en déduisait un vainqueur par
    // défaut : l'équipe 1 gagnait parce qu'aucune des deux n'était la forfait.
    const { conn } = fakeConnection();

    await expect(adminResolveMatch(conn, 10, { forfeitTeamId: 999 })).rejects.toThrow(
      "INVALID_FORFEIT_TEAM_ID",
    );
  });

  it("accepte le forfait de chacune des deux engagées", async () => {
    for (const teamId of [100, 200]) {
      const { conn, writes } = fakeConnection();
      await expect(
        adminSaveMatchScores(conn, 10, { forfeitTeamId: teamId }),
      ).resolves.toEqual({ saved: expect.objectContaining({ id: 10 }), paused: false, pausedNow: false });
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
 * appel d'`adminResolveMatch` sans qu'un seul test bronche. Ces cas ferment le
 * trou du côté du chemin réel ; « Enregistrer », qui refuse tout match clos,
 * n'a plus de raison de le lire.
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

  // Revue perf #542 : « Enregistrer » refuse un match clos avant ce verrou, qui
  // ne protège qu'un match joué (`COMPLETED`) — sa lecture jointe ne servait à
  // rien, sous le verrou du tournoi, à chaque map. Seule la validation le lit.
  it("adminSave_openMatch_neverReadsDownstreamLock", async () => {
    const { conn, statements } = fakeConnection({ lockStatus: "COMPLETED", dependents: PLAYED_NEXT_ROUND });

    await adminSaveMatchScores(conn, 10, { maps: mapsFor(2, 1), userId: 1 });

    expect(statements.some((sql) => sql.includes("FROM bg_matches m JOIN bg_tournaments t"))).toBe(false);
  });

  it("refuse la validation du résultat dans le même cas", async () => {
    const { conn, writes } = fakeConnection({
      lockStatus: "COMPLETED",
      dependents: PLAYED_NEXT_ROUND,
    });

    await expect(adminResolveMatch(conn, 10, { maps: mapsFor(2, 1), userId: 1 })).rejects.toThrow(
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

    await expect(adminResolveMatch(conn, 10, { maps: mapsFor(2, 1), userId: 1 })).resolves.toBeUndefined();
    expect(writes.length).toBeGreaterThan(0);
  });
});

describe("lecture verrouillante du match — course avec le réordonnancement du seeding", () => {
  /**
   * Un réordonnancement verrouille les matchs du tournoi puis détruit le
   * plateau. Lu sans verrou, le match paraissait encore là, l'`UPDATE` ne
   * touchait plus rien après l'attente, et l'arbitrage annonçait un succès.
   */
  function recordingConnection(matchRows: Record<string, unknown>[]) {
    const reads: string[] = [];
    const writes: string[] = [];
    const conn = {
      execute: async (sql: string) => {
        const q = sql.replace(/\s+/g, " ").trim();
        if (q.startsWith("UPDATE")) {
          writes.push(q);
          return [{ affectedRows: 1 }, []];
        }
        reads.push(q);
        return [matchRows, []];
      },
    } as unknown as PoolConnection;
    return { conn, reads, writes };
  }

  it.each<[string, (conn: PoolConnection) => Promise<unknown>]>([
    ["l'enregistrement", (conn) => adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 })],
    ["la validation", (conn) => adminResolveMatch(conn, 10, { maps: mapsFor(1, 0), userId: 1 })],
  ])("%s lit le match sous `FOR UPDATE`, sans jointure", async (_label, run) => {
    const { conn, reads } = recordingConnection([]);

    await expect(run(conn)).rejects.toThrow("MATCH_NOT_FOUND");

    expect(reads[0]).toMatch(/FROM bg_matches WHERE id = \? LIMIT 1 FOR UPDATE$/);
    expect(reads[0]).not.toMatch(/JOIN/);
  });

  it.each<[string, (conn: PoolConnection) => Promise<unknown>]>([
    ["l'enregistrement", (conn) => adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 })],
    ["la validation", (conn) => adminResolveMatch(conn, 10, { maps: mapsFor(1, 0), userId: 1 })],
  ])("%s refuse un match supprimé pendant l'attente, sans rien écrire", async (_label, run) => {
    const { conn, writes } = recordingConnection([]);

    await expect(run(conn)).rejects.toThrow("MATCH_NOT_FOUND");
    expect(writes).toHaveLength(0);
  });
});

describe("aucun score avant le lancement — arbitrage compris", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const FUTURE = new Date(Date.now() + 3_600_000);

  it("refuse d'enregistrer un score sur un match à planifier", async () => {
    const { conn, writes } = fakeConnection({ refereeScheduling: true });
    await expect(adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 })).rejects.toThrow("MATCH_NOT_IN_LAUNCH");
    expect(writes).toHaveLength(0);
  });

  it("refuse de valider un score sur un match en attente de départ, option éteinte", async () => {
    const { conn, writes } = fakeConnection({ startAt: FUTURE });
    await expect(adminResolveMatch(conn, 10, { maps: mapsFor(2, 0), userId: 1 })).rejects.toThrow("MATCH_NOT_IN_LAUNCH");
    expect(writes).toHaveLength(0);
  });

  it("laisse prononcer un forfait avant le lancement (enregistrement et validation)", async () => {
    const save = fakeConnection({ refereeScheduling: true });
    await expect(adminSaveMatchScores(save.conn, 10, { forfeitTeamId: 200 })).resolves.toEqual({ saved: expect.objectContaining({ id: 10 }), paused: false, pausedNow: false });

    const resolve = fakeConnection({ startAt: FUTURE });
    await expect(adminResolveMatch(resolve.conn, 10, { forfeitTeamId: 200 })).resolves.toBeUndefined();
  });

  it("laisse prononcer un double forfait avant le lancement", async () => {
    const { conn } = fakeConnection({ refereeScheduling: true });
    await expect(adminResolveMatch(conn, 10, { doubleForfeit: true })).resolves.toBeUndefined();
  });

  it("laisse saisir dès le lancement, et sur un match lancé avant son heure", async () => {
    const lobby = fakeConnection({ startAt: new Date(Date.now() - 60_000), refereeScheduling: true });
    await expect(adminSaveMatchScores(lobby.conn, 10, { maps: mapsFor(1, 0), userId: 1 })).resolves.toEqual({ saved: expect.objectContaining({ id: 10 }), paused: false, pausedNow: false });

    const forced = fakeConnection({ startAt: FUTURE, launchedAt: new Date() });
    await expect(adminSaveMatchScores(forced.conn, 10, { maps: mapsFor(1, 0), userId: 1 })).resolves.toEqual({ saved: expect.objectContaining({ id: 10 }), paused: false, pausedNow: false });
  });

  it("laisse corriger un match terminé, même à planifier ou daté dans le futur", async () => {
    const { conn } = fakeConnection({ winnerTeamId: 100, refereeScheduling: true, startAt: FUTURE });
    await expect(adminResolveMatch(conn, 10, { maps: mapsFor(2, 1), userId: 1 })).resolves.toBeUndefined();
  });
});

/**
 * « Enregistrer » sur un report seul suspend la validation d'office
 * (`SCORE_DISPUTE_LOCK.md` § Arbitre et report seul, décision du 2026-10-20).
 */
describe("adminSaveMatchScores — suspension de la validation d'office", () => {
  it("suspend la validation d'un report seul et le rend (maps)", async () => {
    const { conn, writes, pauses } = fakeConnection({ singleReport: true });

    await expect(adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 })).resolves.toEqual({ saved: expect.objectContaining({ id: 10 }), paused: true, pausedNow: true });

    expect(writes).toHaveLength(1);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].params).toEqual([10]);
    // Une seule instruction, table seule (MariaDB), sur la ligne déjà verrouillée.
    expect(pauses[0].sql).toContain("SET m.score_validation_paused_at = NOW()");
    expect(pauses[0].sql).toContain("AND m.status = 'AWAITING_CONFIRMATION'");
    expect(pauses[0].sql).toContain("AND m.winner_team_id IS NULL");
    expect(pauses[0].sql).toContain(SINGLE_REPORT_SQL);
    expect(pauses[0].sql).not.toMatch(/JOIN/);
  });

  it("lit l'état d'avant sous le verrou du match, et ne dit « posée maintenant » qu'une fois", async () => {
    const { conn } = fakeConnection({ singleReport: true, alreadyPaused: true });

    await expect(adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 })).resolves.toEqual({
      saved: expect.objectContaining({ id: 10 }),
      paused: true,
      pausedNow: false,
    });
  });

  it("suspend aussi sur un forfait noté sans trancher", async () => {
    const { conn, pauses } = fakeConnection({ singleReport: true });

    await expect(adminSaveMatchScores(conn, 10, { forfeitTeamId: 200 })).resolves.toEqual({ saved: expect.objectContaining({ id: 10 }), paused: true, pausedNow: true });
    expect(pauses).toHaveLength(1);
  });

  it("ne suspend rien sans report seul (aucune proposition, ou litige)", async () => {
    const { conn, pauses } = fakeConnection({ singleReport: false });

    await expect(adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 })).resolves.toEqual({ saved: expect.objectContaining({ id: 10 }), paused: false, pausedNow: false });
    // Tentée, mais sa condition ne retient pas la ligne : un litige garde son escalade.
    expect(pauses).toHaveLength(1);
  });

  it("ne suspend rien quand l'enregistrement est refusé", async () => {
    const { conn, pauses } = fakeConnection({ winnerTeamId: 100, singleReport: true });

    await expect(adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 2), userId: 1 })).rejects.toThrow(
      "MATCH_ALREADY_COMPLETED",
    );
    expect(pauses).toHaveLength(0);
  });

  it("« Valider le résultat » ne pose aucune suspension : il tranche", async () => {
    const { conn, pauses } = fakeConnection({ singleReport: true });

    await adminResolveMatch(conn, 10, { maps: mapsFor(1, 2), userId: 1 });
    expect(pauses).toHaveLength(0);
  });
});

// ERREUR.txt EF-15 : la sauvegarde rend la ligne lue sous verrou (plus de
// relecture côté publication), lit les règles du tournoi une seule fois, et
// n'efface les maps FINAL que s'il y en a.
describe("adminSaveMatchScores — allers-retours", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("adminSave_nominal_returnsMatchRowReadUnderLock", async () => {
    const { conn } = fakeConnection();

    const result = await adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 });

    expect(result.saved).toEqual(expect.objectContaining({ id: 10, tournament_id: 1, team1_id: 100, team2_id: 200 }));
  });

  it("adminSave_refereeScheduling_readOnceWithMatchRules", async () => {
    const { conn, statements } = fakeConnection({ refereeScheduling: true, launchedAt: new Date() });

    await adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 });

    expect(statements.filter((sql) => sql.includes("FROM bg_tournaments"))).toHaveLength(1);
    expect(statements.some((sql) => sql.startsWith("SELECT referee_scheduling"))).toBe(false);
  });

  it("adminSave_noFinalMapsYet_insertsWithoutDelete", async () => {
    const { conn, statements } = fakeConnection();

    await adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 });

    const probe = statements.findIndex((sql) => sql.startsWith("SELECT id, map_number, replay_code, team1_score, team2_score FROM bg_match_maps"));
    expect(probe).toBeGreaterThan(-1);
    expect(statements[probe]).not.toMatch(/FOR UPDATE|LOCK IN SHARE MODE/);
    expect(statements.some((sql) => sql.startsWith("DELETE FROM bg_match_maps"))).toBe(false);
    expect(statements.some((sql) => sql.startsWith("INSERT INTO bg_match_maps"))).toBe(true);
  });

  // Revue perf #542 : saisie map par map — le jeu qui s'allonge n'insère que
  // la nouvelle map, sans lecture verrouillante, effacement ni mise à jour du
  // jeu (aucun verrou d'intervalle sur le match voisin).
  it("adminSave_finalMapsGrowing_insertsOnlyNewMap", async () => {
    const { conn, statements } = fakeConnection({ finalMaps: mapsFor(1, 0) });

    await adminSaveMatchScores(conn, 10, { maps: mapsFor(2, 0), userId: 1 });

    const mapWrites = statements.filter((sql) => /^(INSERT INTO|UPDATE|DELETE FROM) bg_match_maps/.test(sql));
    expect(mapWrites).toHaveLength(1);
    expect(mapWrites[0]).toMatch(/^INSERT INTO bg_match_maps /);
    expect(statements.some((sql) => /FROM bg_match_maps .*FOR UPDATE$/.test(sql))).toBe(false);
  });

  it("adminSave_finalMapsShrinking_deletesExtraMapsByPrimaryKey", async () => {
    const { conn, statements } = fakeConnection({ finalMaps: mapsFor(3, 0) });

    await adminSaveMatchScores(conn, 10, { maps: mapsFor(1, 0), userId: 1 });

    expect(statements).toContain("DELETE FROM bg_match_maps WHERE id IN (?, ?)");
    expect(statements.some((sql) => sql.startsWith("INSERT INTO bg_match_maps"))).toBe(false);
  });

  it("adminSave_forfeitOverExistingMaps_clearsWithoutInserting", async () => {
    const { conn, statements } = fakeConnection({ finalMaps: mapsFor(2, 0) });

    await adminSaveMatchScores(conn, 10, { forfeitTeamId: 200 });

    expect(statements.some((sql) => sql.startsWith("DELETE FROM bg_match_maps"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("INSERT INTO bg_match_maps"))).toBe(false);
  });
});
