/**
 * Aperçus riches des liens partagés par le bouton « Partager »
 * (`docs/features/SHARE_EMBEDS.md`, décisions D73 et D74).
 *
 * Le bouton partage toujours l'adresse **publique** (`/suivre/…`) : un lien
 * part où l'on ne contrôle rien, et seule la page sans compte s'y ouvre. Son
 * encart porte une image compacte « façon Spotify » : pour un tournoi, son
 * nom, son jeu, son format, son état, ses dates, l'effectif et l'équipe en tête
 * (ou victorieuse) ; pour un match, les deux engagés, le score et chaque map
 * jouée avec son score et son code de replay.
 *
 * Ce module est **pur** : il réduit la réponse publique d'un tournoi
 * (`spectatorSnapshot`, déjà allégée de ce que `/rgpd` ne déclare pas public)
 * à ce que les cartes dessinent. Il ne lit jamais l'instantané des membres :
 * une carte ne montre rien qu'un visiteur sans compte ne voie déjà sur
 * `/suivre/`.
 *
 * **Aucun pseudo** (D73) : un engagé solo (tournoi individuel) n'est jamais
 * nommé — « Joueur 1 » / « Joueur 2 » sur un match, pas de ligne « en tête »
 * sur un tournoi individuel (un libellé générique n'y apprendrait rien) — et
 * son avatar n'est jamais dessiné. Les noms d'équipe, eux, sont permis.
 */
import { matchMapNames } from "./round-maps";
import { isMatchPlayed } from "./match-outcome";
import { isSoloTournament } from "./participants";
import { localUploadUrl } from "./uploads";
import type { BracketMatch, BracketType, MatchStatus, TournamentCard, TournamentSnapshot } from "./types";

/** Un camp d'un match, ou l'engagé en tête, tel qu'une carte peut le montrer. */
export type ShareEntrantSide = {
  teamId: number | null;
  /** Nom d'équipe ; `null` pour un engagé solo (jamais son pseudo) ou un camp à venir. */
  name: string | null;
  /** Logo d'équipe, fichier du site seulement ; jamais l'avatar d'un joueur. */
  logoUrl: string | null;
  solo: boolean;
};

/** Une map jouée (résultat retenu) : D74, son code de replay est public. */
export type ShareMapRow = {
  mapNumber: number;
  /** Nom de la carte quand la manche ou le match le fixe, `null` sinon. */
  mapName: string | null;
  team1Score: number;
  team2Score: number;
  /** Code de replay ; vide quand l'arbitrage s'en est passé. */
  replayCode: string;
};

/** Ce que la carte d'un match dessine. */
export type MatchShareSummary = {
  matchId: number;
  bracket: BracketType;
  roundNumber: number;
  matchNumber: number;
  status: MatchStatus;
  team1: ShareEntrantSide;
  team2: ShareEntrantSide;
  /** Score affiché (celui de la carte unique d'un BO1), `null` tant qu'aucun n'est posé. */
  score: { team1: number; team2: number } | null;
  winnerSide: 1 | 2 | null;
  forfeitSide: 1 | 2 | null;
  doubleForfeit: boolean;
  maps: ShareMapRow[];
};

/** L'engagé victorieux d'un tournoi terminé, ou en tête d'un classement en cours. */
export type ShareLeader = { kind: "WINNER" | "LEADER"; side: ShareEntrantSide };

/** Résumé d'un tournoi pour ses cartes, calculé une fois par réponse publique. */
export type TournamentShareSummary = {
  leader: ShareLeader | null;
  matches: ReadonlyMap<number, MatchShareSummary>;
};

/** Ce que le résumé lit de la réponse publique. */
export type ShareSummarySource = Pick<
  TournamentSnapshot,
  "card" | "soloUserIds" | "registrations" | "matches" | "swiss" | "survival" | "endurance" | "mapRules"
>;

function sideOf(
  snapshot: Pick<TournamentSnapshot, "card" | "soloUserIds">,
  logos: ReadonlyMap<number, string | null>,
  teamId: number | null,
  name: string | null,
): ShareEntrantSide {
  if (teamId === null) return { teamId: null, name: null, logoUrl: null, solo: false };
  const solo = isSoloTournament(snapshot.card.participantType) || snapshot.soloUserIds[teamId] !== undefined;
  if (solo) return { teamId, name: null, logoUrl: null, solo: true };
  return { teamId, name, logoUrl: localUploadUrl(logos.get(teamId) ?? null), solo: false };
}

function sideNumber(match: BracketMatch, teamId: number | null): 1 | 2 | null {
  if (teamId === null) return null;
  if (teamId === match.team1Id) return 1;
  if (teamId === match.team2Id) return 2;
  return null;
}

function displayedScore(match: BracketMatch): MatchShareSummary["score"] {
  if (match.doubleForfeit) return null;
  const shown = match.displayScore ?? null;
  if (shown) return { team1: shown.team1, team2: shown.team2 };
  if (match.team1Score === null || match.team2Score === null) return null;
  return { team1: match.team1Score, team2: match.team2Score };
}

function matchSummary(
  snapshot: Pick<TournamentSnapshot, "card" | "soloUserIds" | "mapRules">,
  logos: ReadonlyMap<number, string | null>,
  match: BracketMatch,
): MatchShareSummary {
  const names = match.maps.length > 0 ? matchMapNames(snapshot.mapRules.rounds, match) : [];
  return {
    matchId: match.id,
    bracket: match.bracket,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: match.status,
    team1: sideOf(snapshot, logos, match.team1Id, match.team1Name),
    team2: sideOf(snapshot, logos, match.team2Id, match.team2Name),
    score: displayedScore(match),
    winnerSide: sideNumber(match, match.winnerTeamId),
    forfeitSide: sideNumber(match, match.forfeitTeamId),
    doubleForfeit: match.doubleForfeit,
    maps: match.maps.map((map) => ({
      mapNumber: map.mapNumber,
      mapName: names[map.mapNumber - 1] ?? null,
      team1Score: map.team1Score,
      team2Score: map.team2Score,
      replayCode: map.replayCode,
    })),
  };
}

/** La seule ligne de rang 1 d'un classement ; `null` sans elle ou en cas d'égalité. */
function soleTop<T extends { teamId: number; teamName: string; rank: number }>(rows: readonly T[] | undefined): T | null {
  const top = (rows ?? []).filter((row) => row.rank === 1);
  return top.length === 1 ? top[0] : null;
}

function leaderOf(snapshot: ShareSummarySource, logos: ReadonlyMap<number, string | null>): ShareLeader | null {
  // Tournoi individuel : le seul nom à écrire serait un pseudo.
  if (isSoloTournament(snapshot.card.participantType)) return null;
  if (snapshot.card.state === "FINISHED") {
    const winners = snapshot.registrations.filter((registration) => registration.finalRank === 1);
    if (winners.length !== 1) return null;
    const side = sideOf(snapshot, logos, winners[0].teamId, winners[0].teamName);
    return side.solo ? null : { kind: "WINNER", side };
  }
  if (snapshot.card.state !== "RUNNING" || !snapshot.matches.some(isMatchPlayed)) return null;
  const top =
    soleTop(snapshot.swiss?.standings) ?? soleTop(snapshot.survival?.standings) ?? soleTop(snapshot.endurance?.standings);
  if (!top) return null;
  const side = sideOf(snapshot, logos, top.teamId, top.teamName);
  return side.solo ? null : { kind: "LEADER", side };
}

/**
 * Résume la **réponse publique** d'un tournoi (`spectatorSnapshot`) pour ses
 * cartes d'aperçu. À n'appeler que sur elle : c'est ce qui garantit qu'une
 * carte ne montre rien de plus que la page sans compte.
 *
 * L'équipe « en tête » : la vainqueure d'un tournoi terminé (rang final 1),
 * sinon, en cours et après au moins un match joué, la première d'un
 * classement (suisse, Survie, BlueGenji Survie) — jamais sur une égalité, ni
 * pour un arbre à élimination, qui n'a pas de « première » avant sa finale.
 */
export function buildTournamentShareSummary(snapshot: ShareSummarySource): TournamentShareSummary {
  const logos = new Map(snapshot.registrations.map((registration) => [registration.teamId, registration.logoUrl]));
  const leader = leaderOf(snapshot, logos);
  // Les matchs ne servent qu'à la page et à l'image d'un match, rarement
  // demandées : le résumé de chacun n'est construit qu'à la première lecture
  // (puis gardé), et non à chaque reconstruction de la réponse publique. Le
  // résumé ne retient que ce que cette construction relit.
  const source = { card: snapshot.card, soloUserIds: snapshot.soloUserIds, mapRules: snapshot.mapRules, matches: snapshot.matches };
  let matches: ReadonlyMap<number, MatchShareSummary> | null = null;
  return {
    leader,
    get matches() {
      if (matches === null) {
        const built = new Map<number, MatchShareSummary>();
        for (const match of source.matches) built.set(match.id, matchSummary(source, logos, match));
        matches = built;
      }
      return matches;
    },
  };
}

/**
 * Empreinte courte d'une valeur (FNV-1a 32 bits, base 36) : posée en `?v=` sur
 * l'adresse de l'image, elle change avec ce que la carte dessine — un score
 * saisi donne une nouvelle adresse, que Discord ou X vont chercher au lieu de
 * resservir l'ancienne image de leur cache.
 */
export function shareVersion(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Empreinte de ce que l'image d'un tournoi dessine. */
export function tournamentShareVersion(card: TournamentCard, leader: ShareLeader | null): string {
  return shareVersion([
    card.name,
    card.description,
    card.game,
    card.format,
    card.participantType,
    card.state,
    card.registeredTeams,
    card.maxTeams,
    card.registrationOpenAt,
    card.registrationCloseAt,
    card.startAt,
    leader,
  ]);
}

/**
 * L'image du tournoi peut-elle nommer une équipe en tête ? Seulement un tournoi
 * par équipes, en cours ou terminé (`leaderOf`) : ailleurs la carte ne dépend
 * que de la carte du tournoi, sans réponse publique à reconstruire.
 */
export function tournamentMayHaveLeader(card: Pick<TournamentCard, "participantType" | "state">): boolean {
  return !isSoloTournament(card.participantType) && (card.state === "RUNNING" || card.state === "FINISHED");
}

/** Fenêtre d'une empreinte de tournoi **en cours** lue sans sa réponse publique : celle du cache de l'image. */
export const UNSETTLED_SHARE_VERSION_MS = 5 * 60_000;

/**
 * Fenêtre d'une empreinte de tournoi **terminé** lue sans sa réponse publique :
 * sa vainqueure ne bouge plus (sauf correction d'un résultat après coup), un
 * robot d'aperçu peut garder son image une journée sans rien montrer de faux
 * — et ne fait pas reconstruire la réponse publique à chaque collage.
 */
export const FINISHED_SHARE_VERSION_MS = 24 * 60 * 60_000;

/**
 * Empreinte de l'image d'un tournoi quand l'encart n'a **pas** la réponse
 * publique en mémoire (il ne la reconstruit jamais pour un robot) : l'équipe
 * en tête, que la route de l'image dessinera, lui est inconnue. Pour un
 * tournoi par équipes en cours — où elle change au fil des matchs —
 * l'empreinte change à chaque fenêtre de cinq minutes ; terminé, une fois par
 * jour (une correction après coup finit par se voir). Ailleurs, il n'y a pas
 * d'équipe en tête, l'empreinte est exacte.
 */
export function tournamentShareVersionWithoutSummary(card: TournamentCard, now: number = Date.now()): string {
  const base = tournamentShareVersion(card, null);
  if (!tournamentMayHaveLeader(card)) return base;
  let windowMs: number | null = null;
  if (card.state === "RUNNING") windowMs = UNSETTLED_SHARE_VERSION_MS;
  else if (card.state === "FINISHED") windowMs = FINISHED_SHARE_VERSION_MS;
  return windowMs === null ? base : `${base}.${Math.floor(now / windowMs).toString(36)}`;
}

/** Empreinte de ce que l'image d'un match dessine. */
export function matchShareVersion(card: TournamentCard, match: MatchShareSummary): string {
  return shareVersion([card.name, card.game, match]);
}

const TOURNAMENT_KEY_PATTERN = /^tournament-([1-9]\d{0,9})$/u;
const MATCH_KEY_PATTERN = /^tournament-([1-9]\d{0,9})-match-([1-9]\d{0,9})$/u;

/** Clé de l'image du tournoi `tournamentId` (`/og/<langue>/<clé>.png`). */
export function tournamentShareCardKey(tournamentId: number): string {
  return `tournament-${tournamentId}`;
}

/** Clé de l'image du match `matchId` du tournoi `tournamentId`. */
export function matchShareCardKey(tournamentId: number, matchId: number): string {
  return `tournament-${tournamentId}-match-${matchId}`;
}

export type EmbedShareTarget =
  | { kind: "tournament"; tournamentId: number }
  | { kind: "match"; tournamentId: number; matchId: number };

/**
 * La cible d'une clé d'image : une seule écriture par tournoi ou par match
 * (entiers positifs sans zéro de tête, dix chiffres au plus), `null` sinon.
 */
export function parseEmbedShareCardKey(key: string): EmbedShareTarget | null {
  const tournament = TOURNAMENT_KEY_PATTERN.exec(key);
  if (tournament) {
    const tournamentId = Number(tournament[1]);
    return Number.isSafeInteger(tournamentId) ? { kind: "tournament", tournamentId } : null;
  }
  const match = MATCH_KEY_PATTERN.exec(key);
  if (!match) return null;
  const tournamentId = Number(match[1]);
  const matchId = Number(match[2]);
  return Number.isSafeInteger(tournamentId) && Number.isSafeInteger(matchId)
    ? { kind: "match", tournamentId, matchId }
    : null;
}

/** Adresse de l'image d'un tournoi ou d'un match, versionnée par son contenu. */
export function embedShareImagePath(key: string, locale: string, version: string): string {
  return `/og/${locale}/${key}.png?v=${version}`;
}
