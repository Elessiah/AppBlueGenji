/**
 * Durées et seuils juridiques cités par plusieurs textes — module de
 * **constantes seules**.
 *
 * `lib/shared/privacy-changes.ts` est chargé par la modale des changements,
 * rendue sur chaque page : importer le registre (`processing-register.ts`) ou
 * les conditions d'utilisation (`terms-of-use.ts`) pour y lire un nombre ferait
 * télécharger tout leur texte à chaque visiteur. Les deux modules réexportent
 * ces constantes : on peut les importer de l'un ou de l'autre.
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
