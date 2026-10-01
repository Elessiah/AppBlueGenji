/**
 * Quarantaine des images signalées (logo d'équipe, avatar de joueur) — module
 * pur.
 *
 * Retirer tout de suite une image signalée pour droit d'auteur, c'est parfois
 * retirer à tort le logo d'une équipe — ou l'avatar d'un joueur — qui en
 * détient les droits. Le panneau propose donc de le **masquer** : le fichier
 * quitte ce que le site sert (il n'est plus en ligne, ce qui éteint la
 * responsabilité d'hébergeur), mais il est gardé à part le temps que la
 * personne concernée puisse contester. Sans contestation, il est supprimé
 * définitivement à l'échéance ; si la contestation aboutit, il est rétabli
 * tel quel.
 *
 * **Six mois civils**, et pas moins : c'est le délai de contestation d'une
 * décision de modération que le règlement européen sur les services numériques
 * fixe aux plateformes en ligne (art. 20.1, « au moins six mois »), et que
 * l'association applique. Six mois **civils** et non 180 jours : 180 jours
 * sont plus courts que six mois à partir d'un 1er mars (184), si bien que la
 * date annoncée tombait avant l'échéance revendiquée. Rien n'oblige à
 * supprimer plus tôt un logo d'équipe ou un avatar ; les garder plus
 * longtemps n'aurait plus d'objet.
 *
 * **Une image contestée n'est jamais supprimée d'office** : l'échéance
 * passée, elle attend que l'association tranche (archivage du signalement, ou
 * rétablissement).
 *
 * Une même ligne désigne **soit** une équipe, **soit** un joueur (§ cible dans
 * `lib/server/logo-quarantine.ts`) : les deux domaines partagent le cycle et la
 * table, mais leurs gestes serveur (fichier partagé, entrée solo à
 * resynchroniser…) restent des implémentations séparées.
 */
import { ANONYMOUS_PLAYER_LABEL } from "./log-privacy";
import { discordInline } from "./discord-text";
import { SUSPENSION_REASON_MAX_LENGTH, SUSPENSION_REASON_MIN_LENGTH, cleanModerationReason } from "./account-suspension";
// Type seul : `content-reports.ts` importe les valeurs de ce module.
import type { ReportCategory } from "./content-reports";

/** Durée de la quarantaine avant suppression définitive, en mois civils. */
export const LOGO_QUARANTINE_MONTHS = 6;

/** État d'un logo mis en quarantaine. */
export type LogoQuarantineStatus = "HIDDEN" | "RESTORED" | "PURGED";

export const LOGO_QUARANTINE_STATUS_LABELS: Record<LogoQuarantineStatus, string> = {
  HIDDEN: "Masqué",
  RESTORED: "Rétabli",
  PURGED: "Supprimé définitivement",
};

/** Ce qu'une ligne de quarantaine désigne : le logo d'une équipe, ou l'avatar d'un joueur. */
export type QuarantineTargetType = "TEAM" | "USER";

/** Une image en quarantaine, tel que le panneau la montre. */
export interface LogoQuarantineView {
  id: number;
  targetType: QuarantineTargetType;
  targetId: number;
  /** Nom de l'équipe, ou pseudo du joueur. */
  targetName: string;
  reportId: number | null;
  status: LogoQuarantineStatus;
  hiddenAt: string;
  /** Échéance de la suppression définitive sans contestation. */
  purgeAfter: string;
  closedAt: string | null;
}

const PARIS_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** L'heure de Paris d'un instant, écrite comme si c'était de l'UTC (ms, à la seconde). */
function parisWallClock(instant: number): number {
  const parts: Record<string, number> = {};
  for (const part of PARIS_PARTS.formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Échéance de la suppression définitive d'une image masquée à `hiddenAt` :
 * **six mois civils plus tard, au calendrier de Paris** — celui de la date
 * annoncée à l'équipe (`formatQuarantineDate`). Compter au calendrier UTC ne
 * suffit pas : masqué le 1er mars à 0 h 30 à Paris (le 28 février en UTC), le
 * logo aurait été supprimé le 29 août au lieu du 1er septembre.
 *
 * Un quantième absent du mois d'arrivée (31 août + 6 mois) déborde sur le mois
 * suivant : le délai s'allonge de quelques jours, il ne raccourcit jamais. Pour
 * la même raison, une heure avalée par un changement d'heure est rendue.
 */
export function logoQuarantinePurgeDate(hiddenAt: Date): Date {
  const from = new Date(parisWallClock(hiddenAt.getTime()));
  const target = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth() + LOGO_QUARANTINE_MONTHS,
    from.getUTCDate(),
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
  );
  // Heure de Paris → instant : l'écart du fuseau se lit à l'arrivée ; deux
  // passes le stabilisent autour d'un changement d'heure.
  let instant = target - (parisWallClock(target) - target);
  instant = target - (parisWallClock(instant) - instant);
  while (parisWallClock(instant) < target) instant += HOUR_MS;
  return new Date(instant + hiddenAt.getUTCMilliseconds());
}

/**
 * Le logo peut-il être supprimé d'office ?
 *
 * Oui une fois l'échéance passée, **sauf** s'il a été contesté et que
 * l'association n'a pas encore tranché — un signalement contesté encore ouvert
 * garde son logo en attente, quelle que soit la date.
 */
export function canAutoPurgeLogo(input: {
  purgeAfter: Date;
  now: Date;
  contested: boolean;
  /** Le signalement d'origine est archivé, ou n'existe plus. */
  reportSettled: boolean;
}): boolean {
  if (input.purgeAfter.getTime() > input.now.getTime()) return false;
  return !input.contested || input.reportSettled;
}

/**
 * Date lisible d'une échéance, **en heure de Paris** : le message part d'un
 * serveur pour des lecteurs dont on ne connaît pas le fuseau, il est rédigé une
 * fois pour tous.
 */
export function formatQuarantineDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exposé des motifs d'une décision sur une image.
//
// Masquer ou supprimer une image est une décision de modération : la personne
// concernée doit en recevoir les motifs (DSA, art. 17.3) — ce qui est décidé,
// les faits retenus, le recours ou non à un traitement automatisé, le
// fondement (clause des conditions d'utilisation ou droit d'un tiers) et les
// voies de recours, internes **et** judiciaires. Chaque message ci-dessous les
// donne dans cet ordre ; la phrase de réponse suit le motif, un logo retiré
// comme contraire aux règles n'ayant rien à répondre sur ses droits d'auteur.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ce qui fonde une décision sur une image : l'atteinte présumée aux droits
 * d'un tiers (signalement de droit d'auteur), ou les règles du site (tout le
 * reste, retrait décidé hors de tout signalement compris).
 */
export type ModerationGrounds = "THIRD_PARTY_RIGHTS" | "SITE_RULES";

/** Le fondement d'une décision prise à la suite d'un signalement de cette catégorie (`null` : hors signalement). */
export function moderationGroundsFor(category: ReportCategory | null): ModerationGrounds {
  return category === "COPYRIGHT" ? "THIRD_PARTY_RIGHTS" : "SITE_RULES";
}

/** Ancre des conditions d'utilisation où se lit la clause invoquée (`TERMS_SECTIONS`). */
export const MODERATION_TERMS_ANCHOR = "contenus";

const GROUNDS_TEXT: Record<
  ModerationGrounds,
  { reason: string; clause: string; answer: { you: string; yall: string } }
> = {
  THIRD_PARTY_RIGHTS: {
    reason: "atteinte présumée au droit d'auteur ou aux droits d'un tiers",
    clause:
      "conditions d'utilisation, « Contenus publiés par les utilisateurs » (qui publie une image garantit en détenir les droits)",
    answer: {
      you: "si tu en détiens les droits (création, licence, autorisation du titulaire), dis-le",
      yall: "si vous en détenez les droits (création, licence, autorisation du titulaire), dites-le",
    },
  },
  SITE_RULES: {
    reason: "image jugée contraire aux conditions d'utilisation du site",
    clause: "conditions d'utilisation, « Contenus publiés par les utilisateurs » et « Comportement »",
    answer: {
      you: "si tu estimes que l'image respecte les règles, explique pourquoi",
      yall: "si vous estimez que l'image respecte les règles, expliquez pourquoi",
    },
  },
};

/**
 * Motif exigé quand la modération retire une image **hors de tout
 * signalement** (depuis la fiche d'une équipe ou d'un joueur) : sans lui, le
 * message n'avait aucun fait propre à exposer (DSA, art. 17.3.b). Mêmes bornes
 * que le motif d'une suspension, même nettoyage.
 */
export type ModerationReasonValidation =
  | { ok: true; reason: string }
  | { ok: false; error: "MODERATION_REASON_REQUIRED" | "MODERATION_REASON_TOO_LONG" };

export function validateModerationReason(value: unknown): ModerationReasonValidation {
  const reason = cleanModerationReason(value);
  if (reason.length < SUSPENSION_REASON_MIN_LENGTH) return { ok: false, error: "MODERATION_REASON_REQUIRED" };
  if (reason.length > SUSPENSION_REASON_MAX_LENGTH) return { ok: false, error: "MODERATION_REASON_TOO_LONG" };
  return { ok: true, reason };
}

/**
 * Le motif lu dans un corps de requête reçu tel quel : un corps absent,
 * illisible ou qui n'est pas un objet (`null`, un nombre, une liste) vaut un
 * motif manquant — jamais une exception, que la route laisserait sortir en 500.
 */
export function validateModerationReasonBody(body: unknown): ModerationReasonValidation {
  const reason = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { reason?: unknown }).reason : undefined;
  return validateModerationReason(reason);
}

/** Les refus du motif, dits en français (toasts des fiches d'équipe et de joueur). */
export function moderationReasonErrorMessage(code: string): string {
  return code === "MODERATION_REASON_TOO_LONG"
    ? `Le motif ne peut pas dépasser ${SUSPENSION_REASON_MAX_LENGTH} caractères.`
    : `Décris les faits retenus (${SUSPENSION_REASON_MIN_LENGTH} caractères au moins) : ils sont envoyés avec la décision.`;
}

/**
 * Motif, faits, mode de décision et fondement — les éléments de l'exposé des
 * motifs communs à tous les messages. `termsUrl` mène à la clause invoquée.
 * Hors signalement, les faits sont le motif saisi par la modération
 * (`staffReason`).
 */
function decisionGroundsText(input: {
  grounds: ModerationGrounds;
  fromReport: boolean;
  termsUrl: string;
  staffReason?: string | null;
}): string {
  const text = GROUNDS_TEXT[input.grounds];
  return (
    `Motif : ${text.reason}. Faits retenus : ${decisionFacts(input)}. ` +
    `Décision prise par un membre de la modération, sans traitement automatisé. ` +
    `Fondement : ${text.clause} — ${input.termsUrl}.`
  );
}

/** Faits retenus : le signalement, sinon le constat de la modération (motivé s'il l'est). */
function decisionFacts(input: { fromReport: boolean; staffReason?: string | null }): string {
  if (input.fromReport) {
    return "un signalement visant cette image, consultable avec ce qu'il reproche sur la page indiquée plus bas";
  }
  if (input.staffReason) {
    return `${discordInline(input.staffReason)} (constat de la modération, sans signalement préalable)`;
  }
  return "constat de la modération, sans signalement préalable";
}

/**
 * Voies de recours : la contestation auprès de l'association (par la page du
 * signalement, ou par le formulaire hors signalement), puis le juge.
 */
function redressText(input: { grounds: ModerationGrounds; url: string | null; plural: boolean }): string {
  const answer = GROUNDS_TEXT[input.grounds].answer[input.plural ? "yall" : "you"];
  const contest = input.plural ? "contestez" : "conteste";
  const write = input.plural ? "écrivez" : "écris";
  const internal = input.url
    ? `${contest} la décision ici : ${input.url} — ${answer}`
    : `${write} à l'association (« Signaler un problème », en bas de chaque page) — ${answer}`;
  const judicial = input.plural
    ? "Vous pouvez aussi porter la décision devant le juge compétent."
    : "Tu peux aussi porter la décision devant le juge compétent.";
  return `Recours : ${internal}. ${judicial}`;
}

/**
 * Message privé aux membres d'une équipe dont le logo vient d'être masqué.
 *
 * Il nomme **leur** équipe (c'est à ses membres qu'il s'adresse), dit la
 * décision et ses motifs, l'échéance et le moyen de l'empêcher — et rien de
 * l'auteur du signalement.
 */
export function formatLogoHiddenNotice(input: {
  teamName: string;
  purgeAfter: Date;
  url: string;
  grounds: ModerationGrounds;
  termsUrl: string;
}): string {
  return (
    `🙈 BlueGenji — Le logo de ton équipe « ${discordInline(input.teamName)} » a été masqué à la suite d'un signalement : ` +
    `il n'est plus en ligne, mais il est conservé pour pouvoir être rétabli. ` +
    `${decisionGroundsText({ grounds: input.grounds, fromReport: true, termsUrl: input.termsUrl })} ` +
    `Sans contestation de votre part, il sera supprimé définitivement le ${formatQuarantineDate(input.purgeAfter)}. ` +
    redressText({ grounds: input.grounds, url: input.url, plural: true })
  );
}

/**
 * Le logo a-t-il été supprimé **sans délai**, sans passer par la quarantaine ?
 *
 * Une suppression immédiate s'écrit comme une quarantaine close à l'instant de
 * son ouverture (`hiddenAt === closedAt`) : c'est la même trace, rattachée au
 * même signalement, et elle se lit ainsi partout où une quarantaine se lit.
 */
export function isImmediateLogoRemoval(view: Pick<LogoQuarantineView, "status" | "hiddenAt" | "closedAt">): boolean {
  return view.status === "PURGED" && view.closedAt !== null && view.closedAt === view.hiddenAt;
}

/**
 * Message privé aux membres d'une équipe dont le logo vient d'être supprimé
 * sans délai (contenu manifestement illicite).
 *
 * Même règle que le masquage : l'équipe apprend la décision, ses motifs et le
 * moyen d'y répondre (DSA art. 17). Le lien mène au signalement quand la
 * suppression en découle ; retiré depuis la fiche de l'équipe, hors de tout
 * signalement, le logo n'a pas de page à contester — le message renvoie alors
 * vers l'association.
 */
export function formatLogoRemovedNotice(input: {
  teamName: string;
  url: string | null;
  grounds: ModerationGrounds;
  termsUrl: string;
  /** Motif saisi par la modération, pour un retrait hors signalement. */
  staffReason?: string | null;
}): string {
  return (
    `🗑️ BlueGenji — Le logo de ton équipe « ${discordInline(input.teamName)} » a été supprimé par la modération du site` +
    `${input.url ? " à la suite d'un signalement" : ""}. ` +
    `${decisionGroundsText({ grounds: input.grounds, fromReport: input.url !== null, termsUrl: input.termsUrl, staffReason: input.staffReason })} ` +
    redressText({ grounds: input.grounds, url: input.url, plural: true })
  );
}

/** Message privé aux membres d'une équipe dont le logo est rétabli. */
export function formatLogoRestoredNotice(input: { teamName: string }): string {
  return `✅ BlueGenji — Le logo de ton équipe « ${discordInline(input.teamName)} » a été rétabli : la contestation a été acceptée.`;
}

/** Ligne du journal (canal de logs) d'un logo masqué — nom d'équipe seul. */
export function formatLogoHiddenLog(input: { teamName: string; reportId: number; purgeAfter: Date }): string {
  return (
    `🙈 Logo de l'équipe « ${discordInline(input.teamName)} » masqué par le staff (signalement #${input.reportId}), ` +
    `suppression définitive le ${formatQuarantineDate(input.purgeAfter)} sans contestation.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatars — même cycle, un seul destinataire.
//
// Un logo d'équipe s'adresse à un roster (« ton équipe », mais « vous » pour le
// geste collectif de contester) ; un avatar n'a qu'un titulaire, tout se dit au
// singulier. Les messages sont donc réécrits plutôt que partagés : les
// généraliser aurait produit un « vous » incongru pour un joueur seul, ou un
// gabarit à paramètres qui masque la différence au lieu de la dire.
// ─────────────────────────────────────────────────────────────────────────────

/** Message privé au joueur dont l'avatar vient d'être masqué. */
export function formatAvatarHiddenNotice(input: {
  purgeAfter: Date;
  url: string;
  grounds: ModerationGrounds;
  termsUrl: string;
}): string {
  return (
    `🙈 BlueGenji — Ton avatar a été masqué à la suite d'un signalement : ` +
    `il n'est plus en ligne, mais il est conservé pour pouvoir être rétabli. ` +
    `${decisionGroundsText({ grounds: input.grounds, fromReport: true, termsUrl: input.termsUrl })} ` +
    `Sans contestation de ta part, il sera supprimé définitivement le ${formatQuarantineDate(input.purgeAfter)}. ` +
    redressText({ grounds: input.grounds, url: input.url, plural: false })
  );
}

/**
 * Message privé au joueur dont l'avatar vient d'être supprimé sans délai
 * (contenu manifestement illicite) — ou par la modération, hors de tout
 * signalement (`url` alors `null`, comme `formatLogoRemovedNotice`).
 */
export function formatAvatarRemovedNotice(input: {
  url: string | null;
  grounds: ModerationGrounds;
  termsUrl: string;
  /** Motif saisi par la modération, pour un retrait hors signalement. */
  staffReason?: string | null;
}): string {
  return (
    `🗑️ BlueGenji — Ton avatar a été supprimé par la modération du site` +
    `${input.url ? " à la suite d'un signalement" : ""}. ` +
    `${decisionGroundsText({ grounds: input.grounds, fromReport: input.url !== null, termsUrl: input.termsUrl, staffReason: input.staffReason })} ` +
    redressText({ grounds: input.grounds, url: input.url, plural: false })
  );
}

/** Message privé au joueur dont l'avatar est rétabli. */
export function formatAvatarRestoredNotice(): string {
  return `✅ BlueGenji — Ton avatar a été rétabli : la contestation a été acceptée.`;
}

/**
 * Ligne du journal (canal de logs) d'un avatar masqué — **jamais** le pseudo du
 * joueur : ce canal est un tiers hébergé hors de l'Union européenne, purgé par
 * le bot au bout d'un an seulement (`lib/shared/log-privacy.ts`). Un nom d'équipe peut y partir, un
 * joueur jamais.
 */
export function formatAvatarHiddenLog(input: { reportId: number; purgeAfter: Date }): string {
  return (
    `🙈 Avatar d'${ANONYMOUS_PLAYER_LABEL} masqué par le staff (signalement #${input.reportId}), ` +
    `suppression définitive le ${formatQuarantineDate(input.purgeAfter)} sans contestation.`
  );
}
