/**
 * Têtes de série **figées au coup d'envoi** d'un tournoi seedé par le
 * classement du site.
 *
 * Au lancement, le moteur range les engagées par `loadEntrantsBySiteRanking`
 * et écrit le rang obtenu (`seed`, 1 = meilleure cote) dans sa table d'état :
 * `bg_swiss_standings` / `bg_survival_standings` (`phase_id = 0`),
 * `bg_endurance_standings`, ou `bg_tournament_phase_teams` de la première
 * phase jouée en multi-phases. C'est ce rang-là, et non la cote du moment
 * (qui bouge avec les matchs), qui a fait le tirage : on le relit, on ne
 * reclasse jamais.
 *
 * La colonne `bg_tournament_registrations.seed` n'y garde que l'ordre
 * d'inscription — d'où cette lecture, faite par la carte live de l'accueil.
 * L'instantané d'un tournoi, qui a déjà chargé ces classements, applique la
 * même règle en mémoire (`frozenSeedsOf`, `lib/shared/seeding.ts`).
 * Voir `docs/features/SEEDING_ORDER.md`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { TournamentFormat } from "@/lib/shared/types";

type SeedRow = RowDataPacket & { team_id: number; seed: number };

const SINGLE_TABLE_SQL: Partial<Record<TournamentFormat, string>> = {
  SWISS: `SELECT team_id, seed FROM bg_swiss_standings
          WHERE tournament_id = ? AND phase_id = 0`,
  SURVIVAL: `SELECT team_id, seed FROM bg_survival_standings
             WHERE tournament_id = ? AND phase_id = 0`,
  BG_SURVIE: `SELECT team_id, seed FROM bg_endurance_standings
              WHERE tournament_id = ?`,
};

// Première phase **peuplée** : une phase sautée n'a aucune équipe, et les
// suivantes sont seedées par le rang de la phase écoulée, pas par le classement.
const FIRST_PHASE_SQL = `
  SELECT pt.team_id, pt.seed
  FROM bg_tournament_phase_teams pt
  JOIN bg_tournament_phases p ON p.id = pt.phase_id
  WHERE pt.tournament_id = ?
    AND p.position = (
      SELECT MIN(p2.position)
      FROM bg_tournament_phase_teams pt2
      JOIN bg_tournament_phases p2 ON p2.id = pt2.phase_id
      WHERE pt2.tournament_id = ?
    )`;

/**
 * `teamId → seed` figé au coup d'envoi ; vide avant le lancement ou pour un
 * format qui ne seede pas depuis le classement (élimination). Un seed nul
 * (valeur par défaut de colonne) est ignoré : l'engagée est alors sans rang.
 */
export async function loadFrozenRankingSeeds(
  executor: Pick<PoolConnection, "execute">,
  tournamentId: number,
  format: TournamentFormat,
): Promise<Map<number, number>> {
  const sql = format === "MULTI" ? FIRST_PHASE_SQL : SINGLE_TABLE_SQL[format];
  if (!sql) return new Map();
  const params = format === "MULTI" ? [tournamentId, tournamentId] : [tournamentId];
  const [rows] = await executor.execute<SeedRow[]>(sql, params);
  const seeds = new Map<number, number>();
  for (const row of rows) {
    const seed = Number(row.seed);
    if (seed > 0) seeds.set(Number(row.team_id), seed);
  }
  return seeds;
}
