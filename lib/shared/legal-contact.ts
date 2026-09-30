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
 * - la **personne à contacter pour les demandes relatives aux données** :
 *   l'hébergeur du site (`DATA_CONTACT_NAME`), par courriel et téléphone —
 *   encodés eux aussi, révélés au clic sur `/rgpd` et `/mentions-legales`.
 *   Ce n'est **pas** un délégué à la protection des données au sens de
 *   l'article 37 du RGPD, et aucun écran ne doit l'appeler ainsi :
 *   l'association reste responsable du traitement ;
 * - le **tag Discord** de ce même hébergeur, qu'on ajoute en ami, pour les
 *   questions techniques — **pas** comme canal des demandes relatives aux
 *   données, qui passent par le courriel, le téléphone ou le formulaire
 *   catégorie « RGPD ».
 *
 * Un test balaie les sources et refuse tout courriel ou numéro en clair.
 */

import { SITE_HOST } from "@/lib/shared/site-host";

/** Dénomination statutaire de l'association (statuts, art. 1er). */
export const ASSOCIATION_NAME = "Bluegenji Esport";

/** Siège social de l'association, tel que le publient les mentions légales. */
export const ASSOCIATION_SEAT = "4 impasse des Cyprès, 51210 Janvilliers, France";

/**
 * Tag Discord de l'hébergeur technique du site, joignable pour les questions
 * techniques. Il n'est **pas** le responsable du traitement — c'est
 * l'association —, ni le directeur de la publication — c'est son président —,
 * ni le canal des demandes relatives aux données (courriel et téléphone de
 * `DATA_CONTACT_NAME`, ou formulaire catégorie « RGPD »).
 */
export const LEGAL_CONTACT_DISCORD = "elessiah";

/** Intitulé du bouton qui ouvre le formulaire de signalement. */
export const REPORT_FORM_NAME = "Signaler un problème";

/**
 * Personne à contacter pour les demandes relatives aux données : l'hébergeur
 * du site, désigné par l'association **en tant qu'hébergeur** : nom, courriel
 * et téléphone sont ceux de `SITE_HOST`, qui ne se remplacent qu'ensemble.
 * Changer d'hébergeur oblige donc à revoir cette désignation — c'est une
 * décision de l'association, que ce module ne prend pas à sa place. Jamais « DPO » ni « délégué » : ce
 * titre désigne la fonction de l'article 37 du RGPD, qui n'est pas la sienne.
 */
export const DATA_CONTACT_NAME = SITE_HOST.name;

/** Qualité sous laquelle `DATA_CONTACT_NAME` est présenté. */
export const DATA_CONTACT_ROLE = "hébergeur technique du site";

/** Intitulé du rôle, tel que les pages l'écrivent. */
export const DATA_CONTACT_LABEL = "Personne à contacter pour vos demandes relatives à vos données";

/**
 * Contact RGPD en une ligne, pour le registre des traitements et son export
 * CSV — qui ne savent pas révéler une adresse au clic : ils renvoient donc aux
 * pages qui le font plutôt que de l'écrire.
 */
export const RGPD_CONTACT_LINE = `Demandes relatives aux données : ${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE}, chargé par l'association de les recevoir — courriel et téléphone (politique de confidentialité et mentions légales du site) —, ou formulaire « ${REPORT_FORM_NAME} » du site (pied de page), catégorie « RGPD » ; l'association : courriel et téléphone (mentions légales du site)`;

/**
 * Langues dans lesquelles l'association reçoit les demandes des autorités à
 * son point de contact unique (règlement européen sur les services
 * numériques, art. 11.3 : une langue officielle de l'État d'établissement et,
 * le cas échéant, une langue largement comprise). Affichées par les mentions
 * légales, section « Point de contact des autorités ».
 */
export const AUTHORITY_CONTACT_LANGUAGES: readonly string[] = ["français", "anglais"];
