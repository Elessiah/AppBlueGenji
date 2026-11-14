/**
 * Le dialogue de certification de `/profil` (`DiscordVerificationDialog`)
 * **signale lui-même** qu'il est ouvert : le guet d'un refus de « Ne plus voir »
 * (`noticeOnceModalsClosed`) attend jusqu'à dix minutes quand ce dialogue a été
 * ouvert depuis le refus, plutôt que de le reconnaître à un identifiant du DOM
 * qu'un renommage ferait taire.
 *
 * État du document (module client) : il survit à la navigation client entre la
 * fiche du tournoi et le profil.
 */

let openCount = 0;
let lastOpenedAt = Number.NEGATIVE_INFINITY;

/**
 * Le dialogue s'ouvre : à appeler au montage. Renvoie la fermeture, à appeler
 * au démontage (une seule fois comptée, même appelée deux fois).
 */
export function markProfileCertificationDialogOpen(now: number = Date.now()): () => void {
  openCount += 1;
  lastOpenedAt = now;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    openCount -= 1;
  };
}

/** Le dialogue est-il ouvert, ou l'a-t-il été depuis l'instant `since` ? */
export function profileCertificationDialogOpenedSince(since: number): boolean {
  return openCount > 0 || lastOpenedAt >= since;
}

/** Remet le signal à zéro. Réservé aux tests. */
export function resetProfileCertificationDialogSignal(): void {
  openCount = 0;
  lastOpenedAt = Number.NEGATIVE_INFINITY;
}
