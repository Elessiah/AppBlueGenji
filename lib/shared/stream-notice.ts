/**
 * Information sur la retransmission des matchs — module pur.
 *
 * Un match de tournoi peut être diffusé en direct et enregistré (registre,
 * T16). Le joueur en est informé **au moment où il s'engage** (bouton
 * d'inscription d'un tournoi, en équipe comme en individuel), dans les
 * conditions d'utilisation et sur `/rgpd#retransmission`. Les trois écrans
 * lisent les mêmes phrases : écrites à part, elles finiraient par annoncer des
 * données différentes.
 *
 * Aucune case à cocher : la base est l'intérêt légitime de l'association, pas
 * un consentement — le joueur est informé et garde son droit d'opposition.
 */

/** Ancre de la politique de confidentialité qui détaille la retransmission. */
export const STREAM_NOTICE_PRIVACY_PATH = "/rgpd#retransmission";

/** Ce qu'une retransmission montre d'un joueur, et ce qu'elle ne montre jamais. */
export const STREAM_NOTICE_SHOWN =
  "Seuls y apparaissent le pseudo, le nom d'équipe et les résultats et performances en jeu des joueurs — jamais de webcam ni de chat vocal.";

/** Le droit d'opposition, et la façon de l'exercer. */
export const STREAM_NOTICE_OBJECTION =
  "Chaque joueur peut s'y opposer : il apparaît alors sous un nom neutre. La demande se fait par le bouton « Signaler un problème », catégorie RGPD.";

/**
 * Mention courte affichée près de l'inscription à un tournoi, suivie d'un lien
 * vers `STREAM_NOTICE_PRIVACY_PATH`. En individuel, l'engagé n'a pas d'équipe :
 * la mention ne lui en prête pas.
 */
export function registrationStreamNotice(solo: boolean): string {
  const shown = solo ? "ton pseudo et tes résultats en jeu" : "ton pseudo, le nom de ton équipe et tes résultats en jeu";
  return `Les matchs de ce tournoi peuvent être diffusés en direct et enregistrés, avec ${shown} — jamais de webcam ni de chat vocal. Tu peux t'y opposer et apparaître sous un nom neutre.`;
}

/** Libellé du lien qui suit la mention de `registrationStreamNotice`. */
export const REGISTRATION_STREAM_NOTICE_LINK_LABEL = "En savoir plus";
