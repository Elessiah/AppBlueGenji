/**
 * Durées et seuils juridiques cités par plusieurs textes — module de
 * **constantes seules**.
 *
 * `lib/shared/privacy-changes.ts` est chargé par la modale des changements,
 * rendue sur chaque page : importer le registre (`processing-register.ts`) ou
 * les conditions d'utilisation (`terms-of-use.ts`) pour y lire un nombre ferait
 * télécharger tout leur texte à chaque visiteur. `terms-of-use.ts` réexporte
 * `SITE_MINIMUM_AGE`, `processing-register.ts` les deux durées du registre.
 */

/**
 * Âge minimum pour créer un compte. Distinct de l'âge d'adhésion à
 * l'association, que fixent ses statuts : un compte n'est pas une adhésion.
 * Aucun contrôle technique ne le tient — le site ne recueille pas de date de
 * naissance, seulement une majorité déclarée (`isAdult`), qui ne dit rien d'un
 * seuil à 15 ans : la condition est déclarative, acceptée avec ces conditions.
 */
export const SITE_MINIMUM_AGE = 15;

/**
 * Tickets du portail de support (Spiceworks) : supprimés un mois après leur
 * clôture, par l'association (décision de l'association, 2026-09-30).
 */
export const SUPPORT_TICKET_RETENTION_MONTHS = 1;

/**
 * Journaux d'accès du serveur web (nginx) : 14 jours. Le défaut de logrotate
 * sous Debian (`rotate 14`) en garde jusqu'à quinze — le journal courant plus
 * quatorze archives —, d'où `rotate 13`. La configuration du serveur n'est pas
 * versionnée ici : `docs/DEPLOYMENT.md` dit le réglage à poser en production.
 */
export const WEB_ACCESS_LOG_RETENTION_DAYS = 14;

/**
 * Ce que note le journal d'accès nginx (format `combined` par défaut), dit une
 * fois pour le registre (T17), `/rgpd`, les mentions légales et l'annonce du
 * changement : trois rédactions en avaient donné trois listes différentes.
 */
export const WEB_ACCESS_LOG_FIELDS =
  "adresse IP, date et heure, page demandée, code de réponse, taille de la réponse, page d'origine et navigateur";

/**
 * Durées appliquées par le **bot** (autre dépôt), recopiées ici pour la modale
 * des changements ; `processing-register.ts` les réexporte avec les autres
 * durées du bot, dont il dit la source.
 *
 * - fil d'activité (`FeedEvent`) : `FEED_EVENT_RETENTION_DAYS` de
 *   `blueGenjiBot/src/privacy/retentionPeriods.ts` ;
 * - salon de journal privé du staff et messages privés du bot au titulaire :
 *   `STAFF_LOG_RETENTION_DAYS` (un an), même fichier.
 */
export const BOT_FEED_EVENT_RETENTION_DAYS = 30;
export const BOT_STAFF_LOG_RETENTION_DAYS = 365;
