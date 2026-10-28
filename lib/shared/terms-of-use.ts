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
 *   refusée tant qu'il ne l'a pas fait ;
 * - **connecté**, dans la fenêtre bloquante de la mise en page racine, pour
 *   tout compte en retard d'une version (`SIGNED_IN`, depuis la version 6 ;
 *   `TEAM_MANAGEMENT` si le compte gère une équipe).
 *
 * Module pur, importable partout.
 */

import { NOTIFIER_FOLLOW_UP, copyrightNoticeElementsText } from "./content-reports";
import { LOGO_QUARANTINE_MONTHS } from "./logo-quarantine";
import { SUSPENSION_MAX_DAYS } from "./account-suspension";
import { SITE_MINIMUM_AGE } from "./legal-durations";
import { STREAM_NOTICE_LIVE, STREAM_NOTICE_OBJECTION, STREAM_NOTICE_PRIVACY_PATH, STREAM_NOTICE_SHOWN } from "./stream-notice";

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
 *
 * Version 4 : l'annonce #live d'un tournoi individuel nomme le joueur par son
 * pseudo public au titre de l'exécution du service (pas de nom neutre, ne pas
 * y être nommé = ne pas s'inscrire) — une règle de fond du tournoi auquel on
 * s'inscrit ; mise en vigueur au 14 octobre 2026 sur décision de
 * l'association, la version 3 datant du 1er octobre.
 *
 * Version 5 : section « Contacts de match » — les coordonnées de contact
 * (tag Discord certifié, BattleTag même masqué, rôle d'équipe) sont
 * communiquées aux deux équipes d'un match et à son caster le temps du match,
 * au titre de l'organisation du tournoi (base « exécution du contrat » du
 * registre T04) ; en vigueur au 19 octobre 2026 (décision de l'utilisateur).
 *
 * Version 6 : section « Acceptation » — tout compte connecté en retard d'une
 * version accepte les conditions dans une fenêtre bloquante pour continuer à
 * utiliser le site (plus seulement les gérants d'équipe, plus de report) ;
 * section « Contacts de match » — le BattleTag masqué se lit aussi dans la
 * fenêtre de lancement du match. La version 5, déjà en ligne, ne se réécrit
 * pas : d'où une nouvelle version, annoncée par sa propre entrée de
 * `PRIVACY_CHANGES` ; en vigueur au 19 octobre 2026. Le 21 octobre 2026, la
 * section « Contacts de match » ouvre aux arbitres les contacts du caster dès
 * que les deux adversaires sont connus, sans nouvelle version (décision de
 * l'utilisateur : seuls les casters, membres du staff, sont concernés),
 * annoncé par sa propre entrée de `PRIVACY_CHANGES`.
 *
 * Version 7 : section « Contacts de match » — un match a des casters, au
 * pluriel (les contacts de chaque caster vont aussi aux autres casters du
 * match), et peut avoir un arbitre désigné, dont le pseudo et le BattleTag
 * (même masqué) sont communiqués aux parties du match au titre de
 * l'organisation du tournoi : la base de cette présentation passe de
 * l'intérêt légitime, retenu jusque-là faute de clause, à l'exécution du
 * contrat (décision de l'utilisateur du 2026-10-27) ; la page du match
 * s'ajoute aux fenêtres « Contacts » et de lancement comme lieu où se lisent
 * les contacts des casters et le BattleTag de l'arbitre désigné. Section
 * « Acceptation » — le compte se supprime aussi directement depuis la fenêtre
 * d'acceptation. Section « Retransmission des matchs » (`STREAM_NOTICE_LIVE`)
 * — le message #live de la soirée nomme les joueurs d'un tournoi individuel
 * avant le début d'un match programmé et après sa fin, pas seulement à son
 * départ. La version 6, déjà en ligne, ne se réécrit pas : d'où une nouvelle
 * version, annoncée par sa propre entrée de `PRIVACY_CHANGES`
 * (`2026-10-conditions-v7-casters-et-arbitre`) ; en vigueur au 30 octobre 2026,
 * lendemain de la mise en ligne prévue (nuit du 28 au 29 octobre, § Dates corrigées).
 */
export const TERMS_VERSION = 7;

/** Âge minimum pour créer un compte (défini dans `lib/shared/legal-durations.ts`). */
export { SITE_MINIMUM_AGE };

/**
 * Déclaration d'âge jointe à la case d'acceptation de la page de connexion,
 * seul écran où naît un compte : la clause d'âge des conditions doit se lire
 * au moment où on la déclare, pas seulement dans le texte lié.
 */
export const TERMS_AGE_DECLARATION = `je déclare avoir au moins ${SITE_MINIMUM_AGE} ans`;

/** Date d'entrée en vigueur de la version courante (AAAA-MM-JJ). */
export const TERMS_UPDATED_AT = "2026-10-30";

/** Adresse de la page publique des conditions. */
export const TERMS_PATH = "/conditions-utilisation";

/** Où une acceptation a été donnée. */
export type TermsAcceptanceContext = "SIGNUP" | "LOGIN" | "TEAM_CREATION" | "TEAM_MANAGEMENT" | "SIGNED_IN";

export const TERMS_ACCEPTANCE_CONTEXTS: readonly TermsAcceptanceContext[] = [
  "SIGNUP",
  "LOGIN",
  "TEAM_CREATION",
  "TEAM_MANAGEMENT",
  "SIGNED_IN",
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

/**
 * Événement de fenêtre émis quand la modale d'acceptation vient d'être
 * acceptée : la fenêtre de certification du tag Discord, qui l'attendait, peut
 * s'ouvrir sans rechargement.
 */
export const TERMS_ACCEPTED_EVENT = "bg:terms-accepted";

/** Jeton de refus d'un geste de gestion sans acceptation. */
export const TERMS_ACCEPTANCE_REQUIRED = "TERMS_ACCEPTANCE_REQUIRED";

/** Jeton de refus d'une création de compte sans acceptation. */
export const TERMS_REQUIRED = "TERMS_REQUIRED";
/**
 * Acceptation d'une version qui n'est plus celle en vigueur (page chargée avant
 * la nouvelle) : refusée, on n'enregistre pas l'acceptation d'un texte non montré.
 */
export const TERMS_VERSION_MISMATCH = "TERMS_VERSION_MISMATCH";

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

/**
 * La date d'entrée en vigueur dans une langue : `formatTermsDate` en français
 * (« 1 octobre 2026 »), « October 1, 2026 » en anglais (lot 7b).
 */
export function formatTermsDateIn(locale: "fr" | "en", date: string = TERMS_UPDATED_AT): string {
  if (locale === "fr") return formatTermsDate(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
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
  /**
   * Liens rendus après les paragraphes : un paragraphe n'est qu'une chaîne,
   * il ne sait pas porter de lien. Chemins du site seulement.
   */
  links?: readonly { href: string; label: string }[];
}

/**
 * Où se lit l'adresse électronique de l'association : ses mentions légales,
 * qui la révèlent au clic (`ProtectedContact`). Les conditions y renvoient
 * plutôt que de l'écrire — une adresse écrite dans une page est moissonnée.
 */
export const ASSOCIATION_CONTACT_PATH = "/mentions-legales#editeur";

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
      "Les conditions s'acceptent en **créant un compte**, en **créant une équipe** et en **recevant la gestion d'une équipe** (propriété transférée ou rôle de gérant), ainsi qu'en les acceptant sur la **page de connexion**, qui les présente tant qu'elles n'ont pas été acceptées dans le navigateur, ou dans la **fenêtre d'acceptation** présentée à tout compte connecté qui n'a pas accepté la version en vigueur. Sans cette acceptation, le compte ne peut pas être créé, l'équipe ne peut pas être gérée, et un compte existant ne peut continuer à utiliser le site qu'après les avoir acceptées — il peut toujours se déconnecter, lire les pages légales du site et du bot (politique de confidentialité, mentions légales, déclaration d'accessibilité) et les règles des tournois, suivre ou contester ses signalements depuis leur page, signaler un contenu par le bouton « Signaler un problème » de ces pages, et ouvrir son profil, notamment pour exporter ses données ou supprimer son compte. Ne pas les accepter ne retire le compte ni de ses équipes ni de ses inscriptions : ses contacts restent communiqués aux parties de ses matchs et les messages de match continuent ; pour y mettre fin sans les accepter, il peut supprimer son compte depuis son profil ou directement depuis la fenêtre d'acceptation.",
      "L'association peut modifier ces conditions. Une modification de fond donne lieu à une **nouvelle version**, présentée à l'acceptation de chaque compte connecté avant qu'il puisse continuer à utiliser le site.",
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
  // Née comme précision (la retransmission figurait déjà à la licence ci-dessus
  // et à la politique de confidentialité), sans changer `TERMS_VERSION`. La règle
  // de l'annonce #live d'un tournoi individuel (`STREAM_NOTICE_LIVE`), elle, a
  // fait passer les conditions en version 4 (décision du 2026-10-14) : une
  // modification de fond de cet article demande une nouvelle version — ainsi
  // en version 7, le message de la soirée qui nomme aussi les joueurs avant et
  // après le match.
  {
    id: "retransmission",
    title: "Retransmission des matchs",
    paragraphs: [
      `Un match de tournoi peut être **diffusé en direct et enregistré** (YouTube, Twitch ou Kick), par la chaîne de l'association ou d'un caster. ${STREAM_NOTICE_SHOWN}`,
      `${STREAM_NOTICE_OBJECTION} ${STREAM_NOTICE_LIVE} La diffusion se regarde sur la plateforme qui la publie : le site ne fait que lier la chaîne.`,
    ],
    links: [{ href: STREAM_NOTICE_PRIVACY_PATH, label: "Politique de confidentialité — retransmission des matchs" }],
  },
  // Version 5 (2026-10-19, précisée en version 6 : fenêtre de lancement ; en
  // version 7 : plusieurs casters, arbitre désigné, page du match) : la base
  // « exécution du contrat » des contacts de match et de la présentation de
  // l'arbitre désigné (registre T01 et T04, `/rgpd`) renvoie à cette section.
  // Elle suit le code : `match-launch-info.ts` (qui, quand),
  // `battletag-visibility.ts` et `lib/shared/match-referee.ts`.
  {
    id: "contacts-de-match",
    title: "Contacts de match",
    paragraphs: [
      "Pour qu'un match de tournoi se joue, ses parties doivent pouvoir se joindre et s'ajouter en jeu. Au titre de l'organisation du tournoi, les **coordonnées de contact** d'un ou deux membres de chaque équipe — **tag Discord** certifié, **BattleTag**, **même masqué**, et **rôle d'équipe** — sont communiquées aux **membres des deux équipes** du match et aux **arbitres** (administrateurs compris), dès que ses deux adversaires sont connus et jusqu'à sa fin, et à ses **casters** inscrits — un match peut en avoir plusieurs — **le temps du match** seulement, de son départ à sa fin ; celles de chaque caster — son BattleTag dans les seuls tournois Overwatch, où l'on s'invite par BattleTag — le sont aux deux équipes et aux **autres casters** du match sur ce même temps du match, et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin (en vigueur depuis le 21 octobre 2026 : auparavant, aux arbitres aussi le temps du match seulement).",
      "Un match peut aussi avoir un **arbitre désigné** : une personne du staff habilitée à arbitrer (permission d'arbitrage, tag Discord certifié et compte Battle.net rattaché), qui prend le match ou à qui le staff le confie. Au titre de cette même organisation, son **pseudo** et, dans un tournoi Overwatch seulement, son **BattleTag**, **même masqué** — jamais son tag Discord à ce titre — sont communiqués aux membres des deux équipes et aux arbitres (administrateurs compris) dès que ses deux adversaires sont connus et jusqu'à sa fin, et aux casters du match le temps du match ; son pseudo seul, sans le BattleTag, se lit dès que la fenêtre de lancement montre le match. Le public et les autres joueurs ne lisent que « Arbitre désigné ». L'arbitre peut se retirer d'un match à tout moment, le staff pouvant le lui confier de nouveau ; il n'est plus présenté s'il ne remplit plus ces conditions ou si, avant le lancement du match, il devient l'un de ses joueurs. S'il caste aussi le match, ses contacts de caster, tag Discord certifié compris, suivent la règle des casters ci-dessus.",
      "Ce partage passe par la fenêtre « Contacts » du match, par sa fenêtre de lancement, qui la reprend au départ du match et ne s'ouvre qu'aux deux équipes, aux casters et à l'arbitre désigné, et par la **page du match**, qui reprend les contacts des casters et le pseudo de l'arbitre désigné, avec son BattleTag dans un tournoi Overwatch — jamais les contacts des équipes — aux mêmes personnes et aux mêmes moments que la fenêtre « Contacts » : un BattleTag masqué n'est lisible nulle part ailleurs sur le site, pour personne — arbitres et administrateurs compris. Le jeu, lui, affiche les identifiants de jeu des joueurs : le code de replay d'une map, visible de tout utilisateur connecté sur la fiche du tournoi, permet de revoir la partie et de les y lire. Masquer son BattleTag ne le retire donc ni de ces fenêtres ni de cette page : pour ne pas le communiquer, il faut le retirer de son profil (un BattleTag reçu de Battle.net ne s'efface qu'une fois le compte Battle.net détaché, ce qui suppose un autre moyen de connexion). Un tag Discord non certifié n'est jamais communiqué.",
    ],
    links: [{ href: "/rgpd#donnees-collectees", label: "Politique de confidentialité — données collectées" }],
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
      "Ces conditions sont soumises au **droit français**. Un différend est d'abord porté devant l'association, par son serveur Discord ou par l'adresse électronique de l'association indiquée dans les mentions légales, en vue d'une solution amiable ; à défaut, les tribunaux français sont compétents, sans préjudice des règles qui permettent à un consommateur de saisir la juridiction de son domicile ou de se prévaloir des dispositions impératives du droit de son pays de résidence.",
      "Le service est **gratuit** et l'association ne vend rien sur le site : aucun contrat de vente ni de prestation de services n'y est conclu avec un consommateur, si bien qu'aucun **médiateur de la consommation** n'est désigné.",
    ],
    links: [{ href: ASSOCIATION_CONTACT_PATH, label: "Coordonnées de l'association (mentions légales)" }],
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
