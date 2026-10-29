/**
 * Ce que la page d'un signalement conclut de la réponse de `/api/reports/[id]`
 * (`app/(secured)/signalements/[id]/page.tsx`).
 *
 * - `missing` : le serveur répond que ce signalement n'existe pas ou ne
 *   concerne pas le lecteur (404, 403, 401) — réessayer n'y change rien ;
 * - `error` : une panne passagère (erreur réseau, 5xx pendant un déploiement,
 *   429) — la page propose de réessayer plutôt que de dire « introuvable ».
 */
export type ConcernedReportLoadFailure = "missing" | "error";

/** `status` : le code HTTP, ou `null` quand la requête n'a pas abouti (réseau). */
export function concernedReportLoadFailure(status: number | null): ConcernedReportLoadFailure {
  return status === 404 || status === 403 || status === 401 ? "missing" : "error";
}
