/**
 * Messages privés Discord du planning (`docs/features/CAST_PLANNING.md`
 * § Notifications) — module pur, importable partout. Les push des mêmes
 * sujets se rédigent dans `push-messages.ts` ; la distribution passe par
 * `lib/server/notify.ts`.
 *
 * Règles de vie privée (`RGPD_LOGS_AND_VISITS.md`) : aucun pseudo de joueur
 * (en tournoi individuel, « Un match »), noms d'équipe permis, et **aucun
 * membre du staff nommé** — celui qui se désiste est « un caster », jamais
 * son pseudo. Tout nom saisi passe par `discordInline`.
 */
import { discordInline } from "./discord-text";
import { localizedSiteUrl } from "./dm-language";
import { cached } from "./intl-cache";
import { INTL_LOCALE, type Locale } from "./locales";
import { PLANNING_PATH, PLANNING_TIME_ZONE, type PlanningEntryKind, type PlanningRole } from "./planning";

/** Une entrée du planning telle qu'une notification la décrit. */
export type PlanningNoticeEntry = {
  key: string;
  kind: PlanningEntryKind;
  tournamentId: number;
  tournamentName: string;
  /** `null` : place encore vide (« TBD »). */
  team1Name: string | null;
  team2Name: string | null;
  /** Tournoi individuel : les engagés sont des joueurs, jamais nommés. */
  solo: boolean;
  startAt: string;
};

/** Une affectation annoncée : l'entrée et le rôle tenu. */
export type PlanningNoticeAssignment = PlanningNoticeEntry & { role: PlanningRole };

/** Un désistement annoncé aux autres affectés de l'entrée. */
export type PlanningWithdrawalNotice = PlanningNoticeEntry & {
  role: PlanningRole;
  /** Un remplaçant a été affecté (sans le nommer). */
  replaced: boolean;
  /**
   * Pas de remplaçant, mais un autre caster (second caster de l'entrée) reste
   * affecté : la place n'est pas à pourvoir. Absent : faux.
   */
  stillHeld?: boolean;
  /** Avec `stillHeld` : le destinataire est lui-même ce caster qui reste. Absent : faux. */
  selfHeld?: boolean;
  /** Désistement à moins de 24 h du début. */
  late: boolean;
};

/** Lignes d'un message privé listées au plus : le reste se dit en nombre. */
export const PLANNING_DM_MAX_LINES = 15;

const ROLE_LABELS: Readonly<Record<Locale, Readonly<Record<PlanningRole, string>>>> = {
  fr: { REFEREE: "arbitre", CASTER: "caster", PROD: "prod" },
  en: { REFEREE: "referee", CASTER: "caster", PROD: "prod" },
};

/** « arbitre » / « referee » : le rôle, en minuscules. */
export function planningRoleLabel(role: PlanningRole, locale: Locale): string {
  return ROLE_LABELS[locale][role];
}

const NOTICE_TIME_FORMATS = new Map<Locale, Intl.DateTimeFormat>();

/** « mer. 20 nov., 20:00 » / « Wed, Nov 20, 20:00 », heure de Paris. */
export function planningNoticeTime(startAt: string, locale: Locale): string {
  return cached(NOTICE_TIME_FORMATS, locale, (code) =>
    new Intl.DateTimeFormat(INTL_LOCALE[code], {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: PLANNING_TIME_ZONE,
    }),
  ).format(new Date(startAt));
}

/**
 * L'entrée en une ligne, sans pseudo : « Renards contre Nova — Coupe »,
 * « Un match — Coupe » en individuel, « Coupe (tout l'événement) » pour un
 * tournoi sans horaires par match.
 */
export function planningEntryLabel(entry: PlanningNoticeEntry, locale: Locale): string {
  const tournament = discordInline(entry.tournamentName);
  if (entry.kind === "TOURNAMENT") return locale === "en" ? `${tournament} (whole event)` : `${tournament} (tout l'événement)`;
  if (entry.solo) return locale === "en" ? `A match — ${tournament}` : `Un match — ${tournament}`;
  const team1 = entry.team1Name === null ? "TBD" : discordInline(entry.team1Name);
  const team2 = entry.team2Name === null ? "TBD" : discordInline(entry.team2Name);
  return locale === "en" ? `${team1} vs ${team2} — ${tournament}` : `${team1} contre ${team2} — ${tournament}`;
}

/** Lien absolu vers le planning, dans la langue du message. */
export function planningNoticeUrl(siteBase: string, locale: Locale): string {
  return localizedSiteUrl(`${siteBase}${PLANNING_PATH}`, locale);
}

/** Les lignes, bornées à {@link PLANNING_DM_MAX_LINES}, puis « … et N autres ». */
function boundedLines(lines: readonly string[], locale: Locale): string[] {
  if (lines.length <= PLANNING_DM_MAX_LINES) return [...lines];
  const hidden = lines.length - PLANNING_DM_MAX_LINES;
  const others = hidden > 1 ? "autres" : "autre";
  const more = locale === "en" ? `… and ${hidden} more` : `… et ${hidden} ${others}`;
  return [...lines.slice(0, PLANNING_DM_MAX_LINES), more];
}

/**
 * Récapitulatif des nouvelles entrées (`PLANNING_NEW_ENTRIES`) : une ligne par
 * entrée (heure de Paris, affiche), dans l'ordre du début, pour poser ses
 * disponibilités. Un seul message par vague de planification.
 */
export function formatPlanningNewEntriesDm(
  entries: readonly PlanningNoticeEntry[],
  siteBase: string,
  locale: Locale,
): string {
  const lines = boundedLines(
    entries.map((entry) => `• ${planningNoticeTime(entry.startAt, locale)} — ${planningEntryLabel(entry, locale)}`),
    locale,
  );
  const url = planningNoticeUrl(siteBase, locale);
  if (locale === "en") {
    const head =
      entries.length === 1
        ? "📅 BlueGenji — A new match is in the planning:"
        : `📅 BlueGenji — ${entries.length} new matches are in the planning:`;
    return [head, ...lines, `Paris time. Set your availability: ${url}`].join("\n");
  }
  const head =
    entries.length === 1
      ? "📅 BlueGenji — Un nouveau match est au planning :"
      : `📅 BlueGenji — ${entries.length} nouveaux matchs sont au planning :`;
  return [head, ...lines, `Heure de Paris. Pose tes disponibilités : ${url}`].join("\n");
}

/**
 * Affectations (`PLANNING_ASSIGNED`) : confirmées par le staff, posées à la
 * main, ou remplacement d'un membre qui s'est désisté. Une ligne par
 * affectation : heure de Paris, rôle, affiche.
 */
export function formatPlanningAssignedDm(
  assignments: readonly PlanningNoticeAssignment[],
  siteBase: string,
  locale: Locale,
  replacement = false,
): string {
  const lines = boundedLines(
    assignments.map(
      (item) =>
        `• ${planningNoticeTime(item.startAt, locale)} — ${planningRoleLabel(item.role, locale)} — ${planningEntryLabel(item, locale)}`,
    ),
    locale,
  );
  const url = planningNoticeUrl(siteBase, locale);
  if (locale === "en") {
    let head = `🎙️ BlueGenji — You are assigned to ${assignments.length} entries in the planning:`;
    if (replacement) head = "🎙️ BlueGenji — A staff member withdrew: you are assigned in their place:";
    else if (assignments.length === 1) head = "🎙️ BlueGenji — You are assigned in the planning:";
    return [head, ...lines, `Paris time. If you can't make it, withdraw on the planning: ${url}`].join("\n");
  }
  let head = `🎙️ BlueGenji — Tu es affecté à ${assignments.length} entrées du planning :`;
  if (replacement) head = "🎙️ BlueGenji — Un membre du staff s'est désisté : tu es affecté à sa place :";
  else if (assignments.length === 1) head = "🎙️ BlueGenji — Tu es affecté au planning :";
  return [head, ...lines, `Heure de Paris. Empêché ? Désiste-toi sur le planning : ${url}`].join("\n");
}

/**
 * Désistement (`PLANNING_WITHDRAWAL`), aux autres affectés de l'entrée : qui
 * s'est désisté reste anonyme (« un caster »), le remplaçant aussi.
 */
export function formatPlanningWithdrawalDm(notice: PlanningWithdrawalNotice, siteBase: string, locale: Locale): string {
  const role = planningRoleLabel(notice.role, locale);
  const when = planningNoticeTime(notice.startAt, locale);
  const label = planningEntryLabel(notice, locale);
  const url = planningNoticeUrl(siteBase, locale);
  if (locale === "en") {
    let outcome = notice.replaced ? "A replacement has been assigned." : "The slot is open.";
    if (!notice.replaced && notice.stillHeld === true) {
      outcome = notice.selfHeld === true ? `You remain assigned as ${role}.` : `Another ${role} is still assigned.`;
    }
    return `↩️ BlueGenji — A ${role} withdrew from ${label} (${when}, Paris time). ${outcome} ${url}`;
  }
  let outcome = notice.replaced ? "Un remplaçant a été affecté." : "La place est à pourvoir.";
  if (!notice.replaced && notice.stillHeld === true) {
    outcome = notice.selfHeld === true ? `Tu restes affecté comme ${role}.` : `Un autre ${role} reste affecté.`;
  }
  return `↩️ BlueGenji — Un ${role} s'est désisté de ${label} (${when}, heure de Paris). ${outcome} ${url}`;
}

/**
 * Ligne du journal du staff sur Discord (`PLANNING_UNFILLED`) : une place
 * reste à pourvoir. Aucun nom de staff. Le journal reste en français.
 */
export function formatPlanningUnfilledLine(notice: PlanningWithdrawalNotice, siteBase: string): string {
  return formatPlanningUnfilledDm(notice, siteBase, "fr");
}

/**
 * Message privé du staff des tournois (`PLANNING_UNFILLED`), dans la langue
 * du destinataire : une place reste à pourvoir. Aucun nom de staff.
 */
export function formatPlanningUnfilledDm(notice: PlanningWithdrawalNotice, siteBase: string, locale: Locale): string {
  const role = planningRoleLabel(notice.role, locale);
  const label = planningEntryLabel(notice, locale);
  const when = planningNoticeTime(notice.startAt, locale);
  const url = planningNoticeUrl(siteBase, locale);
  if (locale === "en") {
    const late = notice.late ? " (late withdrawal, less than 24 h before)" : "";
    return `⚠️ Planning — a ${role} withdrew from ${label} (${when}, Paris time)${late}: no replacement found, the slot is open. ${url}`;
  }
  const late = notice.late ? " (désistement tardif, moins de 24 h avant)" : "";
  return `⚠️ Planning — un ${role} s'est désisté de ${label} (${when}, heure de Paris)${late} : aucun remplaçant trouvé, place à pourvoir. ${url}`;
}
