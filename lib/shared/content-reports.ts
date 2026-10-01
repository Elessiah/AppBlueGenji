/**
 * Signalements adressés à l'association — module pur.
 *
 * Un site qui héberge des contenus fournis par ses membres (logos d'équipe,
 * avatars, noms, descriptions) doit offrir à **quiconque** un moyen de lui
 * notifier un contenu illicite (règlement européen sur les services
 * numériques, art. 16) : c'est la notification qui fait courir sa
 * responsabilité d'hébergeur, et c'est la promptitude du retrait qui l'éteint.
 * Le même formulaire recueille le reste de ce qu'on voudrait dire au staff —
 * un comportement, un bug —, rangé par **catégorie**.
 *
 * Ce module décide de tout ce qui ne dépend ni de la base ni du réseau : les
 * catégories et ce qu'elles exigent, la validation d'un envoi (partagée par le
 * formulaire et la route, qui ne peuvent donc pas diverger), le cycle de vie
 * d'un signalement, sa durée de conservation, et la ligne envoyée sur Discord.
 *
 * **La ligne Discord ne nomme aucun joueur**, ni le signalant ni les joueurs
 * visés : le canal de logs est un tiers qui n'est pas purgé
 * (`lib/shared/log-privacy.ts`). Elle dit la catégorie, compte les joueurs,
 * nomme les équipes et les tournois, et renvoie au panneau — c'est là, derrière
 * une connexion, que se lit le détail. La description, texte libre qui peut
 * contenir n'importe quoi, ne part jamais.
 */

import { LOGO_QUARANTINE_MONTHS, logoQuarantinePurgeDate, type LogoQuarantineView } from "./logo-quarantine";
import { discordInline } from "./discord-text";

/**
 * Catégories d'un signalement.
 *
 * `CONTEST` n'est pas un signalement comme les autres : c'est la **réponse**
 * d'un joueur visé (ou d'un membre d'une équipe visée) à un signalement qui le
 * concerne. Elle ne désigne rien, elle se rattache à son signalement d'origine
 * (`parentReportId`) et se range sous lui dans le panneau.
 */
export type ReportCategory = "COPYRIGHT" | "MODERATION" | "BUG" | "RGPD" | "HOSTING" | "OTHER" | "CONTEST";

/** Ce qu'un signalement peut viser. */
export type ReportTargetType = "USER" | "TEAM" | "TOURNAMENT";

/** Cycle de vie : à traiter, pris en charge, résolu (archivé). */
export type ReportStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

/** Gestes du panneau d'administration. */
export type ReportAction = "TAKE" | "RELEASE" | "RESOLVE" | "REOPEN";

/** Qualité du signalant vis-à-vis d'un droit d'auteur invoqué. */
export type RightsRelation = "HOLDER" | "AGENT" | "THIRD_PARTY";

/** Base légale du traitement d'un signalement, par catégorie (`ReportCategoryDefinition.legalBasis`). */
export type ReportLegalBasis = "CONSENT" | "LEGAL_OBLIGATION";

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  "COPYRIGHT",
  "MODERATION",
  "BUG",
  "RGPD",
  "HOSTING",
  "OTHER",
  "CONTEST",
];

/** Catégories d'un signalement « d'origine », c'est-à-dire qui n'est pas une contestation. */
export const PRIMARY_REPORT_CATEGORIES: readonly ReportCategory[] = REPORT_CATEGORIES.filter(
  (category) => category !== "CONTEST",
);

/**
 * Ce qui peut être contesté : ce qui vise une **personne** — un joueur, ou une
 * équipe dont on est membre. Un tournoi visé ne donne la parole à personne en
 * particulier : il est organisé par l'association elle-même.
 */
export const CONTESTABLE_TARGET_TYPES: readonly ReportTargetType[] = ["USER", "TEAM"];
export const REPORT_TARGET_TYPES: readonly ReportTargetType[] = ["USER", "TEAM", "TOURNAMENT"];
export const REPORT_STATUSES: readonly ReportStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED"];
export const RIGHTS_RELATIONS: readonly RightsRelation[] = ["HOLDER", "AGENT", "THIRD_PARTY"];

export interface ReportCategoryDefinition {
  label: string;
  /** Une ligne sous le titre, dans le choix de la catégorie. */
  hint: string;
  /** Pictogramme décoratif du choix de catégorie et du panneau. */
  icon: string;
  /** Ce que la catégorie permet de désigner — vide : aucun sélecteur. */
  targets: readonly ReportTargetType[];
  /**
   * Nom et adresse de contact exigés. Seul le droit d'auteur les demande : la
   * notification d'un contenu illicite doit identifier son auteur (DSA,
   * art. 16.2.c), et le titulaire d'un droit doit pouvoir être recontacté.
   */
  requiresContact: boolean;
  /** Qualité vis-à-vis du droit invoqué, et déclaration de bonne foi. */
  requiresRightsDeclaration: boolean;
  /**
   * Une réponse est due : sans tag Discord certifié, une adresse est exigée
   * (`missingReplyChannel`). Une demande RGPD appelle une réponse sous un mois
   * (art. 12), une contestation une décision motivée (DSA, art. 20.5) ;
   * reçues sans canal, personne ne pourrait les donner.
   */
  requiresReplyChannel: boolean;
  /**
   * Base légale du traitement du signalement (RGPD, art. 6).
   *
   * `LEGAL_OBLIGATION` : l'association est **tenue** de traiter la demande —
   * exercice d'un droit (RGPD, art. 12), notification d'un contenu illicite
   * (DSA, art. 16), demande adressée à l'hébergeur (DSA, art. 11 et 16),
   * contestation d'une décision de modération (DSA, art. 20), contenu du site
   * signalé en modération (DSA, art. 16). Y exiger un
   * consentement subordonnait un droit à un accord qui n'est pas libre, et
   * dont le retrait ferait effacer une demande qu'elle doit traiter : aucune
   * case n'est donc demandée, le formulaire informe seulement.
   *
   * La modération en fait partie : un pseudo, un nom d'équipe ou un logo
   * haineux ou diffamatoire se signale par elle, et c'est une notification de
   * contenu illicite comme une autre.
   *
   * `CONSENT` : le reste (bug, autre), où la case d'accord est gardée.
   */
  legalBasis: ReportLegalBasis;
  /** Aide du champ de description. */
  descriptionPlaceholder: string;
}

export const REPORT_CATEGORY_DEFINITIONS: Record<ReportCategory, ReportCategoryDefinition> = {
  COPYRIGHT: {
    label: "Droit d'auteur",
    hint: "Un logo, un avatar ou une image utilisé sans autorisation.",
    icon: "©",
    targets: ["USER", "TEAM", "TOURNAMENT"],
    requiresContact: true,
    requiresRightsDeclaration: true,
    requiresReplyChannel: false,
    legalBasis: "LEGAL_OBLIGATION",
    descriptionPlaceholder:
      "Quelle œuvre est reproduite, où la voir sur le site, et à qui elle appartient…",
  },
  MODERATION: {
    label: "Modération",
    hint: "Un pseudo, un nom d'équipe ou un contenu du site contraire aux règles.",
    icon: "⚑",
    targets: ["USER", "TEAM"],
    requiresContact: false,
    requiresRightsDeclaration: false,
    requiresReplyChannel: false,
    legalBasis: "LEGAL_OBLIGATION",
    descriptionPlaceholder: "Quel contenu du site, sur quelle page, et ce qui ne va pas…",
  },
  BUG: {
    label: "Bug",
    hint: "Une page qui ne s'affiche pas, un bouton qui ne répond pas.",
    icon: "⚙",
    targets: [],
    requiresContact: false,
    requiresRightsDeclaration: false,
    requiresReplyChannel: false,
    legalBasis: "CONSENT",
    descriptionPlaceholder: "Ce que tu faisais, ce que tu attendais, ce qui s'est passé…",
  },
  // Les deux catégories suivantes trient les demandes faites à l'éditeur et à
  // l'hébergeur (`lib/shared/legal-contact.ts`) ; le courriel de l'association,
  // révélé au clic sur les mentions légales, en est l'autre chemin. Ni l'une ni l'autre ne désigne de cible — une demande sur ses
  // propres données n'a personne à prévenir, et un contenu illicite d'un joueur
  // ou d'une équipe se signale par « Droit d'auteur » ou « Modération », qui
  // savent le masquer et le faire contester.
  RGPD: {
    label: "RGPD",
    hint: "Exercer tes droits sur tes données : accès, rectification, effacement, opposition, portabilité.",
    // Glyphe texte, comme les autres : un émoji se peindrait en couleur.
    icon: "⚿",
    targets: [],
    requiresContact: false,
    requiresRightsDeclaration: false,
    requiresReplyChannel: true,
    legalBasis: "LEGAL_OBLIGATION",
    descriptionPlaceholder:
      "Le droit que tu exerces, le compte concerné (pseudo), et ce que tu demandes précisément…",
  },
  HOSTING: {
    label: "Hébergeur",
    hint: "Écrire à l'éditeur ou à l'hébergeur du site : mentions légales, demande d'une autorité, question juridique.",
    icon: "§",
    targets: [],
    requiresContact: false,
    requiresRightsDeclaration: false,
    requiresReplyChannel: true,
    legalBasis: "LEGAL_OBLIGATION",
    descriptionPlaceholder: "Qui tu es (particulier, organisme, autorité), l'objet de ta demande, et la page concernée…",
  },
  OTHER: {
    label: "Autre",
    hint: "Tout ce qui ne rentre dans aucune case ci-dessus.",
    icon: "✉",
    targets: ["USER", "TEAM", "TOURNAMENT"],
    requiresContact: false,
    requiresRightsDeclaration: false,
    requiresReplyChannel: false,
    legalBasis: "CONSENT",
    descriptionPlaceholder: "Explique-nous le problème…",
  },
  CONTEST: {
    label: "Contestation",
    hint: "Répondre à un signalement qui te vise, toi ou ton équipe — ou contester la décision prise sur ton propre signalement de droit d'auteur ou de modération.",
    icon: "⚖",
    targets: [],
    requiresContact: false,
    requiresRightsDeclaration: false,
    requiresReplyChannel: true,
    legalBasis: "LEGAL_OBLIGATION",
    descriptionPlaceholder:
      "Pourquoi le signalement est infondé : licence, autorisation du titulaire, création de l'équipe, contexte…",
  },
};

/**
 * Portail de support de l'association (Spiceworks), où se signale la
 * modération **qui n'est pas propre au site** : un comportement en match, une
 * insulte d'un joueur, de la triche, un litige sur Discord.
 *
 * Le formulaire du site ne garde que ce qu'il héberge — un pseudo, un nom
 * d'équipe, un logo — parce que c'est là que joue sa responsabilité
 * d'hébergeur et que ses outils (masquage, contestation, prévenance des
 * personnes visées) ont une prise. Un comportement en jeu n'a rien de tout
 * cela : il se traite au cas par cas par l'équipe de modération, sur un outil
 * de tickets qui garde l'échange avec le signalant.
 *
 * Le site n'y transmet **rien** : c'est un lien, que le visiteur suit s'il le
 * souhaite.
 */
export const MODERATION_SUPPORT_PORTAL_URL = "https://bluegenjiesport.on.spiceworks.com/portal";

/** Carte du choix de catégorie qui renvoie vers le portail de support. */
export const OFF_SITE_CONDUCT_ENTRY = {
  label: "Comportement d'un joueur",
  hint: "En match, en vocal ou sur Discord : insulte, triche, anti-jeu… Se signale sur notre portail de support.",
  icon: "↗",
} as const;

/** Rappel affiché dans l'étape « Modération » du formulaire. */
export const OFF_SITE_CONDUCT_NOTICE =
  "Ce formulaire concerne les contenus publiés sur le site (pseudo, nom d'équipe, logo…). Un mauvais comportement en match, une insulte d'un joueur, de la triche ou un problème sur Discord se signalent sur le";

export const REPORT_TARGET_LABELS: Record<ReportTargetType, { one: string; many: string; picker: string }> = {
  USER: { one: "joueur", many: "joueurs", picker: "Joueurs concernés" },
  TEAM: { one: "équipe", many: "équipes", picker: "Équipes concernées" },
  TOURNAMENT: { one: "tournoi", many: "tournois", picker: "Tournois concernés" },
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: "À traiter",
  IN_PROGRESS: "En cours",
  RESOLVED: "Archivé",
};

export const RIGHTS_RELATION_LABELS: Record<RightsRelation, string> = {
  HOLDER: "Je suis titulaire des droits",
  AGENT: "Je représente le titulaire des droits",
  THIRD_PARTY: "Je ne suis ni l'un ni l'autre",
};

export const REPORT_DESCRIPTION_MIN_LENGTH = 20;
export const REPORT_DESCRIPTION_MAX_LENGTH = 4000;
export const REPORT_CONTACT_NAME_MAX_LENGTH = 120;
export const REPORT_CONTACT_EMAIL_MAX_LENGTH = 191;
export const REPORT_PAGE_PATH_MAX_LENGTH = 300;
export const REPORT_RESOLUTION_NOTE_MAX_LENGTH = 2000;
/** Cibles par signalement, tous types confondus. */
export const REPORT_MAX_TARGETS = 10;

/**
 * Durée de conservation d'un signalement **une fois résolu**. Il est ensuite
 * effacé, cibles comprises. Tant qu'il est ouvert, il est gardé : c'est la
 * durée du traitement.
 */
export const REPORT_RETENTION_DAYS_AFTER_RESOLUTION = 30;

/** Adresse du panneau de traitement. */
export const REPORTS_ADMIN_PATH = "/admin/signalements";

export interface ReportTargetRef {
  type: ReportTargetType;
  id: number;
}

/** Envoi normalisé, tel que le service l'écrit. */
export interface ReportSubmission {
  category: ReportCategory;
  description: string;
  targets: ReportTargetRef[];
  pagePath: string | null;
  contactName: string | null;
  contactEmail: string | null;
  rightsRelation: RightsRelation | null;
  /** Signalement contesté — pour une contestation seulement, `null` sinon. */
  parentReportId: number | null;
}

export type ReportValidationError =
  | "REPORT_INVALID_CATEGORY"
  | "REPORT_DESCRIPTION_TOO_SHORT"
  | "REPORT_DESCRIPTION_TOO_LONG"
  | "REPORT_INVALID_TARGET"
  | "REPORT_TARGET_NOT_ALLOWED"
  | "REPORT_TOO_MANY_TARGETS"
  | "REPORT_CONTACT_REQUIRED"
  | "REPORT_CONTACT_TOO_LONG"
  | "REPORT_INVALID_EMAIL"
  | "REPORT_RIGHTS_RELATION_REQUIRED"
  | "REPORT_GOOD_FAITH_REQUIRED"
  | "REPORT_CONSENT_REQUIRED"
  | "REPORT_PARENT_REQUIRED";

export type ReportValidation =
  | { ok: true; value: ReportSubmission }
  | { ok: false; error: ReportValidationError };

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === "string" && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return typeof value === "string" && (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && (REPORT_STATUSES as readonly string[]).includes(value);
}

export function isRightsRelation(value: unknown): value is RightsRelation {
  return typeof value === "string" && (RIGHTS_RELATIONS as readonly string[]).includes(value);
}

/** Retire les caractères de contrôle (hors saut de ligne et tabulation) et les blancs de bord. */
function cleanText(value: unknown, keepNewlines: boolean): string {
  if (typeof value !== "string") return "";
  const pattern = keepNewlines ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return value.replace(pattern, keepNewlines ? "" : " ").trim();
}

/**
 * Adresse électronique plausible. Volontairement simple : on ne vérifie pas
 * qu'elle existe (on ne lui écrit pas depuis le site), on refuse seulement ce
 * qui ne peut pas en être une — un staff qui répond à « bonjour » perd son temps.
 */
export function isPlausibleEmail(value: string): boolean {
  return value.length <= REPORT_CONTACT_EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); // NOSONAR typescript:S8786 — longueur bornée avant le test (court-circuit)
}

/**
 * La page d'où le signalement est parti, gardée comme **chemin du site**
 * seulement. Tout ce qui n'en est pas un (adresse absolue, protocole-relative,
 * caractère de contrôle) est écarté plutôt que corrigé : c'est un indice pour le
 * staff, pas une donnée qu'on doit retenir coûte que coûte.
 */
export function normalizeReportPagePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (path.length === 0 || path.length > REPORT_PAGE_PATH_MAX_LENGTH) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  if (/[\u0000-\u001F\u007F]/.test(path) || /\s/.test(path)) return null;
  return path;
}

function normalizeTargets(raw: unknown): ReportTargetRef[] | "INVALID" {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return "INVALID";
  const seen = new Set<string>();
  const targets: ReportTargetRef[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return "INVALID";
    const { type, id } = entry as { type?: unknown; id?: unknown };
    const numericId = typeof id === "number" ? id : Number(id);
    if (!isReportTargetType(type) || !Number.isSafeInteger(numericId) || numericId <= 0) return "INVALID";
    const key = `${type}:${numericId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ type, id: numericId });
  }
  return targets;
}

/**
 * Valide et normalise un envoi du formulaire.
 *
 * L'ordre des refus suit celui du formulaire, de haut en bas : le premier
 * champ fautif est celui qu'on nomme.
 */
export function validateReportSubmission(input: unknown): ReportValidation {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  if (!isReportCategory(raw.category)) return { ok: false, error: "REPORT_INVALID_CATEGORY" };
  const category = raw.category;
  const definition = REPORT_CATEGORY_DEFINITIONS[category];

  // Une contestation se rattache à un signalement ; aucune autre catégorie ne
  // porte ce lien — il est ignoré ailleurs, pour ne pas ranger un signalement
  // ordinaire sous un autre.
  let parentReportId: number | null = null;
  if (category === "CONTEST") {
    const parent = typeof raw.parentReportId === "number" ? raw.parentReportId : Number(raw.parentReportId);
    if (!Number.isSafeInteger(parent) || parent <= 0) return { ok: false, error: "REPORT_PARENT_REQUIRED" };
    parentReportId = parent;
  }

  const targets = normalizeTargets(raw.targets);
  if (targets === "INVALID") return { ok: false, error: "REPORT_INVALID_TARGET" };
  if (targets.some((target) => !definition.targets.includes(target.type))) {
    return { ok: false, error: "REPORT_TARGET_NOT_ALLOWED" };
  }
  if (targets.length > REPORT_MAX_TARGETS) return { ok: false, error: "REPORT_TOO_MANY_TARGETS" };

  const description = cleanText(raw.description, true);
  if (description.length < REPORT_DESCRIPTION_MIN_LENGTH) {
    return { ok: false, error: "REPORT_DESCRIPTION_TOO_SHORT" };
  }
  if (description.length > REPORT_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: "REPORT_DESCRIPTION_TOO_LONG" };
  }

  const contactName = cleanText(raw.contactName, false) || null;
  const contactEmail = cleanText(raw.contactEmail, false).toLowerCase() || null;
  if (definition.requiresContact && (!contactName || !contactEmail)) {
    return { ok: false, error: "REPORT_CONTACT_REQUIRED" };
  }
  if (contactName && contactName.length > REPORT_CONTACT_NAME_MAX_LENGTH) {
    return { ok: false, error: "REPORT_CONTACT_TOO_LONG" };
  }
  if (contactEmail && !isPlausibleEmail(contactEmail)) return { ok: false, error: "REPORT_INVALID_EMAIL" };

  let rightsRelation: RightsRelation | null = null;
  if (definition.requiresRightsDeclaration) {
    if (!isRightsRelation(raw.rightsRelation)) return { ok: false, error: "REPORT_RIGHTS_RELATION_REQUIRED" };
    rightsRelation = raw.rightsRelation;
    if (raw.goodFaith !== true) return { ok: false, error: "REPORT_GOOD_FAITH_REQUIRED" };
  }

  if (reportRequiresConsent(category) && raw.consent !== true) {
    return { ok: false, error: "REPORT_CONSENT_REQUIRED" };
  }

  return {
    ok: true,
    value: {
      category,
      description,
      targets,
      pagePath: normalizeReportPagePath(raw.pagePath),
      // Hors droit d'auteur, le nom n'est demandé nulle part : on ne garde pas
      // ce que le formulaire n'a pas sollicité.
      contactName: definition.requiresContact ? contactName : null,
      contactEmail,
      rightsRelation,
      parentReportId,
    },
  };
}

/** La catégorie repose sur le consentement du signalant, donc demande la case d'accord. */
export function reportRequiresConsent(category: ReportCategory): boolean {
  return REPORT_CATEGORY_DEFINITIONS[category].legalBasis === "CONSENT";
}

/**
 * Envoi d'une catégorie qui appelle une réponse (`requiresReplyChannel`) sans
 * rien pour la donner : ni adresse, ni compte **joignable**.
 *
 * Un compte ne suffit pas : le site n'envoie aucun courriel, et un signalant ne
 * suit pas son signalement en ligne. Seul un tag Discord **certifié**, que les
 * administrateurs lisent sur la fiche du signalant, permet à l'association de
 * répondre.
 * Un demandeur connecté sans lui recevait la promesse d'une réponse sous un
 * mois sans qu'aucun canal ne la porte. La validation ne connaît pas le compte :
 * la route (`createReport`) pose cette question à part, sur la base ; le
 * formulaire ne connaît que la session et la pose au plus large.
 */
export function missingReplyChannel(
  submission: Pick<ReportSubmission, "category" | "contactEmail">,
  replyReachable: boolean,
): boolean {
  return REPORT_CATEGORY_DEFINITIONS[submission.category].requiresReplyChannel && !replyReachable && !submission.contactEmail;
}

/**
 * Statut atteint par un geste, ou `null` s'il n'a pas de sens depuis l'état
 * courant (on ne prend pas en charge un signalement archivé, on ne rouvre pas
 * un signalement ouvert).
 */
export function nextReportStatus(current: ReportStatus, action: ReportAction): ReportStatus | null {
  switch (action) {
    case "TAKE":
      return current === "OPEN" ? "IN_PROGRESS" : null;
    case "RELEASE":
      return current === "IN_PROGRESS" ? "OPEN" : null;
    case "RESOLVE":
      return current === "RESOLVED" ? null : "RESOLVED";
    case "REOPEN":
      return current === "RESOLVED" ? "OPEN" : null;
  }
}

export function isReportAction(value: unknown): value is ReportAction {
  return value === "TAKE" || value === "RELEASE" || value === "RESOLVE" || value === "REOPEN";
}

/** Date à laquelle un signalement résolu sera effacé. */
export function reportPurgeDate(resolvedAt: Date): Date {
  return new Date(resolvedAt.getTime() + REPORT_RETENTION_DAYS_AFTER_RESOLUTION * 24 * 60 * 60 * 1000);
}

/**
 * L'auteur de ce signalement pourra-t-il contester la décision prise ? Une
 * notification de contenu envoyée depuis un compte (`canContestReport`) : le
 * signalement est alors gardé le temps de ce délai (`reportRetainedUntil`).
 */
export function notifierMayContest(report: { category: ReportCategory; reporterUserId: number | null }): boolean {
  return report.reporterUserId !== null && NOTIFIER_CONTESTABLE_CATEGORIES.includes(report.category);
}

/**
 * Date d'effacement d'un signalement archivé, **telle que la purge la tient**
 * (`purgeExpiredReports`) : trente jours après l'archivage, repoussés tant
 * qu'un logo masqué — ou supprimé, le temps que sa décision se conteste —
 * reste attaché au dossier, et, quand son auteur peut contester la décision
 * (`notifierMayContest`), jusqu'à la fin de ce délai — six mois civils après
 * l'archivage, comme la quarantaine : effacé au trentième jour, le signalement
 * ne serait plus contestable, et l'art. 20.1 du règlement sur les services
 * numériques qu'on invoque en demande six. Le panneau l'annonce ; sans ces
 * prolongations, il annoncerait une date que la purge ne respecte pas.
 */
export function reportRetainedUntil(
  resolvedAt: Date,
  quarantines: readonly Pick<LogoQuarantineView, "status" | "purgeAfter">[],
  heldForNotifier = false,
): Date {
  let until = reportPurgeDate(resolvedAt);
  if (heldForNotifier) {
    const contestEnd = logoQuarantinePurgeDate(resolvedAt);
    if (contestEnd.getTime() > until.getTime()) until = contestEnd;
  }
  for (const quarantine of quarantines) {
    if (quarantine.status === "RESTORED") continue;
    const end = new Date(quarantine.purgeAfter);
    if (end.getTime() > until.getTime()) until = end;
  }
  return until;
}

/**
 * Cible déduite de la page d'où l'on signale : ouvert depuis la fiche d'une
 * équipe, le formulaire la propose déjà. Seules les trois fiches publiques d'une
 * entité sont reconnues.
 */
export function reportTargetFromPath(pathname: string | null | undefined): ReportTargetRef | null {
  if (!pathname) return null;
  const match = /^\/(equipes|joueurs|tournois)\/(\d{1,15})\/?$/.exec(pathname);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const type: ReportTargetType = match[1] === "equipes" ? "TEAM" : match[1] === "joueurs" ? "USER" : "TOURNAMENT";
  return { type, id };
}

/** Chemin de la fiche d'une cible. */
export function reportTargetHref(target: ReportTargetRef): string {
  switch (target.type) {
    case "USER":
      return `/joueurs/${target.id}`;
    case "TEAM":
      return `/equipes/${target.id}`;
    case "TOURNAMENT":
      return `/tournois/${target.id}`;
  }
}

/** Cible telle que la ligne Discord la connaît : un libellé, jamais pour un joueur. */
export interface ReportAlertTarget {
  type: ReportTargetType;
  label: string | null;
}

function plural(count: number, type: ReportTargetType): string {
  const labels = REPORT_TARGET_LABELS[type];
  return `${count} ${count > 1 ? labels.many : labels.one}`;
}

/**
 * Ligne Discord d'un nouveau signalement (canal de logs, et message privé au
 * propriétaire et au président de l'association).
 *
 * Les joueurs sont **comptés**, jamais nommés ; équipes et tournois sont nommés
 * — c'est ce qui permet de juger l'urgence sans ouvrir le panneau. Le lien mène
 * au signalement lui-même.
 */
export function formatReportAlert(input: {
  id: number;
  category: ReportCategory;
  targets: ReportAlertTarget[];
  fromMember: boolean;
  adminUrl: string;
}): string {
  const definition = REPORT_CATEGORY_DEFINITIONS[input.category];
  const parts: string[] = [];
  for (const type of REPORT_TARGET_TYPES) {
    const ofType = input.targets.filter((target) => target.type === type);
    if (ofType.length === 0) continue;
    if (type === "USER") {
      parts.push(plural(ofType.length, type));
      continue;
    }
    const names = ofType
      .map((target) => target.label)
      .filter((label): label is string => Boolean(label))
      .map(discordInline);
    parts.push(names.length > 0 ? `${plural(ofType.length, type)} (${names.join(", ")})` : plural(ofType.length, type));
  }
  const scope = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
  const author = input.fromMember ? "un membre" : "un visiteur";
  return `🚩 Signalement #${input.id} · ${definition.label}${scope}. Envoyé par ${author}. À traiter : ${input.adminUrl}`;
}

/** Adresse du panneau ouverte sur un signalement. */
export function reportAdminHref(id: number): string {
  return `${REPORTS_ADMIN_PATH}?id=${id}`;
}

/**
 * Page d'un signalement **pour les personnes qu'il vise** : ce qu'il reproche,
 * et le moyen de le contester. C'est le lien du message privé qui les prévient.
 */
export function reportConcernedHref(id: number): string {
  return `/signalements/${id}`;
}

/** Ce qu'il faut savoir d'un lecteur pour dire si un signalement le vise. */
export interface ReportConcernViewer {
  userId: number;
  /** Équipes dont il est membre **aujourd'hui** (appartenance en cours). */
  teamIds: readonly number[];
}

/**
 * Ce signalement vise-t-il ce lecteur ?
 *
 * Oui s'il le désigne comme joueur, ou s'il désigne une équipe dont il est
 * membre aujourd'hui — l'appartenance **au moment où l'on conteste**, pas au
 * moment du signalement : c'est l'équipe d'aujourd'hui qui répond de son logo
 * d'aujourd'hui. Un tournoi visé ne concerne personne en particulier
 * (`CONTESTABLE_TARGET_TYPES`), et une contestation ne se conteste pas.
 */
export function isConcernedByReport(
  viewer: ReportConcernViewer,
  report: { category: ReportCategory; targets: readonly ReportTargetRef[] },
): boolean {
  if (report.category === "CONTEST") return false;
  return report.targets.some(
    (target) =>
      (target.type === "USER" && target.id === viewer.userId) ||
      (target.type === "TEAM" && viewer.teamIds.includes(target.id)),
  );
}

/**
 * Catégories dont l'auteur peut contester la décision : les notifications d'un
 * contenu du site (DSA, art. 16), seules à aboutir à une décision de
 * modération. La liste sert aussi la requête du formulaire
 * (`listContestableReports`), pour que les deux disent la même règle.
 */
export const NOTIFIER_CONTESTABLE_CATEGORIES: readonly ReportCategory[] = ["COPYRIGHT", "MODERATION"];

/**
 * Ce lecteur peut-il contester ce signalement ?
 *
 * Deux publics, deux moments. Une **personne visée** conteste à tout moment
 * (`isConcernedByReport`) : ce qu'elle conteste, c'est le signalement et ce
 * qu'il a fait décider sur son image. L'**auteur du signalement**, lui,
 * conteste la **décision prise** sur sa notification — y compris celle de ne
 * pas agir —, donc une fois le dossier archivé : c'est l'ouverture de la
 * réclamation que l'art. 20.1 du règlement sur les services numériques fait à
 * l'auteur d'une notification. Il faut un compte : c'est le seul moyen de le
 * reconnaître comme l'auteur. Seulement pour une notification de **contenu**
 * (`NOTIFIER_CONTESTABLE_CATEGORIES`) : un bug ou une demande RGPD archivés
 * n'ont pas de décision de modération à contester.
 */
export function canContestReport(
  viewer: ReportConcernViewer,
  report: {
    category: ReportCategory;
    status: ReportStatus;
    reporterUserId: number | null;
    targets: readonly ReportTargetRef[];
  },
): boolean {
  if (report.category === "CONTEST") return false;
  if (isConcernedByReport(viewer, report)) return true;
  return (
    NOTIFIER_CONTESTABLE_CATEGORIES.includes(report.category) &&
    report.reporterUserId === viewer.userId &&
    report.status === "RESOLVED"
  );
}

/**
 * Message privé aux personnes visées par un signalement : les joueurs désignés
 * et les membres des équipes désignées.
 *
 * Un seul texte pour tous — il ne nomme donc ni le joueur, ni l'équipe, ni
 * l'auteur du signalement : le lien mène à une page qui, elle, ne s'ouvre qu'à
 * qui est visé. Il dit ce qui est en cause (la catégorie), qu'aucune décision
 * n'est prise, et comment répondre.
 */
export function formatTargetNotice(input: { category: ReportCategory; url: string }): string {
  const label = REPORT_CATEGORY_DEFINITIONS[input.category].label;
  return (
    `⚠️ BlueGenji — Un signalement (${label}) te concerne, toi ou ton équipe. ` +
    `L'association l'examine : aucune décision n'est prise à ce stade. ` +
    `Consulte-le et, s'il est infondé, conteste-le ici : ${input.url}`
  );
}

/**
 * Ligne Discord d'une contestation (canal de logs, propriétaire, président).
 * Même règle que `formatReportAlert` : ni pseudo, ni description.
 */
export function formatContestAlert(input: {
  contestId: number;
  parentId: number;
  parentCategory: ReportCategory;
  reopened: boolean;
  /** Qui conteste : une personne visée, ou l'auteur du signalement (`canContestReport`). */
  by: "TARGET" | "NOTIFIER";
  adminUrl: string;
}): string {
  const label = REPORT_CATEGORY_DEFINITIONS[input.parentCategory].label;
  const state = input.reopened ? " Le signalement était archivé : il est réactivé." : "";
  const author = input.by === "NOTIFIER" ? "l'auteur du signalement" : "une personne visée";
  return (
    `⚖️ Contestation #${input.contestId} du signalement #${input.parentId} (${label}), ` +
    `envoyée par ${author}.${state} À traiter : ${input.adminUrl}`
  );
}

/**
 * Ce que le formulaire dit **avant** l'envoi, et que la case de consentement —
 * là où la catégorie en demande une — accepte. Écrit ici, et non dans le
 * composant, parce que ces phrases engagent l'association : ce qu'on collecte,
 * pourquoi, qui le lit, combien de temps. Base légale et droits dépendent de la
 * catégorie : `reportLegalBasisNotice`, `reportRightsNotice`.
 */
export const REPORT_PRIVACY_NOTICE = {
  controller: "Responsable : l'association Bluegenji Esport.",
  purpose:
    "Finalité : traiter ton signalement (vérifier, retirer un contenu, corriger un bug) et pouvoir te recontacter à son sujet.",
  data:
    "Données : la catégorie, ta description, les joueurs, équipes ou tournois désignés, la page d'où tu signales, ton compte si tu es connecté, et le nom et l'adresse que tu indiques.",
  recipients:
    "Destinataires : les administrateurs de l'association. Une alerte part sur Discord, sans ton nom, ton adresse, ta description ni le pseudo d'un joueur. Les joueurs et les membres des équipes visés peuvent lire ta description pour y répondre — jamais ton nom, ton adresse ni ton compte — et en sont prévenus par message, sauf depuis un compte tout juste créé ou au-delà d'une limite quotidienne par compte.",
  contestRecipients:
    "Destinataires : les administrateurs de l'association. Une alerte part sur Discord, sans ton nom, ta description ni ton pseudo. Ni l'auteur du signalement ni les personnes qu'il vise ne sont informés de ta contestation.",
  // La prolongation est dite ici, et non seulement sur `/rgpd` : c'est cette
  // phrase-là que le signalant lit avant d'envoyer.
  retention: `Durée : le temps du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa résolution — le signalement est alors effacé. Si un logo ou un avatar est masqué ou supprimé à sa suite, il est gardé jusqu'à l'échéance de la contestation (${LOGO_QUARANTINE_MONTHS} mois au plus). Un signalement de droit d'auteur ou de modération envoyé depuis ton compte est gardé ${LOGO_QUARANTINE_MONTHS} mois après sa résolution, le temps que tu puisses contester la décision.`,
} as const;

/**
 * Base légale annoncée par le formulaire, **selon la catégorie** : une seule
 * phrase pour toutes invitait à « consentir » à l'exercice d'un droit.
 */
export function reportLegalBasisNotice(category: ReportCategory): string {
  switch (category) {
    case "RGPD":
      return "Base légale : l'obligation légale de répondre à une demande d'exercice des droits (RGPD, art. 6.1.c et 12). Aucun accord n'est demandé : ta demande sera traitée.";
    case "COPYRIGHT":
    case "MODERATION":
      return "Base légale : l'obligation faite à l'hébergeur de traiter les notifications de contenu illicite (règlement européen sur les services numériques, art. 16). Aucun accord n'est demandé : ta notification sera traitée.";
    case "HOSTING":
      return "Base légale : l'obligation faite à l'hébergeur de recevoir et de traiter les demandes qui lui sont adressées, dont celles des autorités (règlement européen sur les services numériques, art. 11 et 16). Aucun accord n'est demandé : ta demande sera traitée.";
    case "CONTEST":
      return "Base légale : l'obligation de permettre la contestation d'une décision de modération (règlement européen sur les services numériques, art. 20). Aucun accord n'est demandé : ta contestation sera examinée.";
    default:
      return "Base légale : ton consentement, donné par la case ci-dessous.";
  }
}

/** Droits annoncés par le formulaire ; le retrait du consentement n'est dit que là où il existe. */
export function reportRightsNotice(category: ReportCategory): string {
  const channel =
    "par ce formulaire (catégorie « RGPD ») ou auprès de la personne à contacter pour tes données (politique de confidentialité, section « Exercer vos droits »)";
  if (reportRequiresConsent(category)) {
    return `Tu peux demander l'accès, la rectification ou l'effacement de ces données, ou retirer ton consentement, ${channel}.`;
  }
  // L'effacement ne peut pas être promis tant que la demande doit être
  // traitée : le traitement est alors nécessaire au respect d'une obligation
  // légale (RGPD, art. 17.3.b).
  return `Tu peux demander l'accès à ces données ou leur rectification ${channel} ; leur effacement, une fois la demande traitée — pas avant, l'association étant tenue de la traiter (RGPD, art. 17.3.b).`;
}

/**
 * Ce que contient un signalement de droit d'auteur — **la** liste, lue par le
 * formulaire, les mentions légales, les conditions d'utilisation, `/rgpd` et la
 * fiche T11 du registre. Trois versions en circulaient (l'une disait
 * « adresse », qui se lit postale, une autre oubliait la qualité) : elle suit
 * désormais les champs que le formulaire exige, dans leur ordre.
 */
export const COPYRIGHT_NOTICE_ELEMENTS: readonly string[] = [
  "le nom ou la raison sociale de son auteur",
  "son adresse électronique",
  "sa qualité (titulaire des droits, représentant ou tiers)",
  "le contenu visé et où le voir sur le site",
  "la raison de la demande",
  "une déclaration de bonne foi",
];

/** `COPYRIGHT_NOTICE_ELEMENTS` en une énumération française (« a, b et c »). */
export function copyrightNoticeElementsText(): string {
  const items = [...COPYRIGHT_NOTICE_ELEMENTS];
  const last = items.pop();
  return items.length === 0 ? (last ?? "") : `${items.join(", ")} et ${last}`;
}

/**
 * Ce que l'auteur d'une notification de contenu illicite reçoit en retour
 * (DSA, art. 16.4 et 16.5). Le site n'envoie aucun courriel : ces réponses
 * partent de l'association, à la main, à l'adresse que la notification porte
 * (exigée en droit d'auteur) — le panneau de traitement le rappelle
 * (`reportFollowUpDuty`).
 */
export const NOTIFIER_FOLLOW_UP =
  "L'auteur d'une notification reçoit, à l'adresse qu'il indique (exigée en droit d'auteur, facultative ailleurs), un accusé de réception, puis la décision prise à son sujet et les voies de recours qui lui sont ouvertes. S'il a signalé depuis son compte, il peut contester cette décision — y compris celle de ne pas agir — par la catégorie « Contestation » du même formulaire, une fois le signalement archivé.";

/**
 * Le retour que l'association **doit** à l'auteur d'un signalement, rappelé
 * dans le panneau de traitement — `null` quand aucun n'est dû.
 */
export function reportFollowUpDuty(category: ReportCategory): string | null {
  switch (category) {
    case "COPYRIGHT":
      return "Notification de contenu illicite : accuser réception à l'adresse indiquée, puis notifier la décision et les voies de recours (DSA, art. 16.4 et 16.5).";
    case "MODERATION":
      return "Notification d'un contenu du site : si une adresse ou un tag Discord certifié le permet, accuser réception, puis notifier la décision et les voies de recours (DSA, art. 16.4 et 16.5).";
    case "CONTEST":
      return "Contestation : notifier la décision motivée à la personne qui conteste, à l'adresse indiquée ou à son tag Discord certifié (DSA, art. 20.5).";
    case "RGPD":
      return "Demande d'exercice des droits : répondre dans le mois (RGPD, art. 12), à l'adresse indiquée ou au tag Discord certifié du compte.";
    case "HOSTING":
      return "Demande adressée à l'hébergeur : accuser réception et répondre, à l'adresse indiquée ou au tag Discord certifié du compte.";
    default:
      return null;
  }
}

/** Phrase française d'un refus de la route, jamais le jeton lui-même. */
export function reportErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "REPORT_INVALID_CATEGORY":
      return "Choisis une catégorie.";
    case "REPORT_DESCRIPTION_TOO_SHORT":
      return `Décris le problème en ${REPORT_DESCRIPTION_MIN_LENGTH} caractères au moins.`;
    case "REPORT_DESCRIPTION_TOO_LONG":
      return `La description dépasse ${REPORT_DESCRIPTION_MAX_LENGTH} caractères.`;
    case "REPORT_INVALID_TARGET":
    case "REPORT_TARGET_NOT_FOUND":
      return "Un des éléments désignés n'existe plus. Retire-le et réessaie.";
    case "REPORT_TARGET_NOT_ALLOWED":
      return "Cette catégorie ne permet pas de désigner cet élément.";
    case "REPORT_TOO_MANY_TARGETS":
      return `Tu peux désigner ${REPORT_MAX_TARGETS} éléments au plus.`;
    case "REPORT_CONTACT_REQUIRED":
      return "Indique ton nom et une adresse électronique : un signalement de droit d'auteur doit pouvoir être suivi.";
    case "REPORT_REPLY_CHANNEL_REQUIRED":
      return "Indique une adresse électronique pour qu'on puisse te répondre : sans compte, ou sans tag Discord certifié, c'est le seul moyen.";
    case "REPORT_CONTACT_TOO_LONG":
      return "Le nom indiqué est trop long.";
    case "REPORT_INVALID_EMAIL":
      return "L'adresse électronique n'est pas valide.";
    case "REPORT_RIGHTS_RELATION_REQUIRED":
      return "Indique ta qualité vis-à-vis des droits invoqués.";
    case "REPORT_GOOD_FAITH_REQUIRED":
      return "Coche la déclaration de bonne foi.";
    case "REPORT_CONSENT_REQUIRED":
      return "Accepte le traitement de tes données pour envoyer le signalement.";
    case "REPORT_PARENT_REQUIRED":
      return "Choisis le signalement que tu contestes.";
    case "REPORT_CONTEST_LOGIN_REQUIRED":
      return "Connecte-toi pour contester un signalement qui te concerne.";
    case "REPORT_TARGETS_REQUIRE_LOGIN":
      return "Connecte-toi pour désigner des joueurs, équipes ou tournois — ou décris-les dans ton message.";
    case "REPORT_NOT_CONCERNED":
      return "Tu ne peux contester qu'un signalement qui te vise, toi ou une équipe dont tu es membre — ou la décision prise sur un signalement de droit d'auteur ou de modération que tu as envoyé, une fois le dossier archivé.";
    case "REPORTS_SATURATED":
      return "Trop de signalements reçus en peu de temps. Réessaie plus tard, ou écris-nous sur Discord.";
    case "TOO_MANY_REQUESTS":
      return "Tu as envoyé plusieurs signalements d'affilée. Patiente un peu avant de recommencer.";
    default:
      return "Le signalement n'a pas pu être envoyé. Réessaie dans un instant.";
  }
}

/**
 * Signalements par heure, **tous auteurs confondus**, au-delà desquels la
 * direction n'est plus alertée **un par un**.
 *
 * Chaque signalement écrit en privé au propriétaire et au président de
 * l'association : sans borne globale, un script ferait vibrer leur téléphone
 * sans fin. Mais ce plafond a d'abord **refusé le dépôt** (429), et c'était un
 * seau commun que n'importe qui pouvait vider — cinq envois par demi-heure et
 * par IP, donc six IP pour le tenir plein en continu, et avec lui **tous** les
 * signalements : notification d'un contenu illicite (LCEN, DSA), demande RGPD,
 * question d'hébergeur, c'est-à-dire le canal que le site met au pied de
 * chaque page. Ce qui
 * doit être borné est l'**alerte**, pas le dépôt : au-delà, le signalement est
 * enregistré et visible au panneau, et une seule alerte par heure dit que les
 * suivants n'en feront plus (`reportAlertMode`). Soixante par heure, c'est bien au-delà
 * de ce qu'une communauté amateur produit en une soirée agitée.
 */
export const REPORTS_HOURLY_CAP = 60;

/**
 * Signalements par heure au-delà desquels le dépôt **est** refusé
 * (`REPORTS_SATURATED`) — une borne sur la croissance de la table, pas sur le
 * bruit. Dix fois le plafond d'alerte : la tenir pleine demande une soixantaine
 * d'IP qui envoient sans relâche, là où six suffisaient à fermer le canal.
 */
export const REPORTS_HOURLY_HARD_CAP = 600;

/**
 * Ce que la direction reçoit pour un signalement de plus : une alerte (`ALERT`),
 * l'alerte unique qui annonce la saturation (`SATURATION_NOTICE`), ou rien
 * (`SILENT`) — le signalement est alors au panneau, sans message.
 */
export type ReportAlertMode = "ALERT" | "SATURATION_NOTICE" | "SILENT";

/** Intervalle minimal entre deux alertes de saturation. */
export const REPORTS_SATURATION_NOTICE_INTERVAL_MS = 60 * 60_000;

/**
 * L'annonce de saturation ne tient pas au franchissement **exact** du plafond :
 * le compte de l'heure est lu sans verrou, et deux envois simultanés peuvent
 * lire 59 puis le suivant 61 — l'annonce ne partirait jamais, et la direction
 * cesserait d'être alertée sans savoir pourquoi. Elle part donc au premier
 * signalement au-delà du plafond depuis la dernière annonce, au plus une fois
 * par `REPORTS_SATURATION_NOTICE_INTERVAL_MS`.
 *
 * @param receivedInLastHour Signalements reçus dans l'heure **avant** celui-ci.
 * @param lastNoticeAt Instant de la dernière annonce (ms), `null` s'il n'y en a pas eu.
 * @param now Instant présent (ms).
 */
export function reportAlertMode(
  receivedInLastHour: number,
  lastNoticeAt: number | null,
  now: number,
): ReportAlertMode {
  if (receivedInLastHour < REPORTS_HOURLY_CAP) return "ALERT";
  if (lastNoticeAt === null || now - lastNoticeAt >= REPORTS_SATURATION_NOTICE_INTERVAL_MS) {
    return "SATURATION_NOTICE";
  }
  return "SILENT";
}

/**
 * L'alerte unique qui remplace les suivantes, une fois le plafond horaire
 * franchi. Ni pseudo ni description, comme toute alerte de signalement.
 */
export function formatReportsSaturatedAlert(input: { adminUrl: string }): string {
  return (
    `🚩 Plus de ${REPORTS_HOURLY_CAP} signalements reçus en une heure : les suivants sont enregistrés ` +
    `sans alerte jusqu'à ce que le rythme retombe. Afflux inhabituel — à vérifier : ${input.adminUrl}`
  );
}

/**
 * Signalements **désignant des cibles** qu'un même compte peut faire suivre,
 * par 24 heures, d'un message aux personnes visées.
 *
 * Désigner une équipe fait écrire le bot à chacun de ses membres : sans borne
 * par auteur, quelques comptes — gratuits par OAuth — suffisaient à écrire
 * chaque jour à tous les joueurs du site, dix cibles par envoi, et le bot
 * risquait d'être classé comme spammeur par Discord (ce qui couperait aussi la
 * connexion par code). Au-delà, le signalement est enregistré et reste
 * consultable par les personnes visées ; seul le message de plus est retenu.
 */
export const REPORT_TARGET_NOTICES_DAILY_CAP = 3;

/**
 * Ancienneté minimale, en heures, du compte dont un signalement fait prévenir
 * les personnes visées — un compte ouvert pour l'occasion ne fait écrire le bot
 * à personne. Le signalement, lui, est enregistré et traité normalement.
 */
export const REPORT_TARGET_NOTICE_MIN_ACCOUNT_AGE_HOURS = 48;

/**
 * Le signalement de ce compte peut-il faire écrire aux personnes visées ?
 *
 * @param input.accountAgeHours Ancienneté du compte auteur.
 * @param input.earlierReportsWithTargets Signalements du même compte désignant un joueur ou une équipe
 *   dans les 24 dernières heures, **celui-ci exclu**.
 */
export function reporterMayWarnTargets(input: { accountAgeHours: number; earlierReportsWithTargets: number }): boolean {
  return (
    input.accountAgeHours >= REPORT_TARGET_NOTICE_MIN_ACCOUNT_AGE_HOURS &&
    input.earlierReportsWithTargets < REPORT_TARGET_NOTICES_DAILY_CAP
  );
}

/**
 * Délai pendant lequel une cible déjà visée par un signalement n'est **pas**
 * reprévenue par un nouveau.
 *
 * Le message privé part avant que quiconque ait lu le signalement : sans cette
 * borne, le formulaire ferait écrire le bot à une équipe entière à chaque envoi
 * — cinq fois par demi-heure et par compte, davantage avec des comptes
 * secondaires. Un signalement de plus dans la journée reste visible, et
 * contestable, depuis le formulaire (catégorie « Contestation ») ; seul le
 * message de plus est retenu.
 */
export const REPORT_TARGET_NOTICE_COOLDOWN_HOURS = 24;

/** Une cible telle que le panneau la montre, relue au moment de l'affichage. */
export interface ReportTargetView {
  type: ReportTargetType;
  id: number;
  /** Libellé actuel, ou relevé à l'envoi si l'entité a disparu. */
  label: string;
  /** La fiche existe encore. */
  exists: boolean;
  /** Image publiée : logo d'équipe, avatar visible, illustration de tournoi. */
  imageUrl: string | null;
  /** Précision courte (sigle, « équipe fantôme », état du tournoi…). */
  detail: string | null;
}

export interface ReportPerson {
  userId: number;
  pseudo: string;
}

/** Un signalement tel que le panneau d'administration le reçoit. */
export interface ReportView {
  id: number;
  category: ReportCategory;
  status: ReportStatus;
  description: string;
  pagePath: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Date d'effacement, pour un signalement archivé. */
  purgeAt: string | null;
  reporter: ReportPerson | null;
  contactName: string | null;
  contactEmail: string | null;
  rightsRelation: RightsRelation | null;
  assignee: ReportPerson | null;
  resolutionNote: string | null;
  targets: ReportTargetView[];
  /** Contestations reçues, de la plus ancienne à la plus récente. */
  contests: ReportContestView[];
  /** Logos masqués au titre de ce signalement (`lib/shared/logo-quarantine.ts`). */
  quarantines: LogoQuarantineView[];
}

/** Une contestation, rangée sous son signalement d'origine dans le panneau. */
export interface ReportContestView {
  id: number;
  description: string;
  createdAt: string;
  author: ReportPerson | null;
  contactEmail: string | null;
}

/**
 * Un signalement tel que le lit **une personne qu'il vise** : ce qui est
 * reproché, et à qui — mais jamais qui le reproche (ni compte, ni nom, ni
 * adresse du signalant). Les cibles se limitent à celles qui la concernent :
 * les autres joueurs visés n'ont pas à lui être nommés.
 */
export interface ConcernedReportView {
  id: number;
  category: ReportCategory;
  status: ReportStatus;
  description: string;
  createdAt: string;
  targets: ReportTargetView[];
  /** Contestations déjà envoyées par ce lecteur. */
  myContests: { id: number; createdAt: string; description: string }[];
  /** Logos de ses équipes masqués au titre de ce signalement, et leur échéance. */
  quarantines: LogoQuarantineView[];
}

/** Choix du formulaire de contestation : un signalement qui vise le lecteur. */
export interface ContestableReportOption {
  id: number;
  category: ReportCategory;
  createdAt: string;
  status: ReportStatus;
}

/** Proposition du sélecteur de cibles du formulaire. */
export interface ReportTargetOption {
  type: ReportTargetType;
  id: number;
  label: string;
  detail: string | null;
  imageUrl: string | null;
}

/** Longueur minimale d'une recherche de cible. */
export const REPORT_TARGET_SEARCH_MIN_LENGTH = 2;
/** Propositions rendues par recherche. */
export const REPORT_TARGET_SEARCH_LIMIT = 8;
