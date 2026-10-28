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
 * privés Discord suivent la même langue (`docs/features/BOT_DM_LANGUAGE.md`) ;
 * les messages de salon restent en français (D6).
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
  CHECK_IN_INVITE_URL,
  CHECK_IN_OPENS_MINUTES_BEFORE,
  CHECK_IN_REMINDER_KEY,
  FIRST_SCHEDULE,
  formatMatchStart,
  type MatchReminderOffsetKey,
  type ScheduleAnnouncement,
} from "./discord-notifications";
import { isEndurancePlayoffRound, PLAYOFF_ROUND_OFFSET } from "./bg-survie/rounds";
import { CHECK_IN_PATH } from "./discord";
import { matchPageHref, tournamentHref, tournamentMatchHref } from "./match-anchor";
import { reportConcernedHref, type ReportCategory } from "./content-reports";
import { cached } from "./intl-cache";
import { DEFAULT_LOCALE, INTL_LOCALE, localeHref, type Locale } from "./locales";
import { scopedText, type Leaves, type ScopedText } from "./scoped-text";
import { clipPushText, PUSH_BODY_MAX, type PushContent } from "./push-notifications";
import type { CastReleasedMatch } from "./cast-notices";
import type { LobbyBriefSide } from "./lobby-brief";

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

/**
 * Brief du salon (`MATCH_LOBBY_BRIEF`, `./lobby-brief`) : les réglages de la
 * partie, vus de l'engagée du destinataire. Aucun BattleTag ni tag Discord ;
 * en tournoi individuel, « toi » et « ton adversaire » plutôt que des pseudos.
 * Sa propre étiquette : il ne remplace pas l'appel aux « Prêt » du même match.
 */
export function lobbyBriefPush(side: LobbyBriefSide, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  const own = side.solo ? text.t("lobbyBrief.own") : side.teamName;
  const other = side.solo ? text.t("lobbyBrief.other") : side.opponentName;
  // Ni l'appariement ni la manche : gauche et droite nomment déjà les deux
  // engagées ; le « 1er ban » se pose sur le côté que la règle du tournoi
  // désigne (`ROUND_MAPS.md` : la droite, qui n'héberge pas, par défaut), donc
  // aucun nom n'est répété. Le rappel du tri par rôle vient en tête et la carte
  // (texte libre) en dernier : la coupe à `PUSH_BODY_MAX` ne retire qu'elle.
  const values = {
    left: side.hosting ? own : other,
    right: side.hosting ? other : own,
    map: side.firstMap ?? text.t("lobbyBrief.noMap"),
  };
  const hostBans = side.banFirst === side.hosting;
  const castKey = hostBans ? "lobbyBrief.bodyCastHostBans" : "lobbyBrief.bodyCast";
  const plainKey = hostBans ? "lobbyBrief.bodyHostBans" : "lobbyBrief.body";
  return {
    title: text.t("lobbyBrief.title"),
    body: text.t(side.cast ? castKey : plainKey, values),
    url: localeHref(matchPageHref(side.tournamentId, side.matchId), locale),
    tag: `${matchTag(side.matchId)}-salon`,
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
   * Le rappel porte le check-in (`CHECK_IN_INVITE_URL`) : par défaut, le
   * rappel de 10 h ; aussi l'annonce qui a consommé son palier.
   */
  checkIn?: boolean;
  /** Le salon de check-in est déjà ouvert (coup d'envoi à moins de 15 min) : « déjà ouvert ». */
  checkInOpen?: boolean;
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
  const body = scheduleBody(
    {
      pairing: pairing(side, text),
      tournament: side.tournamentName,
      round: pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss),
      startAt: side.startAt,
    },
    change,
    locale,
  );
  const checkIn = side.checkIn ?? offset === CHECK_IN_REMINDER_KEY;
  return {
    title: announcementTitle(offset, change.rescheduled, text),
    body: checkIn ? withTail(body, checkInText(text, side.checkInOpen === true)) : body,
    // L'adresse écrite dans le texte ne se touche pas : le push du check-in
    // ouvre l'invitation (par le site, seule origine qu'une notification ouvre).
    url: checkIn ? CHECK_IN_PATH : localeHref(tournamentMatchHref(side.tournamentId, side.matchId), locale),
    tag: `${matchTag(side.matchId)}-reminder`,
    // Un rappel remplace l'annonce (ou le rappel 24 h) **en sonnant** : le
    // rappel 10 h porte le check-in, il ne doit pas passer inaperçu.
    ...(offset ? { renotify: true } : {}),
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
  /** Rencontre du lien quand ce n'est pas `matchId` : `null` — la page du tournoi — pour une rencontre supprimée. */
  linkMatchId?: number | null;
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
    url: localeHref(
      tournamentMatchHref(input.tournamentId, input.linkMatchId === undefined ? input.matchId : input.linkMatchId),
      locale,
    ),
    tag: `${matchTag(input.matchId)}-schedule`,
  };
}

/** Longueur affichée (par caractère, comme la borne du push). */
function charCount(text: string): number {
  return Array.from(text).length;
}

/**
 * `body` suivi de `tail`, dans la borne du corps d'un push : c'est `body` qui
 * se raccourcit — une reprogrammation aux noms longs, suivie de la phrase du
 * check-in, dépasse la borne, et la coupe finale tronquerait l'invitation.
 */
function withTail(body: string, tail: string): string {
  const room = PUSH_BODY_MAX - charCount(tail) - 1;
  return `${clipPushText(body, Math.max(room, 1))} ${tail}`;
}

/**
 * Empreinte courte (FNV-1a 32 bits, base 36) d'une liste d'identifiants :
 * l'étiquette d'un push est bornée à 64 caractères, une liste écrite en
 * entier y serait coupée — et deux programmes au même début confondus.
 */
function idsFingerprint(ids: readonly number[]): string {
  let hash = 0x811c9dc5;
  for (const char of ids.join(",")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Phrase du check-in : quand le salon ouvre, ou qu'il l'est déjà. */
function checkInText(text: PushText, open: boolean): string {
  return open
    ? text.t("matchReminder.checkInOpen", { invite: CHECK_IN_INVITE_URL })
    : text.t("matchReminder.checkIn", { invite: CHECK_IN_INVITE_URL, minutes: CHECK_IN_OPENS_MINUTES_BEFORE });
}

/** Une manche du programme d'arbitrage (`REFEREE_DIGEST`). */
export type RefereeDigestMatch = {
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  bracket: string;
  roundNumber: number;
  swiss?: boolean;
  team1Name: string;
  team2Name: string;
  solo: boolean;
  startAt: string | Date;
};

/** Lignes du programme poussées au plus : le reste se dit « … et N autres ». */
export const REFEREE_DIGEST_PUSH_LINES = 5;

const DIGEST_TIME_FORMATS = new Map<Locale, Intl.DateTimeFormat>();

/** « mer. 20:00 » / « Wed 20:00 », heure de Paris : le programme tient sur une demi-journée. */
function digestTime(startAt: string | Date, locale: Locale): string {
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  return cached(DIGEST_TIME_FORMATS, locale, (code) =>
    new Intl.DateTimeFormat(INTL_LOCALE[code], {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/Paris",
    }),
  ).format(date);
}

/**
 * Programme d'arbitrage (`REFEREE_DIGEST`) : les matchs à venir (ceux des
 * 10 prochaines heures et la marge de regroupement), un par ligne (heure de
 * Paris, affiche, tournoi et manche), dans l'ordre du coup d'envoi, puis une
 * dernière ligne « Heure de Paris » (un arbitre à l'étranger lirait sinon son
 * heure locale ; en dernier, parce qu'une notification repliée ne montre que
 * la première ligne, qui doit être un match). Équipes nommées ; en tournoi individuel, aucun pseudo de
 * joueur (comme partout) : les matchs d'un même créneau, tournoi et manche
 * tiennent en une ligne « 5 matchs » plutôt qu'en cinq lignes identiques
 * « Un match ». Le lien mène au tournoi
 * quand le programme n'en cite qu'un, à la liste des tournois sinon.
 * Le corps garde ses lignes (`clipPushText`) et tient dans `PUSH_BODY_MAX` :
 * les matchs qui n'y entrent pas se disent « … et N autres ».
 * L'étiquette porte une empreinte de toutes les manches citées (bornée à
 * 64 caractères) : un programme suivant, qui en cite d'autres, ne remplace
 * jamais le précédent sur l'appareil.
 */
export function refereeDigestPush(matches: readonly RefereeDigestMatch[], locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  const tournaments = new Set(matches.map((match) => match.tournamentId));
  const [onlyTournament] = tournaments;
  return {
    title: text.t("refereeDigest.title", { count: matches.length }),
    body: fitDigestBody(digestLines(matches, text, locale), matches.length, text),
    multiline: true,
    url: localeHref(tournaments.size === 1 ? tournamentHref(onlyTournament) : "/tournois", locale),
    tag: `referee-digest-${matches[0]?.matchId ?? 0}-${matches.length}-${idsFingerprint(matches.map((match) => match.matchId))}`,
  };
}

/** Une ligne du programme mise en forme, et le nombre de matchs qu'elle dit. */
type DigestLine = { text: string; count: number };

/**
 * Lignes du programme : une par match ; en solo, une par créneau, tournoi et
 * manche (suites). Au-delà des lignes affichables, rien n'est mis en forme : le
 * reste ne se dit qu'en nombre (« … et N autres »), compté sur les matchs.
 */
function digestLines(matches: readonly RefereeDigestMatch[], text: PushText, locale: Locale): DigestLine[] {
  const lines: {
    start: string;
    tournamentId: number;
    tournament: string;
    round: string;
    pairing: string | null;
    count: number;
  }[] = [];
  for (const match of matches) {
    const start = digestTime(match.startAt, locale);
    const round = pushRoundLabel(match.bracket, match.roundNumber, locale, match.swiss);
    const last = lines.at(-1);
    const sameSlot =
      // Par identifiant : deux tournois homonymes ne se fondent pas en une ligne.
      match.solo &&
      last?.pairing === null &&
      last.start === start &&
      last.tournamentId === match.tournamentId &&
      last.round === round;
    if (sameSlot) {
      last.count += 1;
      continue;
    }
    if (lines.length === REFEREE_DIGEST_PUSH_LINES) break;
    const pairing = match.solo ? null : text.t("pairing", { team: match.team1Name, opponent: match.team2Name });
    lines.push({ start, tournamentId: match.tournamentId, tournament: match.tournamentName, round, pairing, count: 1 });
  }
  return lines.map((line) => ({
    count: line.count,
    // Une ligne par match : un nom ne doit pas en ouvrir une autre.
    text: text
      .t("refereeDigest.line", {
        start: line.start,
        pairing: line.pairing ?? text.t("refereeDigest.pairingSolo", { count: line.count }),
        tournament: line.tournament,
        round: line.round,
      })
      .replace(/\s+/g, " "),
  }));
}

/**
 * Corps du programme : lignes gardées tant que le tout — « … et N autres » et
 * « Heure de Paris » compris — tient dans la borne du corps (`PUSH_BODY_MAX`) :
 * coupé au-delà, le push perdrait ces deux lignes, et l'arbitre croirait la
 * liste complète. La première ligne reste, raccourcie s'il le faut.
 */
function fitDigestBody(lines: readonly DigestLine[], total: number, text: PushText): string {
  const timeZone = text.t("refereeDigest.timeZone");
  const footer = (hidden: number) =>
    hidden > 0 ? [text.t("refereeDigest.more", { count: hidden }), timeZone] : [timeZone];
  const shown: string[] = [];
  let listed = 0;
  for (const line of lines) {
    const next = [...shown, line.text, ...footer(total - listed - line.count)];
    if (shown.length > 0 && charCount(next.join("\n")) > PUSH_BODY_MAX) break;
    shown.push(line.text);
    listed += line.count;
  }
  const tail = footer(total - listed);
  const room = PUSH_BODY_MAX - charCount(tail.join("\n")) - 1;
  if (shown.length === 1 && charCount(shown[0]) > room) shown[0] = clipPushText(shown[0], Math.max(room, 1));
  return [...shown, ...tail].join("\n");
}

/** L'adversaire a saisi un score : à confirmer, ou à contester. */
export function scoreToConfirmPush(
  side: MatchSide & { autoValidationPaused?: boolean },
  locale: Locale = DEFAULT_LOCALE,
): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("scoreToConfirm.title"),
    // Validation d'office suspendue par l'arbitrage (resaisie du déclarant
    // après un « Enregistrer » d'arbitre) : ne pas promettre une validation
    // qui n'aura pas lieu (`SCORE_DISPUTE_LOCK.md`).
    body: text.t(side.autoValidationPaused ? "scoreToConfirm.bodyPaused" : "scoreToConfirm.body", {
      opponent: side.solo ? text.t("scoreToConfirm.soloOpponent") : side.opponentName,
      tournament: side.tournamentName,
    }),
    url: localeHref(tournamentMatchHref(side.tournamentId, side.matchId), locale),
    tag: `${matchTag(side.matchId)}-score`,
  };
}

/**
 * Le score saisi par une seule équipe a été validé d'office, l'autre n'ayant
 * rien répondu en deux heures (`docs/features/SCORE_DISPUTE_LOCK.md`). Envoyé
 * aux deux équipes ; ne nomme personne (écran verrouillé, tournoi individuel).
 */
export function scoreAutoValidatedPush(
  input: { tournamentId: number; tournamentName: string; matchId: number },
  locale: Locale = DEFAULT_LOCALE,
): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("scoreAutoValidated.title"),
    body: text.t("scoreAutoValidated.body", { tournament: input.tournamentName }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    tag: `${matchTag(input.matchId)}-score`,
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
 * aucun accord n'est demandé, hors des conditions d'utilisation qu'une entrée
 * annonce à accepter (fenêtre des conditions). `titles` : les titres **dans la langue du
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
export type RefereeAlertKind =
  | "score_conflict"
  | "score_report_stalled"
  | "match_no_referee"
  | "match_no_referee_round"
  | "other";

/** La manche en cause, quand l'alerte en a une : de quoi la nommer et y mener. */
export type RefereeAlertMatch = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  bracket: string;
  roundNumber: number;
  /** Ronde suisse : « Ronde N » (`swissRoundSql`). */
  swiss?: boolean;
  /** Alerte groupée d'une manche sans horaire : nombre de matchs listés. */
  matchCount?: number;
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
      count: match.matchCount ?? 1,
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

/** Issue retenue par l'arbitrage d'un litige (`SCORE_DISPUTE_LOCK.md` § Arbitre qui joue). */
export type SelfResolvedOutcome =
  | { kind: "score"; team1Score: number; team2Score: number }
  | { kind: "forfeit"; forfeitSide: 1 | 2 }
  | { kind: "doubleForfeit" };

/** Litige tranché par un membre du staff qui joue la manche. */
export type SelfResolvedDispute = RefereeAlertMatch & {
  team1Name: string;
  team2Name: string;
  /** Tournoi individuel : aucun nom d'engagé n'est cité (ce serait un pseudo). */
  solo: boolean;
  outcome: SelfResolvedOutcome;
};

/**
 * L'issue en quelques mots, dans la langue voulue. `name` met en forme un nom
 * d'équipe (le journal Discord le neutralise, `discordInline`) ; en tournoi
 * individuel, aucun nom : un nom d'engagé y serait un pseudo de joueur.
 */
export function selfResolvedOutcomeText(
  input: Pick<SelfResolvedDispute, "team1Name" | "team2Name" | "solo" | "outcome">,
  locale: Locale = DEFAULT_LOCALE,
  name: (value: string) => string = (value) => value,
): string {
  const text = TEXT[locale];
  const { outcome } = input;
  if (outcome.kind === "doubleForfeit") return text.t("selfResolved.doubleForfeit");
  if (outcome.kind === "forfeit") {
    if (input.solo) return text.t("selfResolved.forfeitSolo");
    return text.t("selfResolved.forfeit", { team: name(outcome.forfeitSide === 1 ? input.team1Name : input.team2Name) });
  }
  const scores = { score1: outcome.team1Score, score2: outcome.team2Score };
  if (input.solo) return text.t("selfResolved.scoreSolo", scores);
  return text.t("selfResolved.score", { ...scores, team1: name(input.team1Name), team2: name(input.team2Name) });
}

/**
 * Alerte aux **autres** membres du staff (`REFEREE_SELF_RESOLUTION`) : un des
 * leurs, qui joue la manche, vient d'en trancher le litige. Ni son pseudo ni
 * celui d'un joueur : le tournoi, la manche et l'issue suffisent à aller voir.
 */
export function selfResolvedDisputePush(input: SelfResolvedDispute, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("selfResolved.title"),
    body: text.t("selfResolved.body", {
      tournament: input.tournamentName,
      round: pushRoundLabel(input.bracket, input.roundNumber, locale, input.swiss),
      outcome: selfResolvedOutcomeText(input, locale),
    }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    tag: `self-resolved-${input.matchId}`,
  };
}

/**
 * Alerte aux **autres** membres du staff (`REFEREE_SELF_RESOLUTION`) : un des
 * leurs, qui joue la manche, vient d'en **corriger** le résultat déjà acquis.
 */
export function selfCorrectedResultPush(input: SelfResolvedDispute, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("selfCorrected.title"),
    body: text.t("selfCorrected.body", {
      tournament: input.tournamentName,
      round: pushRoundLabel(input.bracket, input.roundNumber, locale, input.swiss),
      outcome: selfResolvedOutcomeText(input, locale),
    }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    tag: `self-corrected-${input.matchId}`,
  };
}

/**
 * Alerte aux **autres** membres du staff (`REFEREE_SELF_RESOLUTION`) : un des
 * leurs, qui joue la manche, vient de la clore en imposant l'abandon de son
 * adversaire (route d'abandon, chemin arbitrage).
 */
export function selfImposedForfeitPush(input: SelfResolvedDispute, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("selfForfeit.title"),
    body: text.t("selfForfeit.body", {
      tournament: input.tournamentName,
      round: pushRoundLabel(input.bracket, input.roundNumber, locale, input.swiss),
      outcome: selfResolvedOutcomeText(input, locale),
    }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    tag: `self-forfeit-${input.matchId}`,
  };
}

/**
 * Alerte aux **autres** membres du staff (`REFEREE_SELF_RESOLUTION`) : un des
 * leurs, qui joue la manche, vient d'en suspendre la validation automatique
 * (« Enregistrer » sur un report seul). Ni pseudo ni nom d'engagé.
 */
export function selfPausedValidationPush(input: RefereeAlertMatch, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  return {
    title: text.t("selfPaused.title"),
    body: text.t("selfPaused.body", {
      tournament: input.tournamentName,
      round: pushRoundLabel(input.bracket, input.roundNumber, locale, input.swiss),
    }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    tag: `self-paused-${input.matchId}`,
  };
}

/**
 * Au caster dont l'inscription sur un match vient d'être retirée par un autre
 * que lui (`CAST_RELEASED`), avec le motif. Les deux engagées sont nommées
 * quand ce sont des équipes ; en tournoi individuel, « Un match » (leurs noms
 * sont des pseudos). Une place encore vide se lit « TBD ».
 */
export function castReleasedPush(input: CastReleasedMatch, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  const tbd = text.t("matchScheduled.tbd");
  const pairingText = input.solo
    ? text.t("castReleased.pairingSolo")
    : text.t("pairing", { team: input.team1Name ?? tbd, opponent: input.team2Name ?? tbd });
  return {
    title: text.t("castReleased.title"),
    body: text.t("castReleased.body", {
      reason: text.t(`castReleased.reason.${input.reason}`),
      pairing: pairingText,
      tournament: input.tournamentName,
      round: pushRoundLabel(input.bracket, input.roundNumber, locale, input.swiss),
    }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    tag: `${matchTag(input.matchId)}-cast`,
  };
}

/** Motif du retrait d'un arbitre désigné (`REFEREE_RELEASED`). */
export type RefereeReleaseReason = "STAFF" | "REPLACED" | "SELF_MANAGED" | "OBJECTION" | "INELIGIBLE" | "JOINED_TEAM";

/** Le match dont l'arbitrage est retiré, et pourquoi. */
export type RefereeReleasedMatch = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  bracket: string;
  roundNumber: number;
  swiss?: boolean;
  team1Name: string | null;
  team2Name: string | null;
  /** Tournoi individuel : aucun nom d'engagé (ce serait un pseudo). */
  solo: boolean;
  reason: RefereeReleaseReason;
};

/** L'arbitrage d'un match est retiré à son arbitre désigné par un autre que lui. */
export function refereeReleasedPush(input: RefereeReleasedMatch, locale: Locale = DEFAULT_LOCALE): PushContent {
  const text = TEXT[locale];
  const tbd = text.t("matchScheduled.tbd");
  const pairingText = input.solo
    ? text.t("castReleased.pairingSolo")
    : text.t("pairing", { team: input.team1Name ?? tbd, opponent: input.team2Name ?? tbd });
  return {
    title: text.t("refereeReleased.title"),
    body: text.t("refereeReleased.body", {
      reason: text.t(`refereeReleased.reason.${input.reason}`),
      pairing: pairingText,
      tournament: input.tournamentName,
      round: pushRoundLabel(input.bracket, input.roundNumber, locale, input.swiss),
    }),
    url: localeHref(tournamentMatchHref(input.tournamentId, input.matchId), locale),
    tag: `${matchTag(input.matchId)}-referee`,
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
