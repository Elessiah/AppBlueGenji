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

import { NOTIFIER_FOLLOW_UP, copyrightNoticeElementsText } from "./content-reports";
import { LOGO_QUARANTINE_MONTHS } from "./logo-quarantine";
import { SUSPENSION_MAX_DAYS } from "./account-suspension";

/**
 * Version en vigueur. L'avancer redemande l'acceptation.
 *
 * Version 2 : âge minimum, licence du code, responsabilité des gérants
 * d'équipe et juridiction — changements de fond, d'où une nouvelle acceptation
 * (`termsRequestFor` rend alors `UPDATED` à qui avait accepté la version 1).
 *
 * Version 3 : procédure de suspension d'un compte (effets, durée, exposé des
 * motifs, contestation), voies de recours contre toute décision de modération
 * (réexamen par l'association, puis le juge), base légale de la modération
 * et absence de médiateur de la consommation — la suspension et le recours
 * sont des règles de fond pour qui les subit, d'où une nouvelle acceptation.
 */
export const TERMS_VERSION = 3;

/**
 * Âge minimum pour créer un compte. Distinct de l'âge d'adhésion à
 * l'association, que fixent ses statuts : un compte n'est pas une adhésion.
 * Aucun contrôle technique ne le tient — le site ne recueille pas de date de
 * naissance, seulement une majorité déclarée (`isAdult`), qui ne dit rien d'un
 * seuil à 15 ans : la condition est déclarative, acceptée avec ces conditions.
 */
export const SITE_MINIMUM_AGE = 15;

/**
 * Déclaration d'âge jointe à la case d'acceptation de la page de connexion,
 * seul écran où naît un compte : la clause d'âge des conditions doit se lire
 * au moment où on la déclare, pas seulement dans le texte lié.
 */
export const TERMS_AGE_DECLARATION = `je déclare avoir au moins ${SITE_MINIMUM_AGE} ans`;

/** Date d'entrée en vigueur de la version courante (AAAA-MM-JJ). */
export const TERMS_UPDATED_AT = "2026-10-01";

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
 * Pourquoi les conditions sont présentées : jamais acceptées (`FIRST`), ou
 * acceptées dans une version antérieure à celle en vigueur (`UPDATED`).
 */
export type TermsRequest = "FIRST" | "UPDATED";

/**
 * Ce qu'il faut demander à un compte, d'après la dernière version acceptée —
 * `null` si elle couvre la version courante (`coversCurrentTerms`).
 */
export function termsRequestFor(acceptedVersion: number | null | undefined): TermsRequest | null {
  if (coversCurrentTerms(acceptedVersion)) return null;
  return typeof acceptedVersion === "number" && acceptedVersion > 0 ? "UPDATED" : "FIRST";
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
      "L'association peut modifier ces conditions. Une modification de fond donne lieu à une **nouvelle version**, présentée à l'acceptation des utilisateurs concernés avant qu'ils puissent continuer à gérer une équipe.",
    ],
  },
  {
    id: "compte",
    title: "Compte",
    paragraphs: [
      "Un compte se crée par une connexion Google, Discord ou Battle.net, ou par un code reçu en message privé Discord. Il est **personnel** : il ne se prête pas, ne se partage pas et ne se revend pas.",
      `Il faut avoir **au moins ${SITE_MINIMUM_AGE} ans** pour créer un compte. En acceptant ces conditions, l'utilisateur déclare avoir atteint cet âge.`,
      "Un compte ne fait pas de son titulaire un **membre de l'association** : l'adhésion est une démarche distincte, soumise aux conditions de ses statuts, dont un âge minimum qui leur est propre.",
      "Le pseudo choisi ne doit ni usurper l'identité d'une autre personne, ni porter atteinte à ses droits, ni être injurieux, discriminatoire ou à caractère sexuel.",
      "Chaque utilisateur peut exporter ses données et supprimer son compte à tout moment depuis son profil.",
    ],
  },
  {
    id: "comportement",
    title: "Comportement",
    paragraphs: [
      "Sur le site comme sur les serveurs Discord de l'association, chacun s'engage à respecter les autres joueurs, le staff et les arbitres : **aucun harcèlement, propos haineux, triche, usurpation ou tentative de fausser un tournoi**.",
      "Il est interdit de chercher à contourner les protections du site, d'accéder au compte d'un autre utilisateur ou de perturber le service (envois automatisés, surcharge volontaire).",
    ],
  },
  {
    id: "contenus",
    title: "Contenus publiés par les utilisateurs",
    paragraphs: [
      "Les utilisateurs publient eux-mêmes certains contenus : **avatar, logo d'équipe, nom et sigle d'équipe, description, pseudos de jeu**. Celui qui publie un contenu en est **responsable**.",
      "En publiant un contenu, l'utilisateur **garantit qu'il en détient les droits** (création personnelle, licence libre, autorisation écrite du titulaire) et qu'il ne porte atteinte ni au droit d'auteur, ni au droit des marques, ni aux droits d'un tiers. Un logo de club professionnel, d'éditeur de jeu ou de marque ne peut pas être repris sans l'accord de son titulaire.",
      "Il accorde à l'association, à titre **gratuit et non exclusif**, le droit de **reproduire et de représenter** ce contenu, et d'en adapter le format (redimensionnement, recadrage, conversion d'image) sans en altérer le sens, **sur le site et dans ses communications liées aux tournois** (diffusions en direct et rediffusions, annonces, réseaux sociaux), **pour le monde entier** — le site et ces communications étant accessibles en ligne —, et **pour la durée de sa publication sur le site** — ainsi que, pour les diffusions, rediffusions et publications faites pendant cette durée, pour la durée de leur mise en ligne. Pour l'**avatar** et les **pseudos de jeu**, qui sont des données personnelles, cette licence ne vaut que **sur le site**, qui ne les affiche que selon les réglages de visibilité du joueur et la politique de confidentialité. Le pseudo que le jeu affiche lui-même pendant un match diffusé n'est pas un contenu publié sur le site.",
      "Il peut retirer ce contenu à tout moment, par les moyens que le site lui offre (un nom d'équipe se remplace et ne disparaît qu'avec l'équipe ; un BattleTag reçu de Battle.net ne s'efface qu'une fois le compte Battle.net détaché, ce qui suppose un autre moyen de connexion). Le retrait vaut pour l'avenir : le contenu cesse d'être affiché sur le site et d'être repris dans de nouvelles communications, mais les diffusions, rediffusions et publications **déjà faites** avant le retrait ne sont pas concernées.",
      "Pour une équipe, répondent aussi de ses contenus, en plus de leur auteur : le **propriétaire** du nom, du sigle et de la description de l'équipe, qu'il est seul à pouvoir modifier ; le propriétaire et les **gérants** de son logo, qu'ils peuvent l'un et l'autre changer. Une **équipe fantôme**, créée et gérée par le staff de l'association pour un tournoi, n'a pas de propriétaire : l'association répond de ses contenus.",
    ],
  },
  {
    id: "signalement",
    title: "Signalement et modération",
    paragraphs: [
      `Toute personne, titulaire d'un compte ou non, peut signaler un contenu illicite ou contraire à ces conditions par le bouton **« Signaler un problème »** présent en bas de chaque page. Un signalement de droit d'auteur doit indiquer ${copyrightNoticeElementsText()}. ${NOTIFIER_FOLLOW_UP}`,
      "L'association agit comme **hébergeur** des contenus de ses utilisateurs : elle ne les contrôle pas avant publication, mais **retire promptement** tout contenu manifestement illicite qui lui est signalé.",
      "Selon la gravité, l'association peut **retirer un contenu** (par exemple un logo ou un avatar), **retirer une équipe d'un tournoi**, ou **suspendre un compte**. Chaque décision est prise par une personne chargée de la modération, **jamais par un traitement automatisé**, et **motivée** à la personne concernée : ce qui est décidé, les faits retenus, la clause des présentes conditions sur laquelle elle repose, et les voies de recours.",
      `La **suspension d'un compte** ferme aussitôt toutes ses sessions et empêche de s'y connecter tant qu'elle court, par tous les moyens de connexion. Elle est prononcée pour une **durée déterminée** (${SUSPENSION_MAX_DAYS} jours au plus) ou **indéterminée**, jusqu'à ce que l'association la lève. Le titulaire en reçoit l'exposé des motifs en message privé Discord si son compte y est rattaché, et, dans tous les cas, à chaque tentative de connexion pendant la suspension. Il la conteste sans avoir à se connecter, par le bouton « Signaler un problème » (catégorie « Autre »), en citant la référence de la décision.`,
      "**Recours** : toute décision de modération peut d'abord être contestée auprès de l'association, qui la **réexamine** — depuis la page du signalement ou la catégorie « Contestation » du formulaire pour une décision prise sur un signalement, par la catégorie « Autre » pour une suspension ou une décision prise sans signalement. La personne concernée peut ensuite, ou à tout moment, porter la décision devant le **juge compétent**.",
      "Le traitement des données qu'exige la modération des contenus et des comptes contraires à ces conditions (examen d'un contenu, masquage, retrait, suspension, conservation de la décision le temps de sa contestation) repose sur l'**intérêt légitime** de l'association à faire respecter ses règles ; la politique de confidentialité en détaille les durées.",
      "Les joueurs visés par un signalement, et les membres des équipes visées, en sont **prévenus en message privé Discord** (s'ils ont rattaché leur compte Discord ou certifié leur tag). Ils lisent sur la page du signalement ce qui est reproché — jamais qui l'a signalé — et peuvent le **contester** depuis cette page ou par la catégorie « Contestation » du même formulaire ; contester un signalement archivé le rouvre.",
      `Un logo d'équipe ou un avatar de joueur signalé peut être **masqué** plutôt que supprimé : il n'est plus en ligne, et l'équipe ou le joueur dispose de **${LOGO_QUARANTINE_MONTHS} mois** pour contester. Sans contestation, l'image est supprimée définitivement à l'échéance ; si la contestation aboutit, elle est rétablie. Un contenu manifestement illicite peut être supprimé sans délai : l'équipe ou le joueur en est prévenu de la même façon et peut contester la décision.`,
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
      "Ces conditions sont soumises au **droit français**. Un différend est d'abord porté devant l'association, par son serveur Discord ou son courriel (donné dans les mentions légales), en vue d'une solution amiable ; à défaut, les tribunaux français sont compétents, sans préjudice des règles qui permettent à un consommateur de saisir la juridiction de son domicile ou de se prévaloir des dispositions impératives du droit de son pays de résidence.",
      "Le service est **gratuit** et l'association ne vend rien sur le site : aucun contrat de vente ni de prestation de services n'y est conclu avec un consommateur, si bien qu'aucun **médiateur de la consommation** n'est désigné.",
    ],
  },
];

/**
 * Case « je détiens les droits » de l'envoi d'un logo d'équipe.
 *
 * Le logo est le contenu le plus exposé du site (cartes d'annuaire, plateaux,
 * vitrine publique) et le plus souvent emprunté à une marque. La case rappelle
 * la garantie des conditions (section « Contenus publiés par les utilisateurs ») au
 * moment précis où elle est donnée ; la route refuse un envoi sans elle.
 */
export const LOGO_RIGHTS_FIELD = "rightsCertified";
export const LOGO_RIGHTS_NOT_CERTIFIED = "LOGO_RIGHTS_NOT_CERTIFIED";
export const LOGO_RIGHTS_LABEL =
  "Je certifie détenir les droits sur ce logo : l'équipe l'a créé elle-même, il est sous licence libre, ou son auteur en a autorisé l'usage.";
/** Ancre de la section des conditions que la case engage. */
export const LOGO_RIGHTS_TERMS_ANCHOR = `${TERMS_PATH}#contenus`;
