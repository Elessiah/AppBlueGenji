/**
 * Marches du podium du site (`lib/shared/podium-tiers.ts`), calculées une fois
 * pour toutes les pages.
 *
 * Le podium est **celui de l'onglet « Général » de `/classement`** : même
 * chargeur (`loadTeamRanking({ includeUnplayed: true })`), même tri
 * (`compareRankedTeams`), donc jamais deux podiums qui se contredisent. Les
 * entrées solo en sont écartées par ce chargeur : elles ne montent jamais sur
 * le podium (voir `docs/features/PODIUM_TIERS.md`).
 *
 * Mutualisé dans le cache du classement (`ranking-cache`) : même durée de vie,
 * et surtout **même invalidation** — tout score qui tombe oublie l'entrée avec
 * le classement. Au plus une requête propre (les membres des trois équipes) par
 * fenêtre, le classement lui-même étant déjà mutualisé.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { cachedRanking } from "./ranking-cache";
import { loadTeamRanking } from "./ranking-service";
import { buildPodiumTiers, EMPTY_PODIUM_TIERS, podiumTeamIds, type PodiumTiers } from "@/lib/shared/podium-tiers";

type MembershipRow = RowDataPacket & { user_id: number; team_id: number };

async function computePodiumTiers(): Promise<PodiumTiers> {
  const ranking = await loadTeamRanking({ includeUnplayed: true });
  const rankedIds = ranking.map((row) => row.teamId);
  const top = podiumTeamIds(rankedIds);
  if (top.length === 0) return EMPTY_PODIUM_TIERS;

  const db = await getDatabase();
  const [rows] = await db.execute<MembershipRow[]>(
    // Un compte supprimé (anonymisé) garde son appartenance, pas son éclat.
    `SELECT tm.user_id, tm.team_id
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.left_at IS NULL AND u.is_deleted = 0
       AND tm.team_id IN (${top.map(() => "?").join(", ")})`,
    top,
  );
  return buildPodiumTiers(
    rankedIds,
    rows.map((row) => ({ userId: Number(row.user_id), teamId: Number(row.team_id) })),
  );
}

/**
 * Les marches du podium, mutualisées. Ne lève jamais : une panne de lecture
 * rend une page sans marche plutôt qu'une page tombée (mise en page racine).
 */
export async function loadPodiumTiers(): Promise<PodiumTiers> {
  try {
    return await cachedRanking("podium-tiers", computePodiumTiers);
  } catch (error) {
    console.error("[podium-tiers] lecture impossible", error);
    return EMPTY_PODIUM_TIERS;
  }
}
