/**
 * Comment joindre le responsable du site — module pur.
 *
 * Le site ne publie **aucune adresse électronique** de contact : une adresse
 * écrite dans une page (ou dans ce dépôt, public) est moissonnée par les robots
 * et finit en cible de spam. Restent deux canaux, écrits une fois ici et repris
 * par toutes les pages qui disent « nous contacter » (`/rgpd`, `/accessibilite`,
 * le registre des traitements, les pages légales du bot) :
 *
 * - le **tag Discord** du responsable, qu'on ajoute en ami ;
 * - le formulaire **« Signaler un problème »** (pied de page de toutes les
 *   pages), dont les catégories « RGPD » et « Hébergeur » reçoivent ce que
 *   l'adresse recevait (`lib/shared/content-reports.ts`).
 *
 * Un test balaie les sources et refuse le retour d'une adresse personnelle.
 */

/** Tag Discord du responsable de traitement et de publication. */
export const LEGAL_CONTACT_DISCORD = "elessiah";

/** Intitulé du bouton qui ouvre le formulaire de signalement. */
export const REPORT_FORM_NAME = "Signaler un problème";

/** Contact RGPD en une ligne, pour le registre des traitements et son export. */
export const RGPD_CONTACT_LINE = `Discord : ${LEGAL_CONTACT_DISCORD} — ou formulaire « ${REPORT_FORM_NAME} » du site (pied de page), catégorie « RGPD »`;
