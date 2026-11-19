/**
 * Messages privés Discord de la date butoir de planification
 * (`docs/features/SCHEDULE_DEADLINE.md`) — module pur, importable partout. Le
 * push du même sujet (`SCHEDULE_DEADLINE`) se rédige dans `push-messages.ts` ;
 * la distribution passe par `lib/server/notify.ts`.
 *
 * Vie privée (`RGPD_LOGS_AND_VISITS.md`) : aucun pseudo de joueur (en tournoi
 * individuel, « Ton match »), noms d'équipe permis, aucun membre du staff
 * nommé. Tout nom saisi passe par `discordInline`.
 */
import { discordInline } from "./discord-text";
import { localizedSiteUrl } from "./dm-language";
import type { Locale } from "./locales";
import { tournamentMatchHref } from "./match-anchor";
import { planningNoticeTime } from "./planning-notices";
import type { DeadlineReminderKey } from "./schedule-deadline";

/** Palier d'un avis : un rappel, ou le double forfait prononcé. */
export type DeadlineNoticeKey = DeadlineReminderKey | "FORFEIT";

/** Ce qu'un avis dit d'un match, du point de vue d'une engagée. */
export type DeadlineNotice = {
  key: DeadlineNoticeKey;
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  /** L'engagée destinataire et son adversaire (noms d'équipe, jamais lus en individuel). */
  teamName: string;
  opponentName: string;
  /** Tournoi individuel : les engagés sont des joueurs, jamais nommés. */
  solo: boolean;
  /** Date butoir (ISO). */
  deadlineAt: string;
};

/** « Renards contre Nova (Coupe) », ou « Ton match (Coupe) » en individuel. */
export function deadlineMatchLabel(notice: DeadlineNotice, locale: Locale): string {
  const tournament = discordInline(notice.tournamentName);
  if (notice.solo) return locale === "en" ? `Your match (${tournament})` : `Ton match (${tournament})`;
  const team = discordInline(notice.teamName);
  const opponent = discordInline(notice.opponentName);
  return locale === "en" ? `${team} vs ${opponent} (${tournament})` : `${team} contre ${opponent} (${tournament})`;
}

/**
 * Le message privé d'un avis : l'annonce de la date butoir, un rappel (24 h,
 * 3 h avant), ou le double forfait prononcé. Heure de Paris, lien vers le match.
 */
export function formatScheduleDeadlineDm(notice: DeadlineNotice, siteBase: string, locale: Locale): string {
  const label = deadlineMatchLabel(notice, locale);
  const time = planningNoticeTime(notice.deadlineAt, locale);
  const url = localizedSiteUrl(`${siteBase}${tournamentMatchHref(notice.tournamentId, notice.matchId)}`, locale);
  if (locale === "en") {
    if (notice.key === "FORFEIT") {
      return `BlueGenji — ${label}: no time was agreed before the scheduling deadline (${time}, Paris time). The match is closed as a double forfeit.\n${url}`;
    }
    if (notice.key === "SET") {
      return `BlueGenji — Scheduling deadline: ${label} must be scheduled before ${time} (Paris time). Agree on a time with the referees, otherwise both sides forfeit.\n${url}`;
    }
    return `BlueGenji — Reminder: ${label} still has no time. Scheduling deadline: ${time} (Paris time), otherwise both sides forfeit.\n${url}`;
  }
  if (notice.key === "FORFEIT") {
    return `BlueGenji — ${label} : aucun horaire convenu avant la date butoir (${time}, heure de Paris). Le match est clos en double forfait.\n${url}`;
  }
  if (notice.key === "SET") {
    return `BlueGenji — Date butoir de planification : ${label} doit être programmé avant le ${time} (heure de Paris). Convenez d'un horaire avec l'arbitrage, sinon double forfait.\n${url}`;
  }
  return `BlueGenji — Rappel : ${label} n'a toujours pas d'horaire. Date butoir : ${time} (heure de Paris), sinon double forfait.\n${url}`;
}
