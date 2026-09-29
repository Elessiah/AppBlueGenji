/**
 * Qui édite le site et comment le joindre — module pur.
 *
 * L'éditeur et responsable du traitement est l'**association**, sous sa
 * dénomination statutaire. On la joint par :
 *
 * - son **courriel** et son **téléphone**, publiés sur `/mentions-legales` et
 *   `/rgpd`, mais **jamais en clair** : une adresse ou un numéro écrit dans une
 *   page (ou dans ce dépôt, public) est moissonné par les robots. Les valeurs
 *   vivent encodées dans `lib/shared/obfuscated-contact.ts` et ne se lisent qu'au
 *   clic (`ProtectedContact`) ;
 * - le formulaire **« Signaler un problème »** (pied de page de toutes les
 *   pages), dont les catégories « RGPD » et « Hébergeur » trient les demandes
 *   (`lib/shared/content-reports.ts`) ;
 * - le **tag Discord** de l'hébergeur technique du site, qu'on ajoute en ami.
 *
 * Un test balaie les sources et refuse tout courriel ou numéro en clair.
 */

/** Dénomination statutaire de l'association (statuts, art. 1er). */
export const ASSOCIATION_NAME = "Bluegenji Esport";

/** Siège social de l'association, tel que le publient les mentions légales. */
export const ASSOCIATION_SEAT = "4 impasse des Cyprès, 51210 Janvilliers, France";

/**
 * Tag Discord de l'hébergeur technique du site, joignable pour les questions
 * techniques et de données. Il n'est **pas** le responsable du traitement —
 * c'est l'association — ni le directeur de la publication — c'est son président.
 */
export const LEGAL_CONTACT_DISCORD = "elessiah";

/** Intitulé du bouton qui ouvre le formulaire de signalement. */
export const REPORT_FORM_NAME = "Signaler un problème";

/**
 * Contact RGPD en une ligne, pour le registre des traitements et son export
 * CSV — qui ne savent pas révéler une adresse au clic : ils renvoient donc aux
 * pages qui le font plutôt que de l'écrire.
 */
export const RGPD_CONTACT_LINE = `Courriel et téléphone de l'association (mentions légales du site) — formulaire « ${REPORT_FORM_NAME} » du site (pied de page), catégorie « RGPD » — ou Discord : ${LEGAL_CONTACT_DISCORD} (hébergeur technique)`;

/**
 * Langues dans lesquelles l'association reçoit les demandes des autorités à
 * son point de contact unique (règlement européen sur les services
 * numériques, art. 11.3 : une langue officielle de l'État d'établissement et,
 * le cas échéant, une langue largement comprise). Affichées par les mentions
 * légales, section « Point de contact des autorités ».
 */
export const AUTHORITY_CONTACT_LANGUAGES: readonly string[] = ["français", "anglais"];
