/**
 * Geste refusé parce qu'un autre envoi tient la section (`useBusyGuard().run`
 * rend `undefined`) : dit en notification neutre plutôt que de laisser une
 * confirmation ouverte sans réaction. Partagé par les outils de gestion
 * (vitrine, signalements, rôles des joueurs), restés en français (D4).
 */
export const BUSY_REFUSED_MESSAGE = "Un autre envoi est en cours, réessaye.";
