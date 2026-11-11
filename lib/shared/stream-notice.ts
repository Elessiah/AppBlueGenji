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
 * Aucune case à cocher : depuis la version 11 des conditions d'utilisation
 * (décision de l'utilisateur D50, 2026-11-11), être diffusé et enregistré sous
 * son pseudo fait partie du tournoi — exécution du service, comme le pseudo
 * d'un joueur dans l'annonce #live d'un tournoi individuel (décision du
 * 2026-10-14). Il n'y a plus d'opposition par « nom neutre » : ne pas paraître
 * revient à ne pas participer. Jusqu'à la version 10, la base était l'intérêt
 * légitime de l'association, avec ce droit d'opposition.
 */

import { REPORT_FORM_NAME } from "./legal-contact";

/** Ancre de la politique de confidentialité qui détaille la retransmission. */
export const STREAM_NOTICE_PRIVACY_PATH = "/rgpd#retransmission";

/** Ce qu'une retransmission montre d'un joueur, et ce qu'elle ne montre jamais. */
export const STREAM_NOTICE_SHOWN =
  "Y apparaissent le pseudo des joueurs, le nom de leur équipe et leurs résultats et performances en jeu — jamais de webcam ni de chat vocal.";

/**
 * La base de la diffusion (version 11 des conditions, D50) : elle fait partie
 * du tournoi, au titre de l'exécution du service — plus d'opposition par « nom
 * neutre ».
 */
export const STREAM_NOTICE_SERVICE =
  "La diffusion et l'enregistrement d'un match sous le pseudo de ses joueurs font partie du tournoi auquel ils participent (exécution du service) : un joueur qui ne veut pas y paraître n'y participe pas.";

/**
 * Le reste de la retransmission (décision de l'utilisateur D53, 2026-11-11) :
 * ce qui touche les casters, les liens publiés et l'alerte AutoMod relève aussi
 * de l'exécution du service — plus d'intérêt légitime ni de droit d'opposition.
 */
export const STREAM_NOTICE_CASTERS =
  "Relèvent de même de l'exécution du service : la voix, le pseudo et le lien de la chaîne du caster qui s'inscrit sur un match, publiés avec ce match, et son réglage du passage à l'antenne ; les liens de diffusion et de rediffusion publiés sur le site ; et la copie du texte d'une annonce #live que la modération automatique de Discord (AutoMod) bloque ou signale, envoyée au salon d'alertes des modérateurs du serveur, où elle reste : à la suppression du compte du joueur, le site en avertit le staff, sans nommer le joueur, et les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver ; elle n'est pas supprimée sur demande autrement.";

/**
 * L'annonce #live dans les conditions d'utilisation (décision du 2026-10-14 :
 * ne pas y être nommé = ne pas s'inscrire). Un message par soirée
 * (`lib/server/tournaments/live-announcements.ts`) liste aussi les matchs
 * programmés avant leur début et les matchs terminés : dit depuis la version 7
 * des conditions.
 */
export const STREAM_NOTICE_LIVE =
  `Les matchs diffusés sont annoncés dans le salon #live du Discord de l'association, par un message de soirée qui liste chaque match à son heure — avant son début si sa diffusion doit s'ouvrir à son heure de début dans la soirée, pendant sa diffusion, puis une fois terminé, avec son score — et qui nomme les équipes et, en tournoi individuel, les joueurs par leur pseudo public. Cette annonce fait elle aussi partie du tournoi individuel auquel le joueur s'inscrit (exécution du service) : un joueur qui ne veut pas y être nommé ne s'inscrit pas au tournoi individuel. Une annonce est supprimée sur demande, par le bouton « ${REPORT_FORM_NAME} », catégorie RGPD.`;

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
    ? " Au début d'un match diffusé — et avant, si sa diffusion doit s'ouvrir à son heure de début dans la soirée, puis une fois terminé —, ton pseudo est aussi annoncé sur le Discord de l'association : cette annonce fait elle aussi partie du tournoi, et elle est supprimée sur demande."
    : " Au début d'un match diffusé — et avant, si sa diffusion doit s'ouvrir à son heure de début dans la soirée, puis une fois terminé —, le nom de ton équipe est aussi annoncé sur le Discord de l'association.";
  return `Les matchs de ce tournoi peuvent être diffusés en direct et enregistrés, avec ${shown} — jamais de webcam ni de chat vocal. Cette diffusion fait partie du tournoi : y jouer, c'est y paraître sous ton pseudo.${discord}`;
}

/**
 * La ligne **visible** près du bouton d'inscription (information en couches,
 * `docs/features/INFO_HINTS.md`) : l'essentiel — diffusion, enregistrement — et
 * ce qu'il emporte (y jouer, c'est y paraître). La mention entière (`registrationStreamNotice`) passe
 * derrière le bouton « i » de la fiche, et reste lue en entier dans la
 * confirmation de l'inscription.
 */
export const REGISTRATION_STREAM_NOTICE_SHORT =
  "Les matchs peuvent être diffusés en direct et enregistrés : y jouer, c'est y paraître sous ton pseudo.";

/** Libellé du lien qui suit la mention de `registrationStreamNotice`. */
export const REGISTRATION_STREAM_NOTICE_LINK_LABEL = "En savoir plus";
