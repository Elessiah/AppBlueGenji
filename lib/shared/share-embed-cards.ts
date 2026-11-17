/**
 * Rédaction des cartes d'aperçu d'un tournoi et d'un match partagés
 * (`docs/features/SHARE_EMBEDS.md`) : ce que l'image dessine et ce que
 * l'encart écrit, **dans la langue de l'adresse** (`/suivre/…` en français,
 * `/en/suivre/…` en anglais). Pur : les données viennent du résumé de la
 * réponse publique (`share-embeds.ts`), les textes de l'espace `share` et des
 * libellés communs (`labels`).
 *
 * Tout nom saisi (tournoi, équipe, carte) repasse par `visibleText` avant
 * d'être borné : un caractère invisible ou de contrôle n'arrive ni au PNG ni à
 * l'encart (`UNTRUSTED_NAMES.md`). Un engagé solo n'est jamais nommé.
 */
import type { Locale } from "./locales";
import { INTL_LOCALE } from "./locales";
import type { Messages } from "./i18n-messages";
import {
  fillShareTemplate as fill,
  SHARE_STATE_TONES,
  SHARE_TIME_ZONE,
  shareInitial as initialOf,
  truncateForShare,
  type ShareStateTone,
} from "./share-metadata";
import { matchScheduledAt, type MatchShareSummary, type ShareEntrantSide, type ShareLeader } from "./share-embeds";
import { localizedTournamentLabel } from "./tournament-labels";
import type { MatchStatus, TournamentCard } from "./types";
import { visibleText } from "./visible-text";
import { cutToWidth, displayWidth, isolateDirection } from "./graphemes";

/** Les textes que lisent les cartes. */
export type ShareEmbedMessages = Pick<Messages, "share" | "labels">;

type EmbedText = Messages["share"]["embed"];

/** Longueur maximale du titre (nom du tournoi) : trois lignes à la plus petite taille. */
export const EMBED_TITLE_MAX_LENGTH = 90;
/** Longueur maximale de l'accroche d'un tournoi (une à deux lignes). */
export const EMBED_SUBTITLE_MAX_LENGTH = 130;
/** Longueur maximale d'un nom d'équipe sur la carte d'un match (deux lignes de sa colonne). */
export const EMBED_TEAM_NAME_MAX_LENGTH = 32;
/** Longueur maximale d'un nom de carte dans une case de map. */
export const EMBED_MAP_NAME_MAX_LENGTH = 20;
/** Cases de maps dessinées au plus (trois lignes de trois) ; la suite est comptée. */
export const EMBED_MAX_MAPS = 9;
/** Longueur maximale de la description d'un encart (Discord coupe vers 350). */
export const EMBED_DESCRIPTION_MAX_LENGTH = 300;

/** Un texte saisi, nettoyé puis borné ; `""` s'il n'en reste rien. */
function shownText(raw: string, maxLength: number): string {
  return truncateForShare(visibleText(raw), maxLength);
}

/** Une date courte dans la langue, à l'heure de Paris : « 16 sept. 2026 · 13:35 ». */
export function embedShortDate(iso: string, locale: Locale): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const day = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: SHARE_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  return `${day} · ${embedHour(date, locale)}`;
}

/** Première lettre en capitale (« mardi » → « Mardi »), dans la langue. */
function capitalized(text: string, locale: Locale): string {
  return text.charAt(0).toLocaleUpperCase(INTL_LOCALE[locale]) + text.slice(1);
}

/** L'heure de Paris sur 24 h : « 21:00 » (les deux langues, comme la fiche). */
function embedHour(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: SHARE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** Date longue d'un match programmé, à l'heure de Paris : « Mardi 18 novembre · 21:00 » / « Tuesday, November 18 · 21:00 ». */
export function embedLongWhen(iso: string, locale: Locale): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const day = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: SHARE_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  return `${capitalized(day, locale)} · ${embedHour(date, locale)}`;
}

/** Date courte pour un titre : « mar. 18 nov. 21:00 » / « Tue, Nov 18 21:00 ». */
export function embedShortWhen(iso: string, locale: Locale): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const day = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: SHARE_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
  return `${day} ${embedHour(date, locale)}`;
}

export { matchScheduledAt };

type ScheduleKey = keyof EmbedText["schedule"];

/** L'échéance qui compte à cet instant (même règle que l'encart d'une fiche). */
function scheduleOf(card: TournamentCard, now: number): { key: ScheduleKey; iso: string } {
  if (card.state === "FINISHED") return { key: "FINISHED", iso: card.startAt };
  if (card.state === "RUNNING") return { key: "RUNNING", iso: card.startAt };
  if (card.state === "REGISTRATION") return { key: "REGISTRATION", iso: card.registrationCloseAt };
  const opensAt = Date.parse(card.registrationOpenAt);
  if (Number.isFinite(opensAt) && now < opensAt) return { key: "OPENS", iso: card.registrationOpenAt };
  return { key: "KICKOFF", iso: card.startAt };
}

/** Le nom d'un camp tel qu'une carte l'écrit : jamais un pseudo. */
export function embedSideName(side: ShareEntrantSide, slot: 1 | 2, text: EmbedText): string {
  if (side.solo) return fill(text.playerSide, { number: slot });
  if (side.teamId === null) return text.tbd;
  const name = side.name === null ? "" : shownText(side.name, EMBED_TEAM_NAME_MAX_LENGTH);
  return name || fill(text.teamFallback, { id: side.teamId });
}

/** Une équipe dessinée : nom, initiale de repli, logo (fichier du site) et victoire. */
export type EmbedTeamMark = { name: string; initial: string; logoUrl: string | null; winner: boolean };

/** Ce que l'image d'un tournoi dessine. */
export type TournamentEmbedCard = {
  eyebrow: string;
  state: { label: string; tone: ShareStateTone };
  title: string;
  subtitle?: string;
  facts: { label: string; value: string }[];
  footer: string;
  /** Équipe en tête ou victorieuse : son logo occupe le motif de droite. */
  leader: EmbedTeamMark | null;
};

/**
 * La carte d'un tournoi : jeu, état, nom, puis l'équipe victorieuse ou en tête
 * (à défaut, la description de l'organisateur), et trois faits — format,
 * effectif, échéance.
 */
export function tournamentEmbedCard(
  card: TournamentCard,
  leader: ShareLeader | null,
  messages: ShareEmbedMessages,
  locale: Locale,
  now: number = Date.now(),
): TournamentEmbedCard {
  const text = messages.share.embed;
  const title = shownText(card.name, EMBED_TITLE_MAX_LENGTH) || text.tournamentFallback;
  const facts = [
    { label: text.format, value: localizedTournamentLabel(messages.labels, "format", card.format) },
    {
      label: text.entrants[card.participantType === "SOLO" ? "SOLO" : "TEAM"],
      value: `${card.registeredTeams}/${card.maxTeams}`,
    },
  ];
  const next = scheduleOf(card, now);
  const date = embedShortDate(next.iso, locale);
  if (date) facts.push({ label: text.schedule[next.key], value: date });

  let subtitle: string | undefined;
  let mark: EmbedTeamMark | null = null;
  if (leader && !leader.side.solo) {
    const name = embedSideName(leader.side, 1, text);
    subtitle = fill(leader.kind === "WINNER" ? text.winner : text.leader, { name });
    mark = { name, initial: initialOf(name), logoUrl: leader.side.logoUrl, winner: leader.kind === "WINNER" };
  } else if (card.description) {
    subtitle = shownText(card.description, EMBED_SUBTITLE_MAX_LENGTH) || undefined;
  }

  return {
    eyebrow: localizedTournamentLabel(messages.labels, "game", card.game),
    state: {
      label: localizedTournamentLabel(messages.labels, "state", card.state),
      tone: SHARE_STATE_TONES[card.state] ?? "info",
    },
    title,
    subtitle,
    facts,
    footer: messages.share.footer,
    leader: mark,
  };
}

type MatchStateBadge = { key: keyof EmbedText["matchStates"]; tone: ShareStateTone };

/** Pastille d'état d'un match : à venir, en cours, résultat en attente, terminé. */
const MATCH_STATE: Record<MatchStatus, MatchStateBadge> = {
  PENDING: { key: "UPCOMING", tone: "accent" },
  READY: { key: "UPCOMING", tone: "accent" },
  AWAITING_CONFIRMATION: { key: "RUNNING", tone: "info" },
  COMPLETED: { key: "COMPLETED", tone: "success" },
};

/** Un match qui n'attend pas encore de confirmation mais porte déjà un score ou des maps retenues. */
const MATCH_IN_PROGRESS: MatchStateBadge = { key: "IN_PROGRESS", tone: "info" };

/**
 * La pastille d'un match : un match pas encore soumis qui porte déjà un score
 * ou des maps retenues (saisie map par map) n'est plus « à venir » — il se
 * joue. « Résultat en attente » reste réservé au résultat soumis
 * (`AWAITING_CONFIRMATION`).
 */
function matchStateOf(match: MatchShareSummary): MatchStateBadge {
  const base = MATCH_STATE[match.status];
  if (base.key === "UPCOMING" && (match.score !== null || match.maps.length > 0)) return MATCH_IN_PROGRESS;
  return base;
}

/** Le centre du tableau d'affichage : un score, ou un mot (forfait, double forfait). */
export type EmbedScoreCenter =
  | { kind: "score"; team1: string; team2: string }
  | { kind: "label"; text: string }
  /** Ni score ni forfait : le tableau d'affichage écrit « VS » (`scoreboardVersus`). */
  | { kind: "none"; text: string };

/** L'horaire mis en avant sous les équipes d'un match à venir. */
export type EmbedSchedule = { when: string; zone: string };

/** Une case de map : « Map 1 · Ilios », son score et son code de replay. */
export type EmbedMapCell = { label: string; score: string; code: string | null; winnerSide: 1 | 2 | null };

/** Ce que l'image d'un match dessine. */
export type MatchEmbedCard = {
  eyebrow: string;
  state: { label: string; tone: ShareStateTone };
  /** Nom du tournoi. */
  title: string;
  /** Place du match (« Quart de finale 2 », « Ronde 3 · Match 2 »). */
  subtitle: string;
  /** Horaire d'un match à venir (grand, sous les équipes), `null` sinon. */
  schedule: EmbedSchedule | null;
  team1: EmbedTeamMark;
  team2: EmbedTeamMark;
  center: EmbedScoreCenter;
  maps: EmbedMapCell[];
  /** Maps jouées au-delà des cases dessinées (« +2 maps »), `null` sinon. */
  moreMaps: string | null;
  footer: string;
};

function scoreCenter(match: MatchShareSummary, names: readonly [string, string], text: EmbedText): EmbedScoreCenter {
  if (match.doubleForfeit) return { kind: "label", text: text.doubleForfeit };
  // Un forfait porte un score complet (`forfeitMatchScores`) : il se dit
  // « Forfait : X », jamais comme un match joué.
  if (match.forfeitSide !== null) {
    return { kind: "label", text: fill(text.forfeit, { name: names[match.forfeitSide - 1] }) };
  }
  if (match.score === null) return { kind: "none", text: text.scoreboardVersus };
  return { kind: "score", team1: String(match.score.team1), team2: String(match.score.team2) };
}

function mapWinner(team1Score: number, team2Score: number): 1 | 2 | null {
  if (team1Score > team2Score) return 1;
  if (team2Score > team1Score) return 2;
  return null;
}

/** Libellé d'une map : « Map 1 », suivi de son nom quand il est connu. */
function mapLabel(map: MatchShareSummary["maps"][number], text: EmbedText): string {
  const base = fill(text.map, { number: map.mapNumber });
  const name = map.mapName === null ? "" : shownText(map.mapName, EMBED_MAP_NAME_MAX_LENGTH);
  return name ? `${base} · ${name}` : base;
}

/** Code de replay affichable (D74) ; `null` quand l'arbitrage s'en est passé. */
function shownCode(code: string): string | null {
  const shown = visibleText(code).trim();
  return shown === "" ? null : shown;
}

/**
 * La carte d'un match : jeu, état, tournoi et place du match, puis le tableau
 * d'affichage (logos, noms, score) et une case par map jouée — nom de la
 * carte, score et code de replay (public une fois la map jouée, D74).
 */
export function matchEmbedCard(
  card: TournamentCard,
  match: MatchShareSummary,
  position: string,
  messages: ShareEmbedMessages,
  locale: Locale,
  now: number = Date.now(),
): MatchEmbedCard {
  const text = messages.share.embed;
  const names = [embedSideName(match.team1, 1, text), embedSideName(match.team2, 2, text)] as const;
  const state = matchStateOf(match);
  const shownMaps = match.maps.slice(0, EMBED_MAX_MAPS);
  const extra = match.maps.length - shownMaps.length;
  const scheduledAt = matchScheduledAt(match, now);
  const when = scheduledAt === null ? null : embedLongWhen(scheduledAt, locale);
  return {
    eyebrow: localizedTournamentLabel(messages.labels, "game", card.game),
    state: { label: text.matchStates[state.key], tone: state.tone },
    title: shownText(card.name, EMBED_TITLE_MAX_LENGTH) || text.tournamentFallback,
    subtitle: position,
    schedule: when === null ? null : { when, zone: text.timeZone },
    team1: { name: names[0], initial: initialOf(names[0]), logoUrl: match.team1.logoUrl, winner: match.winnerSide === 1 },
    team2: { name: names[1], initial: initialOf(names[1]), logoUrl: match.team2.logoUrl, winner: match.winnerSide === 2 },
    center: scoreCenter(match, names, text),
    maps: shownMaps.map((map) => ({
      label: mapLabel(map, text),
      score: `${map.team1Score} – ${map.team2Score}`,
      code: shownCode(map.replayCode),
      winnerSide: mapWinner(map.team1Score, map.team2Score),
    })),
    moreMaps: extra > 0 ? fill(text.moreMaps, { count: extra }) : null,
    footer: messages.share.footer,
  };
}

/** Texte alternatif de l'image d'un match, sans rédiger la carte entière. */
export function matchEmbedAlt(match: MatchShareSummary, messages: ShareEmbedMessages): string {
  const text = messages.share.embed;
  return fill(text.matchAlt, { team1: embedSideName(match.team1, 1, text), team2: embedSideName(match.team2, 2, text) });
}

/** Texte alternatif de l'image d'un tournoi, sans rédiger la carte entière. */
export function tournamentEmbedAlt(card: TournamentCard, messages: ShareEmbedMessages): string {
  const text = messages.share.embed;
  return fill(text.tournamentAlt, { name: shownText(card.name, EMBED_TITLE_MAX_LENGTH) || text.tournamentFallback });
}

/**
 * Budget du titre d'un encart de match, en colonnes ({@link displayWidth} : un
 * idéogramme ou un emoji en vaut deux) : Discord coupe le titre d'un aperçu de
 * lien d'une ellipse sur une ligne (vers 70 caractères latins à la largeur d'un
 * message) ; au-delà, le nom du tour, le score ou l'horaire disparaissaient
 * (« … · Manche 1000 · Match 2 — BlueGen… »).
 */
export const EMBED_MATCH_TITLE_BUDGET = 70;
/** Ce qu'un nom d'équipe garde au moins dans le titre (ellipse comprise), place permettant. */
export const EMBED_TITLE_TEAM_MIN_LENGTH = 4;
/**
 * En deçà de cette place par nom (« Ab… »), les noms quittent le titre : le
 * tour, le score et l'horaire restent seuls, l'image et la description
 * nomment les équipes.
 */
export const EMBED_TITLE_TEAM_FLOOR = 3;

/**
 * Les deux noms tenus dans `room` colonnes : le plus court garde tout ce qu'il
 * peut, l'autre prend le reste ; chacun garde au moins
 * {@link EMBED_TITLE_TEAM_MIN_LENGTH} colonnes quand la place le permet, la
 * moitié de la place sinon. La somme ne dépasse **jamais** `room` ; `null` quand
 * un nom n'y garderait pas {@link EMBED_TITLE_TEAM_FLOOR} colonnes.
 */
function fitNames(names: readonly [string, string], room: number): [string, string] | null {
  const [a, b] = names.map(displayWidth);
  if (a + b <= room) return [names[0], names[1]];
  const half = Math.floor(room / 2);
  const floor = Math.min(EMBED_TITLE_TEAM_MIN_LENGTH, half);
  if (floor < EMBED_TITLE_TEAM_FLOOR) return null;
  let maxA: number;
  if (a <= half) maxA = a;
  else if (b <= room - half) maxA = room - b;
  else maxA = half;
  const maxB = room - maxA;
  return [cutToWidth(names[0], Math.max(floor, maxA)), cutToWidth(names[1], Math.max(floor, maxB))];
}

/** Score en tête du titre : seulement un résultat **validé** (un score en saisie n'est pas un résultat). */
function finalScore(match: MatchShareSummary, center: EmbedScoreCenter): Extract<EmbedScoreCenter, { kind: "score" }> | null {
  return match.status === "COMPLETED" && center.kind === "score" ? center : null;
}

/**
 * Titre de l'encart d'un match, court pour n'être jamais coupé
 * ({@link EMBED_MATCH_TITLE_BUDGET}) : « A 0–3 B · Quart de finale 2 » une fois
 * le résultat validé, « A contre B · Quart de finale 2 · mar. 18 nov. 21:00 »
 * pour un match à venir, « A contre B · Finale » sinon (forfait, score en
 * saisie ou en attente de confirmation). Seuls les noms d'équipe cèdent
 * (ellipse entre deux graphèmes), jusqu'à quitter le titre quand le tour et
 * l'horaire prennent toute la place ; ni le nom du site ni celui du tournoi
 * n'y figurent (`og:site_name`, l'image et la description les portent). Un nom
 * écrit de droite à gauche est isolé ({@link isolateDirection}) : il ne
 * retourne pas le score voisin.
 */
export function matchEmbedTitle(
  match: MatchShareSummary,
  position: string,
  messages: ShareEmbedMessages,
  locale: Locale,
  now: number = Date.now(),
): string {
  const text = messages.share.embed;
  const names = [embedSideName(match.team1, 1, text), embedSideName(match.team2, 2, text)] as const;
  const score = finalScore(match, scoreCenter(match, names, text));
  const scheduledAt = matchScheduledAt(match, now);
  const when = scheduledAt === null ? null : embedShortWhen(scheduledAt, locale);
  const tail = when === null ? position : `${position} · ${when}`;
  const head = (team1: string, team2: string) =>
    score === null ? fill(text.versus, { team1, team2 }) : `${team1} ${score.team1}–${score.team2} ${team2}`;
  const room = EMBED_MATCH_TITLE_BUDGET - displayWidth(`${head("", "")} · ${tail}`);
  const fitted = fitNames(names, room);
  if (fitted === null) return tail;
  return `${head(isolateDirection(fitted[0]), isolateDirection(fitted[1]))} · ${tail}`;
}

/**
 * Titre de l'onglet d'une page de match (avant « — tournoi ») : « A contre B ·
 * Quart de finale 2 », suivi de l'horaire d'un match à venir. Noms entiers et
 * jamais de score : seul l'encart partagé ({@link matchEmbedTitle}) se plie au
 * budget de Discord.
 */
export function matchPageTitle(
  match: MatchShareSummary,
  position: string,
  messages: ShareEmbedMessages,
  locale: Locale,
  now: number = Date.now(),
): string {
  const text = messages.share.embed;
  const versus = fill(text.versus, {
    team1: embedSideName(match.team1, 1, text),
    team2: embedSideName(match.team2, 2, text),
  });
  const scheduledAt = matchScheduledAt(match, now);
  const when = scheduledAt === null ? null : embedShortWhen(scheduledAt, locale);
  return when === null ? `${versus} · ${position}` : `${versus} · ${position} · ${when}`;
}

/**
 * Description de l'encart d'un match : le score, puis chaque map jouée (nom,
 * score, code de replay), bornée à {@link EMBED_DESCRIPTION_MAX_LENGTH}.
 * `null` tant que le match n'a ni score ni map : l'encart garde alors celle du
 * tournoi. Un match **à venir** s'ouvre sur son horaire (« Mardi 18 novembre ·
 * 21:00 (heure de Paris) »).
 */
export function matchEmbedDescription(
  match: MatchShareSummary,
  messages: ShareEmbedMessages,
  locale: Locale,
  now: number = Date.now(),
): string | null {
  const text = messages.share.embed;
  const names = [embedSideName(match.team1, 1, text), embedSideName(match.team2, 2, text)] as const;
  const center = scoreCenter(match, names, text);
  const parts: string[] = [];
  const scheduledAt = matchScheduledAt(match, now);
  const when = scheduledAt === null ? null : embedLongWhen(scheduledAt, locale);
  if (when !== null) parts.push(`${when} (${text.timeZone})`);
  if (center.kind === "score") {
    parts.push(`${isolateDirection(names[0])} ${center.team1} – ${center.team2} ${isolateDirection(names[1])}`);
  }
  else if (center.kind === "label") parts.push(center.text);
  for (const map of match.maps) {
    const name = map.mapName === null ? "" : shownText(map.mapName, EMBED_MAP_NAME_MAX_LENGTH);
    const code = shownCode(map.replayCode);
    const line = fill(text.mapLine, {
      number: map.mapNumber,
      name: name ? ` (${name})` : "",
      score: `${map.team1Score}–${map.team2Score}`,
    });
    parts.push(code ? `${line}, ${fill(text.mapCode, { code })}` : line);
  }
  if (parts.length === 0) return null;
  return truncateForShare(parts.join(" · "), EMBED_DESCRIPTION_MAX_LENGTH);
}
