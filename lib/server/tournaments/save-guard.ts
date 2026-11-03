/**
 * Garde d'« Enregistrer » (`docs/features/SCORE_DISPUTE_LOCK.md`), à part
 * d'`./admin` : la couche publique (`./index`) la joue avant la transaction,
 * le moteur la rejoue sous verrou.
 */

/**
 * Un match qu'« Enregistrer » peut noter : ses deux engagés en place, et pas
 * encore tranché (sur le **statut** : un match nul est terminé sans vainqueur).
 * Une seule règle pour la lecture préalable, hors transaction
 * (`adminSaveMatchScoresPublic`), et pour la lecture sous verrou.
 *
 * @throws `MATCH_NOT_READY`, `MATCH_ALREADY_COMPLETED`
 */
export function assertMatchSavable(match: {
  team1_id: number | null;
  team2_id: number | null;
  status: string;
}): void {
  if (match.team1_id === null || match.team2_id === null) throw new Error("MATCH_NOT_READY");
  if (match.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
}
