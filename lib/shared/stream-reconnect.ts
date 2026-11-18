/**
 * Trame « relis ta session » du flux d'un tournoi
 * (`docs/features/ADMIN_PLAYER_VIEW.md`, `REALTIME_REFRESH.md`).
 *
 * Le serveur l'envoie juste avant de fermer un flux dont le contexte du
 * lecteur a changé (vue joueur basculée, équipe quittée, rôle changé), ou
 * comme seul contenu d'un flux qui s'ouvrait pendant ce changement. Le client
 * rouvre alors le flux **sur-le-champ**, sans témoin « Hors ligne » ni sondage
 * de secours : ce n'est pas une panne. Elle ne porte aucune donnée.
 */
export const STREAM_RECONNECT_DATA = '{"type":"reconnect"}';

/** La donnée d'une trame reçue est-elle la demande de reconnexion ? */
export function isStreamReconnectData(raw: string): boolean {
  return raw === STREAM_RECONNECT_DATA;
}
