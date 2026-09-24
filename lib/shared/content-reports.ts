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

import { LOGO_QUARANTINE_DAYS, type LogoQuarantineView } from "./logo-quarantine";

/**
 * Catégories d'un signalement.
 *
 * `CONTEST` n'est pas un signalement comme les autres : c'est la **réponse**
 * d'un joueur visé (ou d'un membre d'une équipe visée) à un signalement qui le
 * concerne. Elle ne désigne rien, elle se rattache à son signalement d'origine
 * (`parentReportId`) et se range sous lui dans le panneau.
 */
export type ReportCategory = "COPYRIGHT" | "MODERATION" | "BUG" | "OTHER" | "CONTEST";

/** Ce qu'un signalement peut viser. */
export type ReportTargetType = "USER" | "TEAM" | "TOURNAMENT";

/** Cycle de vie : à traiter, pris en charge, résolu (archivé). */
export type ReportStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

/** Gestes du panneau d'administration. */
export type ReportAction = "TAKE" | "RELEASE" | "RESOLVE" | "REOPEN";

/** Qualité du signalant vis-à-vis d'un droit d'auteur invoqué. */
export type RightsRelation = "HOLDER" | "AGENT" | "THIRD_PARTY";

export const REPORT_CATEGORIES: readonly ReportCategory[] = ["COPYRIGHT", "MODERATION", "BUG", "OTHER", "CONTEST"];

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
    descriptionPlaceholder:
      "Quelle œuvre est reproduite, où la voir sur le site, et à qui elle appartient…",
  },
  MODERATION: {
    label: "Modération",
    hint: "Un pseudo, un nom d'équipe ou un comportement contraire aux règles.",
    icon: "⚑",
    targets: ["USER", "TEAM"],
    requiresContact: false,
    requiresRightsDeclaration: false,
    descriptionPlaceholder: "Ce qui s'est passé, où et quand…",
  },
  BUG: {
    label: "Bug",
    hint: "Une page qui ne s'affiche pas, un bouton qui ne répond pas.",
    icon: "⚙",
    targets: [],
    requiresContact: false,
    requiresRightsDeclaration: false,
    descriptionPlaceholder: "Ce que tu faisais, ce que tu attendais, ce qui s'est passé…",
  },
  OTHER: {
    label: "Autre",
    hint: "Tout ce qui ne rentre dans aucune case ci-dessus.",
    icon: "✉",
    targets: ["USER", "TEAM", "TOURNAMENT"],
    requiresContact: false,
    requiresRightsDeclaration: false,
    descriptionPlaceholder: "Explique-nous le problème…",
  },
  CONTEST: {
    label: "Contestation",
    hint: "Répondre à un signalement qui te vise, toi ou ton équipe.",
    icon: "⚖",
    targets: [],
    requiresContact: false,
    requiresRightsDeclaration: false,
    descriptionPlaceholder:
      "Pourquoi le signalement est infondé : licence, autorisation du titulaire, création de l'équipe, contexte…",
  },
};

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
  return value.length <= REPORT_CONTACT_EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
  if (/[\u0000-\u001F\u007F\s]/.test(path)) return null;
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

  if (raw.consent !== true) return { ok: false, error: "REPORT_CONSENT_REQUIRED" };

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
 * Date d'effacement d'un signalement archivé, **telle que la purge la tient**
 * (`purgeExpiredReports`) : trente jours après l'archivage, repoussés tant
 * qu'un logo masqué — ou supprimé, le temps que sa décision se conteste —
 * reste attaché au dossier. Le panneau l'annonce ; sans les quarantaines, il
 * annoncerait une date que la purge ne respecte pas.
 */
export function reportRetainedUntil(
  resolvedAt: Date,
  quarantines: readonly Pick<LogoQuarantineView, "status" | "purgeAfter">[],
): Date {
  let until = reportPurgeDate(resolvedAt);
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
    const names = ofType.map((target) => target.label).filter((label): label is string => Boolean(label));
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
  adminUrl: string;
}): string {
  const label = REPORT_CATEGORY_DEFINITIONS[input.parentCategory].label;
  const state = input.reopened ? " Le signalement était archivé : il est réactivé." : "";
  return (
    `⚖️ Contestation #${input.contestId} du signalement #${input.parentId} (${label}), ` +
    `envoyée par une personne visée.${state} À traiter : ${input.adminUrl}`
  );
}

/**
 * Ce que le formulaire dit **avant** l'envoi, et que la case de consentement
 * accepte. Écrit ici, et non dans le composant, parce que ces phrases engagent
 * l'association : ce qu'on collecte, pourquoi, qui le lit, combien de temps.
 */
export const REPORT_PRIVACY_NOTICE = {
  controller: "Responsable : l'association Bluegenji Esport.",
  purpose:
    "Finalité : traiter ton signalement (vérifier, retirer un contenu, corriger un bug) et pouvoir te recontacter à son sujet.",
  data:
    "Données : la catégorie, ta description, les joueurs, équipes ou tournois désignés, la page d'où tu signales, ton compte si tu es connecté, et le nom et l'adresse que tu indiques.",
  recipients:
    "Destinataires : les administrateurs de l'association. Une alerte part sur Discord, sans ton nom, ton adresse, ta description ni le pseudo d'un joueur. Les joueurs et les membres des équipes visés sont prévenus et peuvent lire ta description pour y répondre — jamais ton nom, ton adresse ni ton compte.",
  contestRecipients:
    "Destinataires : les administrateurs de l'association. Une alerte part sur Discord, sans ton nom, ta description ni ton pseudo. L'auteur du signalement n'est pas informé de ta contestation.",
  // La prolongation est dite ici, et non seulement sur `/rgpd` : c'est cette
  // phrase-là que la case de consentement accepte.
  retention: `Durée : le temps du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa résolution — le signalement est alors effacé. Si un logo est masqué ou supprimé à sa suite, il est gardé jusqu'à l'échéance de la contestation (${LOGO_QUARANTINE_DAYS / 30} mois au plus).`,
  legalBasis:
    "Base légale : ton consentement, et pour un contenu illicite l'obligation faite à l'hébergeur de traiter les notifications (règlement européen sur les services numériques, art. 16).",
  rights:
    "Tu peux demander l'accès, la rectification ou l'effacement de ces données, ou retirer ton consentement, en écrivant à l'association (voir la politique de confidentialité).",
} as const;

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
      return "Tu ne peux contester qu'un signalement qui te vise, toi ou une équipe dont tu es membre.";
    case "REPORTS_SATURATED":
      return "Trop de signalements reçus en peu de temps. Réessaie dans une heure, ou écris-nous sur Discord.";
    case "TOO_MANY_REQUESTS":
      return "Tu as envoyé plusieurs signalements d'affilée. Patiente un peu avant de recommencer.";
    default:
      return "Le signalement n'a pas pu être envoyé. Réessaie dans un instant.";
  }
}

/**
 * Plafond de signalements reçus par heure, **tous auteurs confondus**.
 *
 * Le plafond par auteur (`REPORT_SUBMIT_RULE`) ne borne rien quand l'appelant
 * n'a ni compte ni adresse identifiable, et chaque signalement écrit en privé
 * au propriétaire et au président de l'association : sans borne globale, un
 * script ferait vibrer leur téléphone sans fin. Soixante par heure, c'est bien
 * au-delà de ce qu'une communauté amateur produit en une soirée agitée.
 */
export const REPORTS_HOURLY_CAP = 60;

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
