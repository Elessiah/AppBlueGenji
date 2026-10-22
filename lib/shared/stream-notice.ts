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
 * un consentement — le joueur est informé et garde son droit d'opposition. Seul
 * le pseudo d'un joueur dans l'annonce #live d'un tournoi individuel repose sur
 * l'exécution du service (décision du 2026-10-14) : il n'a pas de nom neutre.
 */

/** Ancre de la politique de confidentialité qui détaille la retransmission. */
export const STREAM_NOTICE_PRIVACY_PATH = "/rgpd#retransmission";

/** Ce qu'une retransmission montre d'un joueur, et ce qu'elle ne montre jamais. */
export const STREAM_NOTICE_SHOWN =
  "Y apparaissent le pseudo des joueurs, le nom de leur équipe et leurs résultats et performances en jeu — jamais de webcam ni de chat vocal.";

/** Le droit d'opposition, et la façon de l'exercer. */
export const STREAM_NOTICE_OBJECTION =
  "Chaque joueur peut s'y opposer : il apparaît alors sous un nom neutre. La demande se fait par le bouton « Signaler un problème », catégorie RGPD.";

/**
 * L'annonce #live dans les conditions d'utilisation : le nom neutre ne la
 * couvre pas (décision du 2026-10-14 : s'y opposer = ne pas s'inscrire).
 */
export const STREAM_NOTICE_LIVE =
  "Au début d'un match diffusé, une annonce publiée dans le salon #live du Discord de l'association nomme les équipes et, en tournoi individuel, les joueurs par leur pseudo public. Cette annonce fait partie du tournoi individuel auquel le joueur s'inscrit (exécution du service, et non intérêt légitime) : le nom neutre ne s'y applique pas, et un joueur qui ne veut pas y être nommé ne s'inscrit pas au tournoi individuel. Une annonce est supprimée sur demande, par le même bouton.";

/**
 * Mention courte affichée près de l'inscription à un tournoi, suivie d'un lien
 * vers `STREAM_NOTICE_PRIVACY_PATH`. En individuel, l'engagé n'a pas d'équipe :
 * la mention ne lui en prête pas.
 */
export function registrationStreamNotice(solo: boolean): string {
  const shown = solo ? "ton pseudo et tes résultats en jeu" : "ton pseudo, le nom de ton équipe et tes résultats en jeu";
  // L'annonce dans #live nomme les équipes, et le joueur d'une entrée
  // individuelle par son pseudo public (exception décidée le 2026-10-14) :
  // chacun lit ce qui, de lui, part sur le Discord.
  const discord = solo
    ? " Au début d'un match diffusé, ton pseudo est aussi annoncé sur le Discord de l'association : cette annonce fait partie du tournoi auquel tu t'inscris, le nom neutre ne s'y applique pas, et elle est supprimée sur demande."
    : " Au début d'un match diffusé, le nom de ton équipe est aussi annoncé sur le Discord de l'association.";
  return `Les matchs de ce tournoi peuvent être diffusés en direct et enregistrés, avec ${shown} — jamais de webcam ni de chat vocal. Tu peux t'y opposer et apparaître sous un nom neutre.${discord}`;
}

/**
 * La ligne **visible** près du bouton d'inscription (information en couches,
 * `docs/features/INFO_HINTS.md`) : l'essentiel — diffusion, enregistrement — et
 * le droit d'opposition. La mention entière (`registrationStreamNotice`) passe
 * derrière le bouton « i » de la fiche, et reste lue en entier dans la
 * confirmation de l'inscription.
 */
export const REGISTRATION_STREAM_NOTICE_SHORT =
  "Les matchs peuvent être diffusés en direct et enregistrés. Tu peux t'y opposer et apparaître sous un nom neutre.";

/** Libellé du lien qui suit la mention de `registrationStreamNotice`. */
export const REGISTRATION_STREAM_NOTICE_LINK_LABEL = "En savoir plus";
