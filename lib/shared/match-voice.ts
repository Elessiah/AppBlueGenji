/**
 * Salons vocaux d'équipe des matchs (`docs/features/MATCH_VOICE.md`) — règles
 * pures, partagées par le serveur (création, libération) et par
 * l'interface (« Salon vocal : ouvert »).
 *
 * Option du tournoi « Salons vocaux d'équipe » (`bg_tournaments.team_voice_channels`,
 * éteinte par défaut, modifiable à tout moment) : un quart d'heure avant
 * l'heure d'un match, le bot crée un salon vocal par équipe, limité à cinq
 * places. Le lancement du match n'en dépend pas (décision du 2026-11-04), et
 * le site ne compte personne : il ne garde que l'identifiant du salon. Équipes seulement :
 * jamais pour une entrée solo (le nom du salon serait un pseudo) ni pour une
 * fantôme (personne ne la rejoindrait).
 */

import { isoTime } from "./iso-time";

/** Avance de la création des salons sur l'heure du match (minutes). */
export const VOICE_CHANNEL_LEAD_MINUTES = 15;

/** Places d'un salon (`userLimit` côté bot). */
export const VOICE_CHANNEL_CAPACITY = 5;

/**
 * Délai avant de redemander au bot ce qu'il a refusé (création ou rendu d'un
 * salon), en secondes : une panne du bot coûte un appel par salon et par
 * minute, pas un par passe du balayage.
 */
export const VOICE_RETRY_SECONDS = 60;

/**
 * Retard au-delà duquel un match jamais lancé ne reçoit plus de salon (heures) :
 * un match oublié au programme n'ouvre pas de salon des jours après son heure.
 */
export const VOICE_CHANNEL_LATE_HOURS = 24;

/**
 * Durée de garde d'une ligne de `bg_match_voice_channels` une fois le salon
 * rendu au bot (jours) — déclarée au registre des traitements (T18).
 */
export const VOICE_ROW_RETENTION_DAYS = 7;

/** Étranglement du balayage du site : au plus un passage par ce délai (secondes). */
export const VOICE_SWEEP_THROTTLE_SECONDS = 10;

/**
 * Durées appliquées par le **bot**, qui vit dans un autre dépôt : aucune
 * importation ne peut les tenir alignées, elles sont recopiées ici avec leur
 * source (`blueGenjiBot/src/voice/matchVoice.ts`) pour `/rgpd` et le registre
 * (T18). Changer l'une sans l'autre rend ces pages fausses.
 *
 * - `VOICE_BOT_RELEASED_MAX_HOURS` : `RELEASED_MAX_AGE_MS` — un salon rendu
 *   mais occupé est supprimé quand même au-delà.
 * - `VOICE_BOT_SWEEP_MINUTES` : `VOICE_SWEEP_CRON` — intervalle du balayage.
 * - `VOICE_BOT_UNRELEASED_MAX_HOURS` : `UNRELEASED_MAX_AGE_MS` — un salon
 *   jamais rendu est supprimé s'il est vide au-delà.
 * - `VOICE_BOT_ABANDONED_MAX_HOURS` : `ABANDONED_MAX_AGE_MS` — la fiche d'un
 *   salon auquel le bot n'a plus accès est oubliée au-delà.
 */
export const VOICE_BOT_RELEASED_MAX_HOURS = 24;
export const VOICE_BOT_SWEEP_MINUTES = 30;
export const VOICE_BOT_UNRELEASED_MAX_HOURS = 48;
export const VOICE_BOT_ABANDONED_MAX_HOURS = 96;

/**
 * Clé d'idempotence d'un salon côté bot : la même clé rend le même salon, si
 * bien qu'une création rejouée (réponse perdue, deux balayages) n'en double
 * aucun. Ne contient que des identifiants (`[A-Za-z0-9:_-]`, contrat du bot).
 */
export function voiceChannelKey(matchId: number, teamId: number): string {
  return `match:${matchId}:team:${teamId}`;
}

/** Une engagée qui peut avoir un salon : une équipe réelle, ni solo ni fantôme. */
export function voiceEligibleTeam(team: { isSolo: boolean; isGhost: boolean }): boolean {
  return !team.isSolo && !team.isGhost;
}

/**
 * Les salons d'un match sont-ils dus à l'instant `now` (ms) ? Un match sans
 * heure n'en a pas ; un match à plus d'un quart d'heure attend ; un match plus
 * proche — ou dont l'heure est passée sans qu'il soit lancé (option allumée en
 * cours de route) — les reçoit aussitôt, sauf passé `VOICE_CHANNEL_LATE_HOURS`.
 */
export function voiceChannelsDue(startAt: string | null, now: number): boolean {
  const start = isoTime(startAt);
  return (
    start !== null &&
    start - VOICE_CHANNEL_LEAD_MINUTES * 60_000 <= now &&
    now - start <= VOICE_CHANNEL_LATE_HOURS * 3_600_000
  );
}

/** Ce que l'on sait du salon d'une équipe (`bg_match_voice_channels`). */
export type VoiceChannelState = {
  /** Identifiant Discord du salon ; `null` : pas encore créé. */
  channelId: string | null;
  /** Le dernier appel au bot pour ce salon a échoué (injoignable, permission). */
  failed: boolean;
};

/** Ce qu'il faut savoir d'un match pour lui ouvrir des salons. */
export type VoiceMatchInput = {
  /** Option du tournoi allumée. */
  enabled: boolean;
  /** Heure du match ; `null` : aucun salon (match non programmé). */
  startAt: string | null;
  team1: { isSolo: boolean; isGhost: boolean };
  team2: { isSolo: boolean; isGhost: boolean };
};

/**
 * Le match a-t-il des salons ? Option allumée, match programmé, deux équipes
 * réelles. Une entrée solo ou une fantôme d'un côté : aucun salon, ni pour
 * l'une ni pour l'autre.
 */
export function voiceTracked(input: VoiceMatchInput): boolean {
  return input.enabled && input.startAt !== null && voiceEligibleTeam(input.team1) && voiceEligibleTeam(input.team2);
}

/**
 * État du salon d'une équipe tel que la page le dit :
 * - `WAITING` : pas encore créé (le balayage l'ouvre à T−15) ;
 * - `OPEN` : créé, joignable sur Discord ;
 * - `FAILED` : le bot a refusé ou n'a pas répondu (redemandé une minute plus tard).
 */
export type MatchVoiceSideState = "WAITING" | "OPEN" | "FAILED";

/**
 * Ce que l'instantané dit des salons d'un match (`TournamentMatch.voice`) :
 * l'état du salon de chaque côté. Aucun nombre de présents ni personne : rien
 * de personnel n'y figure.
 */
export type MatchVoiceInfo = {
  team1State: MatchVoiceSideState;
  team2State: MatchVoiceSideState;
};

/** Ce que la page montre d'un salon : son état seul. */
export function shownVoiceSide(channel: VoiceChannelState | null): MatchVoiceSideState {
  if (channel?.failed) return "FAILED";
  if (!channel?.channelId) return "WAITING";
  return "OPEN";
}

/** Rendu de l'instantané pour un match suivi, `null` sinon. */
export function matchVoiceInfo(
  input: VoiceMatchInput,
  team1Channel: VoiceChannelState | null,
  team2Channel: VoiceChannelState | null,
): MatchVoiceInfo | null {
  if (!voiceTracked(input)) return null;
  return { team1State: shownVoiceSide(team1Channel), team2State: shownVoiceSide(team2Channel) };
}

const SIDE_STATES: readonly MatchVoiceSideState[] = ["WAITING", "OPEN", "FAILED"];

/**
 * Lecture tolérante de `TournamentMatch.voice` (données d'un flux ou d'un
 * cache). Une ancienne charge (« COUNTED », « UNCOUNTED », nombres, `pending`)
 * se lit comme un salon ouvert ; ses nombres et son verrou ne sont jamais repris.
 */
export function parseMatchVoiceInfo(value: unknown): MatchVoiceInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const state = (entry: unknown): MatchVoiceSideState => {
    if (entry === "COUNTED" || entry === "UNCOUNTED") return "OPEN";
    return SIDE_STATES.find((candidate) => candidate === entry) ?? "WAITING";
  };
  return { team1State: state(raw.team1State), team2State: state(raw.team2State) };
}

/* ── Lien du salon de son équipe ─────────────────────────────────────────── */

/**
 * Lien du salon vocal d'**une** équipe sur un match, pour ses seuls membres
 * (`TournamentViewerContext.voiceLinks`) : jamais dans l'instantané diffusé,
 * jamais le salon de l'adversaire.
 */
export type MatchVoiceLink = { matchId: number; url: string };

/** Identifiant Discord (serveur ou salon) tel que le bot le rend : chiffres seulement. */
const DISCORD_ID = /^\d{5,32}$/;

/** Lien Discord d'un salon, `null` si un identifiant n'en est pas un. */
export function voiceChannelUrl(guildId: string | null, channelId: string | null): string | null {
  if (guildId === null || channelId === null || !DISCORD_ID.test(guildId) || !DISCORD_ID.test(channelId)) return null;
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

/** Ce qu'il faut d'un match pour savoir si le salon de l'équipe du lecteur est ouvert. */
type VoiceLinkedMatch = {
  id: number;
  team1Id: number | null;
  team2Id: number | null;
  voice?: MatchVoiceInfo | null;
};

/** Le salon de `teamId` est-il ouvert sur ce match (instantané) ? */
export function ownVoiceOpen(match: VoiceLinkedMatch, teamId: number | null): boolean {
  if (teamId === null || !match.voice) return false;
  if (match.team1Id === teamId) return match.voice.team1State === "OPEN";
  if (match.team2Id === teamId) return match.voice.team2State === "OPEN";
  return false;
}

/** Lien du salon de l'équipe du lecteur sur ce match, `null` s'il n'y en a pas (ou plus). */
export function ownVoiceLink(
  match: VoiceLinkedMatch,
  teamId: number | null,
  links: readonly MatchVoiceLink[],
): string | null {
  if (!ownVoiceOpen(match, teamId)) return null;
  return links.find((link) => link.matchId === match.id)?.url ?? null;
}

/**
 * Matchs dont le salon de l'équipe du lecteur est ouvert sans lien connu, en
 * une clé stable (`""` : rien ne manque). Une nouvelle clé déclenche **une**
 * relecture légère ; la même ne la relance pas (salon d'avant le lien, sans
 * serveur connu).
 */
export function missingVoiceLinksKey(
  matches: readonly VoiceLinkedMatch[],
  teamId: number | null,
  links: readonly MatchVoiceLink[],
): string {
  if (teamId === null) return "";
  return matches
    .filter((match) => ownVoiceOpen(match, teamId) && !links.some((link) => link.matchId === match.id))
    .map((match) => match.id)
    .join(",");
}

/** Liens reçus d'une réponse (forme contrôlée), `null` si ce n'en est pas une liste. */
export function parseVoiceLinks(value: unknown): MatchVoiceLink[] | null {
  if (!Array.isArray(value)) return null;
  const links: MatchVoiceLink[] = [];
  for (const item of value as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const { matchId, url } = item as Record<string, unknown>;
    if (typeof matchId !== "number" || typeof url !== "string" || !url.startsWith("https://discord.com/channels/")) continue;
    links.push({ matchId, url });
  }
  return links;
}
