/**
 * Conditions générales d'utilisation du site — module pur.
 *
 * Le texte vit ici, à côté de sa **version** : c'est la version qu'un compte
 * accepte, et c'est elle qui dit si une acceptation est encore valable. Une
 * page qui rendrait un texte édité ailleurs pourrait changer sans que personne
 * ait à l'accepter de nouveau ; ici, modifier une règle de fond se fait avec
 * `TERMS_VERSION`, qui redemande l'acceptation à ceux qui en ont besoin.
 *
 * **Quand on accepte** (`TermsAcceptanceContext`) :
 *
 * - à la **création du compte**, depuis la page de connexion — le site n'a pas
 *   de formulaire d'inscription, un compte naît à la première connexion ; la
 *   case est donc posée à l'entrée de `/connexion`, et une connexion par la
 *   suite, case cochée, vaut aussi acceptation (`LOGIN`) ;
 * - à la **création d'une équipe** ;
 * - en **recevant la main sur une équipe** (propriété transférée, rôle de
 *   gérant, équipe fantôme confiée) : celui qui la reçoit n'a rien fait, il
 *   accepte donc au premier passage sur le site ensuite, et la gestion lui est
 *   refusée tant qu'il ne l'a pas fait.
 *
 * Module pur, importable partout.
 */

import { LOGO_QUARANTINE_DAYS } from "./logo-quarantine";

/** Version en vigueur. L'avancer redemande l'acceptation. */
export const TERMS_VERSION = 1;

/** Date d'entrée en vigueur de la version courante (AAAA-MM-JJ). */
export const TERMS_UPDATED_AT = "2026-09-24";

/** Adresse de la page publique des conditions. */
export const TERMS_PATH = "/conditions-utilisation";

/** Où une acceptation a été donnée. */
export type TermsAcceptanceContext = "SIGNUP" | "LOGIN" | "TEAM_CREATION" | "TEAM_MANAGEMENT";

export const TERMS_ACCEPTANCE_CONTEXTS: readonly TermsAcceptanceContext[] = [
  "SIGNUP",
  "LOGIN",
  "TEAM_CREATION",
  "TEAM_MANAGEMENT",
];

export function isTermsAcceptanceContext(value: unknown): value is TermsAcceptanceContext {
  return typeof value === "string" && (TERMS_ACCEPTANCE_CONTEXTS as readonly string[]).includes(value);
}

/**
 * L'acceptation enregistrée couvre-t-elle la version courante ?
 *
 * `null` = jamais acceptées. Une version **plus récente** que la courante (base
 * restaurée sur un code plus ancien) couvre aussi : on ne redemande pas ce qui
 * a déjà été accepté dans une version plus exigeante.
 */
export function coversCurrentTerms(acceptedVersion: number | null | undefined): boolean {
  return typeof acceptedVersion === "number" && acceptedVersion >= TERMS_VERSION;
}

/**
 * Événement de fenêtre qui rouvre la modale d'acceptation : un geste de gestion
 * refusé (`TERMS_ACCEPTANCE_REQUIRED`) la réclame depuis n'importe quel écran.
 */
export const TERMS_REQUIRED_EVENT = "bg:terms-required";

/** Jeton de refus d'un geste de gestion sans acceptation. */
export const TERMS_ACCEPTANCE_REQUIRED = "TERMS_ACCEPTANCE_REQUIRED";

/** Jeton de refus d'une création de compte sans acceptation. */
export const TERMS_REQUIRED = "TERMS_REQUIRED";

/** Formulation de la case, commune à tous les écrans. */
export const TERMS_CHECKBOX_LABEL = "J'ai lu et j'accepte les conditions d'utilisation";

/** Date lisible de la version courante. */
export function formatTermsDate(date: string = TERMS_UPDATED_AT): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface TermsSection {
  id: string;
  title: string;
  /** Paragraphes ; `**gras**` est la seule marque reconnue (`lib/shared/inline-emphasis.ts`). */
  paragraphs: readonly string[];
}

/**
 * Le texte des conditions. Chaque section porte un identifiant d'ancre stable :
 * d'autres écrans (la case du logo, le formulaire de signalement) renvoient à
 * une section précise.
 */
export const TERMS_SECTIONS: readonly TermsSection[] = [
  {
    id: "objet",
    title: "Objet",
    paragraphs: [
      "Les présentes conditions encadrent l'utilisation du site BlueGenji Esport, édité par l'**association Bluegenji Esport** (loi 1901), qui organise des tournois amateurs Overwatch et Marvel Rivals et met à disposition des joueurs des fiches de profil, d'équipe et de tournoi.",
      "Elles complètent le **règlement de chaque tournoi** et la **politique de confidentialité**, qui décrit le traitement des données personnelles. En cas de contradiction sur le déroulement d'un tournoi, son règlement prévaut.",
    ],
  },
  {
    id: "acceptation",
    title: "Acceptation",
    paragraphs: [
      "Les conditions s'acceptent en **créant un compte**, en **créant une équipe** et en **recevant la gestion d'une équipe** (propriété transférée ou rôle de gérant). Sans cette acceptation, le compte ne peut pas être créé et l'équipe ne peut pas être gérée.",
      "L'association peut modifier ces conditions. Une modification de fond donne lieu à une **nouvelle version**, présentée à l'acceptation des membres concernés avant qu'ils puissent continuer à gérer une équipe.",
    ],
  },
  {
    id: "compte",
    title: "Compte",
    paragraphs: [
      "Un compte se crée par une connexion Google, Discord ou Battle.net, ou par un code reçu en message privé Discord. Il est **personnel** : il ne se prête pas, ne se partage pas et ne se revend pas.",
      "Le pseudo choisi ne doit ni usurper l'identité d'une autre personne, ni porter atteinte à ses droits, ni être injurieux, discriminatoire ou à caractère sexuel.",
      "Chaque membre peut exporter ses données et supprimer son compte à tout moment depuis son profil.",
    ],
  },
  {
    id: "comportement",
    title: "Comportement",
    paragraphs: [
      "Sur le site comme sur les serveurs Discord de l'association, chacun s'engage à respecter les autres joueurs, le staff et les arbitres : **aucun harcèlement, propos haineux, triche, usurpation ou tentative de fausser un tournoi**.",
      "Il est interdit de chercher à contourner les protections du site, d'accéder au compte d'un autre membre ou de perturber le service (envois automatisés, surcharge volontaire).",
    ],
  },
  {
    id: "contenus",
    title: "Contenus publiés par les membres",
    paragraphs: [
      "Les membres publient eux-mêmes certains contenus : **avatar, logo d'équipe, nom et sigle d'équipe, description, pseudos de jeu**. Celui qui publie un contenu en est **seul responsable**.",
      "En publiant un contenu, le membre **garantit qu'il en détient les droits** (création personnelle, licence libre, autorisation écrite du titulaire) et qu'il ne porte atteinte ni au droit d'auteur, ni au droit des marques, ni aux droits d'un tiers. Un logo de club professionnel, d'éditeur de jeu ou de marque ne peut pas être repris sans l'accord de son titulaire.",
      "Il accorde à l'association, pour la seule durée de sa publication, le droit **gratuit et non exclusif** de reproduire et d'afficher ce contenu sur le site et dans ses communications liées aux tournois (diffusions, annonces, réseaux sociaux). Il peut le retirer à tout moment.",
      "Pour une équipe, le **propriétaire et les gérants** répondent des contenus de l'équipe, qu'ils sont seuls à pouvoir modifier.",
    ],
  },
  {
    id: "signalement",
    title: "Signalement et modération",
    paragraphs: [
      "Toute personne, membre ou non, peut signaler un contenu illicite ou contraire à ces conditions par le bouton **« Signaler un problème »** présent en bas de chaque page. Un signalement de droit d'auteur doit indiquer le nom et l'adresse de son auteur, le contenu visé et la raison de la demande.",
      "L'association agit comme **hébergeur** des contenus de ses membres : elle ne les contrôle pas avant publication, mais **retire promptement** tout contenu manifestement illicite qui lui est signalé.",
      "Selon la gravité, l'association peut **retirer un contenu** (par exemple un logo), **retirer une équipe d'un tournoi**, ou **suspendre un compte**.",
      "Les joueurs visés par un signalement, et les membres des équipes visées, en sont **prévenus en message privé Discord** (s'ils ont rattaché leur compte Discord ou certifié leur tag). Ils lisent sur la page du signalement ce qui est reproché — jamais qui l'a signalé — et peuvent le **contester** depuis cette page ou par la catégorie « Contestation » du même formulaire ; contester un signalement archivé le rouvre.",
      `Un logo signalé peut être **masqué** plutôt que supprimé : il n'est plus en ligne, et l'équipe dispose de **${LOGO_QUARANTINE_DAYS / 30} mois** pour contester. Sans contestation, il est supprimé définitivement à l'échéance ; si la contestation aboutit, il est rétabli. Un contenu manifestement illicite peut être supprimé sans délai : l'équipe en est prévenue de la même façon et peut contester la décision.`,
    ],
  },
  {
    id: "responsabilite",
    title: "Responsabilité",
    paragraphs: [
      "Le site est fourni par une association de bénévoles, **sans garantie de disponibilité**. L'association ne peut être tenue responsable d'une interruption, d'une perte de données de jeu ou d'un résultat faussé par une panne, dans les limites permises par la loi.",
      "Les marques et visuels Overwatch (Blizzard Entertainment) et Marvel Rivals (NetEase, Marvel) appartiennent à leurs titulaires ; le site n'est ni affilié à ces éditeurs ni approuvé par eux.",
    ],
  },
  {
    id: "droit-applicable",
    title: "Droit applicable",
    paragraphs: [
      "Ces conditions sont soumises au **droit français**. Un différend est d'abord porté devant l'association, par son serveur Discord ou son adresse de contact, en vue d'une solution amiable ; à défaut, les tribunaux français sont compétents.",
    ],
  },
];

/**
 * Case « je détiens les droits » de l'envoi d'un logo d'équipe.
 *
 * Le logo est le contenu le plus exposé du site (cartes d'annuaire, plateaux,
 * vitrine publique) et le plus souvent emprunté à une marque. La case rappelle
 * la garantie des conditions (section « Contenus publiés par les membres ») au
 * moment précis où elle est donnée ; la route refuse un envoi sans elle.
 */
export const LOGO_RIGHTS_FIELD = "rightsCertified";
export const LOGO_RIGHTS_NOT_CERTIFIED = "LOGO_RIGHTS_NOT_CERTIFIED";
export const LOGO_RIGHTS_LABEL =
  "Je certifie détenir les droits sur ce logo (création de l'équipe, licence libre ou autorisation du titulaire).";
/** Ancre de la section des conditions que la case engage. */
export const LOGO_RIGHTS_TERMS_ANCHOR = `${TERMS_PATH}#contenus`;
