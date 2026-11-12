/**
 * Ce que la page d'un signalement conclut de la réponse de `/api/reports/[id]`
 * (`app/(secured)/signalements/[id]/page.tsx`).
 *
 * - `missing` : le serveur répond que ce signalement n'existe pas ou ne
 *   concerne pas le lecteur (404, 403, tout autre 4xx définitif) —
 *   réessayer n'y change rien ;
 * - `error` : une panne passagère (erreur réseau, 5xx pendant un déploiement,
 *   429) — la page propose de réessayer plutôt que de dire « introuvable » ;
 * - `signedOut` : 401, la session a expiré entre-temps — ni « introuvable »,
 *   ni « Réessayer » (qui reviendrait en boucle sur le même refus) : la page
 *   propose de se reconnecter, retour à ce signalement.
 */
export type ConcernedReportLoadFailure = "missing" | "error" | "signedOut";

/** `status` : le code HTTP, ou `null` quand la requête n'a pas abouti (réseau). */
export function concernedReportLoadFailure(status: number | null): ConcernedReportLoadFailure {
  if (status === 401) return "signedOut";
  if (status === null || status >= 500 || status === 429 || status === 408) return "error";
  // Tout autre refus 4xx est définitif : réessayer n'y change rien.
  return status >= 400 ? "missing" : "error";
}
