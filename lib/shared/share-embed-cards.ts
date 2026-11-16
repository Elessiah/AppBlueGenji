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
import { SHARE_STATE_TONES, SHARE_TIME_ZONE, truncateForShare, type ShareStateTone } from "./share-metadata";
import type { MatchShareSummary, ShareEntrantSide, ShareLeader } from "./share-embeds";
import { localizedTournamentLabel } from "./tournament-labels";
import type { MatchStatus, TournamentCard } from "./types";
import { visibleText } from "./visible-text";

/** Les textes que lisent les cartes. */
export type ShareEmbedMessages = Pick<Messages, "share" | "labels">;

type EmbedText = Messages["share"]["embed"];

/** Remplit `{nom}` ; une variable inconnue reste telle quelle. */
function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/gu, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

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
  const hour = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: SHARE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${day} · ${hour}`;
}

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

/** Initiale du repli de logo (`ShareTeamMark`). */
function initialOf(name: string): string {
  return Array.from(name)[0]?.toUpperCase() ?? "?";
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
  alt: string;
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
    alt: fill(text.tournamentAlt, { name: title }),
  };
}

/** Pastille d'état d'un match : à venir, résultat en attente, terminé. */
const MATCH_STATE: Record<MatchStatus, { key: keyof EmbedText["matchStates"]; tone: ShareStateTone }> = {
  PENDING: { key: "UPCOMING", tone: "accent" },
  READY: { key: "UPCOMING", tone: "accent" },
  AWAITING_CONFIRMATION: { key: "RUNNING", tone: "info" },
  COMPLETED: { key: "COMPLETED", tone: "success" },
};

/** Le centre du tableau d'affichage : un score, ou un mot (forfait, double forfait). */
export type EmbedScoreCenter = { kind: "score"; team1: string; team2: string } | { kind: "label"; text: string } | { kind: "none" };

/** Une case de map : « Map 1 · Ilios », son score et son code de replay. */
export type EmbedMapCell = { label: string; score: string; code: string | null; winnerSide: 1 | 2 | null };

/** Ce que l'image d'un match dessine. */
export type MatchEmbedCard = {
  eyebrow: string;
  state: { label: string; tone: ShareStateTone };
  /** Nom du tournoi. */
  title: string;
  /** Place du match (« Manche 2 · Match 3 »). */
  subtitle: string;
  team1: EmbedTeamMark;
  team2: EmbedTeamMark;
  center: EmbedScoreCenter;
  maps: EmbedMapCell[];
  /** Maps jouées au-delà des cases dessinées (« +2 maps »), `null` sinon. */
  moreMaps: string | null;
  footer: string;
  alt: string;
};

function scoreCenter(match: MatchShareSummary, names: readonly [string, string], text: EmbedText): EmbedScoreCenter {
  if (match.doubleForfeit) return { kind: "label", text: text.doubleForfeit };
  if (match.forfeitSide !== null && match.score === null) {
    return { kind: "label", text: fill(text.forfeit, { name: names[match.forfeitSide - 1] }) };
  }
  if (match.score === null) return { kind: "none" };
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
): MatchEmbedCard {
  const text = messages.share.embed;
  const names = [embedSideName(match.team1, 1, text), embedSideName(match.team2, 2, text)] as const;
  const state = MATCH_STATE[match.status];
  const shownMaps = match.maps.slice(0, EMBED_MAX_MAPS);
  const extra = match.maps.length - shownMaps.length;
  return {
    eyebrow: localizedTournamentLabel(messages.labels, "game", card.game),
    state: { label: text.matchStates[state.key], tone: state.tone },
    title: shownText(card.name, EMBED_TITLE_MAX_LENGTH) || text.tournamentFallback,
    subtitle: position,
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
    alt: fill(text.matchAlt, { team1: names[0], team2: names[1] }),
  };
}

/** Titre de l'encart d'un match : « A contre B · Manche 2 · Match 3 ». */
export function matchEmbedTitle(match: MatchShareSummary, position: string, messages: ShareEmbedMessages): string {
  const text = messages.share.embed;
  const versus = fill(text.versus, {
    team1: embedSideName(match.team1, 1, text),
    team2: embedSideName(match.team2, 2, text),
  });
  return `${versus} · ${position}`;
}

/**
 * Description de l'encart d'un match : le score, puis chaque map jouée (nom,
 * score, code de replay), bornée à {@link EMBED_DESCRIPTION_MAX_LENGTH}.
 * `null` tant que le match n'a ni score ni map : l'encart garde alors celle du
 * tournoi.
 */
export function matchEmbedDescription(match: MatchShareSummary, messages: ShareEmbedMessages): string | null {
  const text = messages.share.embed;
  const names = [embedSideName(match.team1, 1, text), embedSideName(match.team2, 2, text)] as const;
  const center = scoreCenter(match, names, text);
  const parts: string[] = [];
  if (center.kind === "score") parts.push(`${names[0]} ${center.team1} – ${center.team2} ${names[1]}`);
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
