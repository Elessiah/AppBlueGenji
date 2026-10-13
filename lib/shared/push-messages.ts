/**
 * Ce que dit chaque notification push — un rédacteur par sujet de
 * `PUSH_TOPICS`, **dans la langue du destinataire** (lot 9-3 : espace
 * `pushMessages`, `bg_users.locale`).
 *
 * Une notification push n'est pas un message Discord raccourci : elle s'affiche
 * sur un écran verrouillé, en deux lignes, parfois sous les yeux d'un autre. Les
 * règles sont donc les mêmes partout :
 *
 * - le **titre** dit l'évènement, le **corps** ce qu'il faut faire ou savoir ;
 * - **aucun pseudo de joueur**, même règle que les journaux Discord
 *   (`lib/shared/log-privacy.ts`) : les noms d'équipe restent, ils sont publics ;
 * - le **lien** est un chemin du site, qui ouvre la page où agir — dans la
 *   langue du destinataire quand la page est traduite (`localeHref`).
 *
 * Chaque rédacteur prend la langue en dernier argument (français par défaut,
 * texte inchangé) ; `notifyUsers` / `notifyStaff` n'acceptent qu'une
 * notification à rédiger par langue (`LocalizedPushContent`). Les messages
 * privés Discord, eux, restent en français (D6).
 *
 * Module pur : chaque rédacteur se teste sans réseau. **Serveur seulement**
 * malgré son dossier : il embarque les deux langues et les catégories des deux
 * `reports.json` — aucun module client ne doit l'atteindre, même par un détour
 * (`tests/lib/shared/push-messages-server-side.test.ts`).
 */
import enPush from "@/messages/en/pushMessages.json";
import frPush from "@/messages/fr/pushMessages.json";
import enReports from "@/messages/en/reports.json";
import frReports from "@/messages/fr/reports.json";
import {
  FIRST_SCHEDULE,
  formatMatchStart,
  type MatchReminderOffsetKey,
  type ScheduleAnnouncement,
} from "./discord-notifications";
import { isEndurancePlayoffRound, PLAYOFF_ROUND_OFFSET } from "./bg-survie/rounds";
import { tournamentMatchHref } from "./match-anchor";
import { reportConcernedHref, type ReportCategory } from "./content-reports";
import { cached } from "./intl-cache";
import { DEFAULT_LOCALE, INTL_LOCALE, localeHref, type Locale } from "./locales";
import { scopedText, type Leaves, type ScopedText } from "./scoped-text";
import type { PushContent } from "./push-notifications";

type PushText = ScopedText<Leaves<typeof frPush>>;

const TEXT: Readonly<Record<Locale, PushText>> = { fr: scopedText("fr", frPush), en: scopedText("en", enPush) };
const CATEGORY_LABELS: Readonly<Record<Locale, Readonly<Record<ReportCategory, { label: string }>>>> = {
  fr: frReports.categories,
  en: enReports.categories,
};

type MatchSide = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  teamName: string;
  opponentName: string;
  /**
   * Tournoi individuel : le nom d'un engagé y **est** le pseudo d'un joueur.
   * La notification dit alors « ton match », sans nommer personne — elle
   * s'affiche sur un écran verrouillé, et la règle ne connaît pas d'exception.
   */
  solo?: boolean;
};

/** « Renards contre Nova », ou « Ton match » quand les engagés sont des joueurs. */
function pairing(side: MatchSide, text: PushText): string {
  return side.solo ? text.t("pairingSolo") : text.t("pairing", { team: side.teamName, opponent: side.opponentName });
}

/** Étiquette d'un match : les notifications d'un même match se remplacent. */
function matchTag(matchId: number): string {
  return `rencontre-${matchId}`;
}

/**
 * Départ d'un match : il entre en lancement (`LOBBY`, les « Prêt » sont
 * attendus) ou il vient d'être lancé sans être passé par là (lancement forcé
 * par l'arbitrage). Même étiquette pour les deux : l'annonce du départ
 * remplace l'appel aux « Prêt » au lieu de s'y empiler.
 */
export function matchStartPush(side: MatchSide, phase: "LOBBY" | "LAUNCHED", locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  const values = { pairing: pairing(side, text), tournament: side.tournamentName };
  return {
    title: phase === "LOBBY" ? text.t("matchStart.titleLobby") : text.t("matchStart.titleLaunched"),
    body: phase === "LOBBY" ? text.t("matchStart.bodyLobby", values) : text.t("matchStart.bodyLaunched", values),
    url: localeHref(tournamentMatchHref(side.tournamentId, side.matchId), locale),
    tag: matchTag(side.matchId),
  };
}

/** Palier d'un rappel (`MATCH_REMINDER_OFFSETS`), par sa clé. */
export type { MatchReminderOffsetKey } from "./discord-notifications";

/**
 * Libellé d'une manche (`matchRoundLabel`, français du journal Discord) dans
 * la langue du texte ; le français égale `matchRoundLabel` (testé).
 */
export function pushRoundLabel(
  bracket: string,
  roundNumber: number,
  locale: Locale = DEFAULT_LOCALE,
  swiss = false,
): string {
  const text = TEXT[locale];
  if (isEndurancePlayoffRound(roundNumber) && bracket !== "THIRD_PLACE") {
    return text.t("round.playoff", { round: roundNumber - PLAYOFF_ROUND_OFFSET + 1 });
  }
  switch (bracket) {
    case "LOWER":
      return text.t("round.lower", { round: roundNumber });
    case "GRAND":
      return text.t("round.grand");
    case "THIRD_PLACE":
      return text.t("round.thirdPlace");
    default:
      return text.t(swiss ? "round.swiss" : "round.default", { round: roundNumber });
  }
}

const MATCH_START_FORMATS = new Map<Locale, Intl.DateTimeFormat>();

/** Coup d'envoi d'un match, heure de Paris, dans la langue du texte (24 h dans les deux). */
function pushMatchStart(startAt: string | Date, locale: Locale): string {
  if (locale === "fr") return formatMatchStart(startAt);
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  // Un formateur par langue (`cached`) : un balayage de rappels en rédige un par engagé.
  return cached(MATCH_START_FORMATS, locale, (code) =>
    new Intl.DateTimeFormat(INTL_LOCALE[code], {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/Paris",
    }),
  ).format(date);
}

type ScheduledMatchSide = MatchSide & {
  bracket: string;
  roundNumber: number;
  swiss?: boolean;
  startAt: string | Date;
  /**
   * Rencontre vers laquelle mène le lien, quand ce n'est pas `matchId` (qui
   * reste l'étiquette) : la nouvelle rencontre d'une ronde réappariée, ou
   * `null` — la page du tournoi — pour une rencontre supprimée.
   */
  linkMatchId?: number | null;
};

/** Lien d'un avis : la rencontre qui existe, ou la page du tournoi. */
function sideHref(side: ScheduledMatchSide, locale: Locale): string {
  const linked = side.linkMatchId === undefined ? side.matchId : side.linkMatchId;
  return localeHref(tournamentMatchHref(side.tournamentId, linked), locale);
}

export type { ScheduleAnnouncement } from "./discord-notifications";


function announcementTitle(offset: MatchReminderOffsetKey | null, rescheduled: boolean, text: PushText): string {
  if (offset) return text.t("matchReminder.title", { offset: text.t(`matchReminder.offset.${offset}`) });
  return rescheduled ? text.t("matchReminder.titleRescheduled") : text.t("matchReminder.titleScheduled");
}

/** Corps « qui · où · quand », avec l'ancienne date sur une reprogrammation. */
function scheduleBody(
  values: { pairing: string; tournament: string; round: string; startAt: string | Date },
  announcement: ScheduleAnnouncement,
  locale: Locale,
): string {
  const text = TEXT[locale];
  const base = {
    pairing: values.pairing,
    tournament: values.tournament,
    round: values.round,
    start: pushMatchStart(values.startAt, locale),
  };
  const previous = announcement.rescheduled ? announcement.previousStartAt : null;
  return previous
    ? text.t("matchReminder.bodyRescheduled", { ...base, previous: pushMatchStart(previous, locale) })
    : text.t("matchReminder.body", base);
}

/**
 * Rappel d'un match programmé (`offset` : son palier), ou annonce de son
 * horaire (`null`) — « reprogrammé », avec l'ancienne date, quand elle en
 * remplace une autre.
 */
export function matchReminderPush(
  side: ScheduledMatchSide,
  offset: MatchReminderOffsetKey | null,
  locale: Locale = DEFAULT_LOCALE,
  announcement: ScheduleAnnouncement = FIRST_SCHEDULE,
): PushContent {
  const text = TEXT[locale];
  const change = offset ? FIRST_SCHEDULE : announcement;
  return {
    title: announcementTitle(offset, change.rescheduled, text),
    body: scheduleBody(
      {
        pairing: pairing(side, text),
        tournament: side.tournamentName,
        round: pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss),
        startAt: side.startAt,
      },
      change,
      locale,
    ),
    url: localeHref(tournamentMatchHref(side.tournamentId, side.matchId), locale),
    tag: `${matchTag(side.matchId)}-reminder`,
  };
}

/**
 * Horaire retiré par l'arbitrage : `side.startAt` porte l'horaire qui ne vaut
 * plus. Même étiquette que l'annonce, qu'il remplace sur l'appareil.
 */
export function matchScheduleClearedPush(side: ScheduledMatchSide, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("matchReminder.titleCleared"),
    body: text.t("matchReminder.bodyCleared", {
      pairing: pairing(side, text),
      tournament: side.tournamentName,
      round: pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss),
      previous: pushMatchStart(side.startAt, locale),
    }),
    url: sideHref(side, locale),
    tag: `${matchTag(side.matchId)}-reminder`,
  };
}

/**
 * Engagée retirée d'une manche par un changement du tournoi : `side.startAt`
 * porte l'horaire qu'elle avait reçu et qui ne la concerne plus. Même
 * étiquette que l'annonce, qu'il remplace sur l'appareil.
 */
export function matchWithdrawnPush(side: ScheduledMatchSide, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("matchReminder.titleWithdrawn"),
    body: text.t("matchReminder.bodyWithdrawn", {
      pairing: pairing(side, text),
      tournament: side.tournamentName,
      round: pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss),
      previous: pushMatchStart(side.startAt, locale),
    }),
    url: sideHref(side, locale),
    tag: `${matchTag(side.matchId)}-reminder`,
  };
}

/**
 * Match programmé ou reprogrammé, pour l'arbitrage (`MATCH_SCHEDULED`) — mêmes
 * titre et corps que l'annonce aux joueurs.
 *
 * Les deux engagées sont nommées quand ce sont des équipes ; en tournoi
 * individuel, leurs noms sont des pseudos et la notification dit « Un match »
 * (même règle que pour les joueurs). Une place encore vide se lit « TBD »,
 * comme sur le plateau et au journal.
 */
type StaffScheduleInput = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  team1Name: string | null;
  team2Name: string | null;
  solo: boolean;
  bracket: string;
  roundNumber: number;
  swiss?: boolean;
  startAt: string | Date;
};

/** « A contre B » pour l'arbitrage : « Un match » en solo, « TBD » pour une place vide. */
function staffPairing(input: StaffScheduleInput, text: PushText): string {
  const tbd = text.t("matchScheduled.tbd");
  return input.solo
    ? text.t("matchScheduled.pairingSolo")
    : text.t("pairing", { team: input.team1Name ?? tbd, opponent: input.team2Name ?? tbd });
}

export function matchScheduledStaffPush(
  input: StaffScheduleInput,
  announcement: ScheduleAnnouncement,
  locale: Locale = DEFAULT_LOCALE,
): PushContent {
  const text = TEXT[locale];
  const pairingText = staffPairing(input, text);
  return {
    title: announcementTitle(null, announcement.rescheduled, text),
    body: scheduleBody(
      {
        pairing: pairingText,
        tournament: input.tournamentName,
        round: pushRoundLabel(input.bracket, input.roundNumber, locale, input.swiss),
        startAt: input.startAt,
      },
      announcement,
      locale,
    ),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    // Étiquette distincte de l'annonce aux joueurs : un arbitre engagé dans le
    // match garde les deux, plutôt que de voir sa version joueur (« Ton
    // match ») remplacée par la version arbitre (« Un match »).
    tag: `${matchTag(input.matchId)}-schedule`,
  };
}

/**
 * Horaire retiré, pour l'arbitrage (`MATCH_SCHEDULED`) : `input.startAt` porte
 * l'horaire qui ne vaut plus. Même étiquette que l'avis « programmé » qu'il
 * remplace sur l'appareil.
 */
export function matchScheduleClearedStaffPush(input: StaffScheduleInput, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("matchReminder.titleCleared"),
    body: text.t("matchScheduled.bodyCleared", {
      previous: pushMatchStart(input.startAt, locale),
      pairing: staffPairing(input, text),
      tournament: input.tournamentName,
      round: pushRoundLabel(input.bracket, input.roundNumber, locale, input.swiss),
    }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    tag: `${matchTag(input.matchId)}-schedule`,
  };
}

/** L'adversaire a saisi un score : à confirmer, ou à contester. */
export function scoreToConfirmPush(side: MatchSide, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("scoreToConfirm.title"),
    body: text.t("scoreToConfirm.body", {
      opponent: side.solo ? text.t("scoreToConfirm.soloOpponent") : side.opponentName,
      tournament: side.tournamentName,
    }),
    url: localeHref(tournamentMatchHref(side.tournamentId, side.matchId), locale),
    tag: `${matchTag(side.matchId)}-score`,
  };
}

/** Un tournoi où l'équipe du joueur est engagée vient d'être lancé. */
export function tournamentStartPush(
  input: { tournamentId: number; tournamentName: string },
  locale: Locale = DEFAULT_LOCALE,
): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("tournamentStart.title"),
    body: text.t("tournamentStart.body", { tournament: input.tournamentName }),
    url: localeHref(`/tournois/${input.tournamentId}`, locale),
    tag: `tournament-${input.tournamentId}-start`,
  };
}

/** Un joueur demande à rejoindre une équipe que le destinataire gère. */
export function teamJoinRequestPush(input: { teamId: number; teamName: string }, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("teamJoinRequest.title"),
    body: text.t("teamJoinRequest.body", { team: input.teamName }),
    url: localeHref(`/equipes/${input.teamId}`, locale),
    tag: `team-${input.teamId}-join`,
  };
}

/** Un signalement vise le destinataire ou son équipe. */
export function contentReportPush(
  input: { reportId: number; category: ReportCategory },
  locale: Locale = DEFAULT_LOCALE,
): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("contentReport.title"),
    body: text.t("contentReport.body", { category: CATEGORY_LABELS[locale][input.category].label }),
    url: localeHref(reportConcernedHref(input.reportId), locale),
    tag: `report-${input.reportId}`,
  };
}

export type ModerationPushKind = "HIDDEN" | "REMOVED" | "RESTORED";

/**
 * Décision de modération sur une image : le logo d'une équipe (`teamName`) ou
 * l'avatar du destinataire (`teamName` absent). Le lien mène au signalement
 * quand il y en a un — c'est là qu'on conteste.
 */
export function moderationPush(
  input: {
    kind: ModerationPushKind;
    teamName?: string | null;
    teamId?: number | null;
    reportId: number | null;
  },
  locale: Locale = DEFAULT_LOCALE,
): PushContent {
  const text = TEXT[locale];
  const decision = input.teamName
    ? text.t(`moderation.logo.${input.kind}`, { team: input.teamName })
    : text.t(`moderation.avatar.${input.kind}`);
  const fallback = input.teamId ? `/equipes/${input.teamId}` : "/profil";
  return {
    title: text.t("moderation.title"),
    body: `${decision} ${moderationNextStep(text, input.kind, input.reportId)}`,
    url: localeHref(input.reportId !== null ? reportConcernedHref(input.reportId) : fallback, locale),
    tag: input.teamId ? `moderation-team-${input.teamId}` : "moderation-avatar",
  };
}

/** Ce qui reste à faire après une décision de modération. */
function moderationNextStep(text: PushText, kind: ModerationPushKind, reportId: number | null): string {
  if (kind === "RESTORED") return text.t("moderation.next.restored");
  return reportId !== null ? text.t("moderation.next.contest") : text.t("moderation.next.writeUs");
}

/**
 * Suspension du compte du destinataire, ou sa levée. Ni motif ni clause : la
 * notification s'affiche sur un écran que d'autres peuvent voir, et l'exposé
 * complet est donné en message privé Discord et à la tentative de connexion
 * suivante — seul endroit où le lecteur a prouvé être le titulaire.
 */
export function suspensionPush(kind: "SUSPENDED" | "LIFTED", locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("moderation.title"),
    body: kind === "SUSPENDED" ? text.t("suspension.suspended") : text.t("suspension.lifted"),
    url: localeHref("/connexion", locale),
    tag: "moderation-suspension",
  };
}

/**
 * Des changements du traitement des données sont à lire — une information,
 * aucun accord n'est demandé. `titles` : les titres **dans la langue du
 * destinataire** (`localizedPrivacyChanges`).
 */
export function privacyChangePush(titles: readonly string[], locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  const first = titles[0] ?? text.t("privacyChange.fallback");
  const others = titles.length - 1;
  return {
    title: text.t("privacyChange.title"),
    body: others > 0 ? text.t("privacyChange.bodyMore", { first, others }) : text.t("privacyChange.body", { first }),
    url: localeHref("/rgpd", locale),
    tag: "privacy-change",
  };
}

/** Nature d'une alerte d'arbitrage, pour la rédiger sans le texte Discord (français, D6). */
export type RefereeAlertKind = "score_conflict" | "score_report_stalled" | "other";

/** La manche en cause, quand l'alerte en a une : de quoi la nommer et y mener. */
export type RefereeAlertMatch = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  bracket: string;
  roundNumber: number;
  /** Ronde suisse : « Ronde N » (`swissRoundSql`). */
  swiss?: boolean;
};

/**
 * Alerte d'arbitrage. En français, le texte Discord porte déjà l'essentiel en
 * une ligne : le push en reprend la phrase, sans la mise en forme Markdown
 * qu'une notification afficherait telle quelle. Dans une autre langue, ce
 * texte (français, D6) n'est pas repris : une phrase de la nature de l'alerte
 * le remplace, avec le tournoi et la manche quand l'alerte en a une — deux
 * alertes de deux tournois ne se lisent pas pareil.
 *
 * Le lien mène à la manche (`match`) dans la langue du destinataire. Sans
 * manche, il mène à la liste des tournois, **dans toutes les langues** : il
 * n'est jamais lu dans la ligne, dont une URL peut venir d'un nom de tournoi
 * ou d'équipe — même ramenée à un chemin du site, elle mènerait où l'auteur
 * du nom l'a voulu (`/connexion?redirect=…`, une route d'API…).
 */
export function refereeAlertPush(
  message: string,
  key: string,
  locale: Locale = DEFAULT_LOCALE,
  kind: RefereeAlertKind = "other",
  match: RefereeAlertMatch | null = null,
): PushContent {
  const text = TEXT[locale];
  const url = localeHref(match ? tournamentMatchHref(match.tournamentId, match.matchId) : "/tournois", locale);
  let body: string;
  if (locale === "fr") body = stripMarkdown(message);
  else if (match) {
    body = text.t(`refereeAlert.${kind}Match`, {
      tournament: match.tournamentName,
      round: pushRoundLabel(match.bracket, match.roundNumber, locale, match.swiss),
    });
  } else body = text.t(`refereeAlert.${kind}`);
  return {
    title: text.t("refereeAlert.title"),
    body,
    url,
    // Une étiquette **par alerte** (nature et manche) : deux conflits d'un même
    // tournoi ne se remplacent pas, et une même alerte renvoyée après un échec
    // du bot remplace la précédente sans resonner.
    tag: `referee-${key}`,
  };
}

/** Problème signalé par un engagé pendant un match (`issue-reports.ts`). */
export function issueReportPush(
  input: { tournamentId: number; tournamentName: string; match: { id: number; bracket: string; roundNumber: number; swiss?: boolean } | null },
  locale: Locale = DEFAULT_LOCALE,
): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("refereeAlert.title"),
    body: input.match
      ? text.t("issueReport.bodyRound", {
          tournament: input.tournamentName,
          round: pushRoundLabel(input.match.bracket, input.match.roundNumber, locale, input.match.swiss),
        })
      : text.t("issueReport.body", { tournament: input.tournamentName }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.match?.id ?? null), locale),
    tag: `issue-${input.tournamentId}-${input.match?.id ?? 0}`,
  };
}

/** Nouveau signalement, ou contestation, reçu par la modération. */
export function staffReportPush(input: { reportId: number; contest: boolean }, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: input.contest ? text.t("staffReport.titleContest") : text.t("staffReport.titleReport"),
    body: input.contest ? text.t("staffReport.bodyContest") : text.t("staffReport.bodyReport"),
    // Le panneau de modération reste français (D4) : même adresse dans les deux langues.
    url: `/admin/signalements`,
    tag: `staff-report-${input.reportId}`,
  };
}

/** Afflux de signalements : les suivants arrivent au panneau sans alerte. */
export function staffReportSaturatedPush(locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("staffReport.titleSaturated"),
    body: text.t("staffReport.bodySaturated"),
    url: `/admin/signalements`,
    tag: "staff-report-saturated",
  };
}

/** Retire gras, italique, liens nus et chevrons de mention d'un texte Discord. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
