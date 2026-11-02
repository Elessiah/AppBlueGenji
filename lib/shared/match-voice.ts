/**
 * Salons vocaux d'équipe des matchs (`docs/features/MATCH_VOICE.md`) — règles
 * pures, partagées par le serveur (création, verrou du lancement) et par
 * l'interface (« Salon vocal : 3/5 »).
 *
 * Option du tournoi « Salons vocaux d'équipe » (`bg_tournaments.team_voice_channels`,
 * éteinte par défaut, modifiable à tout moment) : un quart d'heure avant
 * l'heure d'un match, le bot crée un salon vocal par équipe, limité à cinq
 * places ; le lancement attend que les deux soient pleins. Équipes seulement :
 * jamais pour une entrée solo (le nom du salon serait un pseudo) ni pour une
 * fantôme (personne ne la rejoindrait).
 */

/** Avance de la création des salons sur l'heure du match (minutes). */
export const VOICE_CHANNEL_LEAD_MINUTES = 15;

/** Places d'un salon (`userLimit` côté bot) : « plein » = ce nombre de personnes. */
export const VOICE_CHANNEL_CAPACITY = 5;

/**
 * Âge maximal d'une observation du bot (comptage ou panne) que le verrou croit
 * encore (minutes). Au-delà — match reporté hors du quart d'heure puis revenu,
 * file du balayage en retard — le dernier nombre ne dit plus rien de la salle :
 * le verrou attend un nouveau comptage plutôt que de lancer sur un « 5/5 » ou
 * de lever sur une panne d'hier.
 */
export const VOICE_OBSERVATION_FRESH_MINUTES = 5;

/** L'observation datée `at` (ISO) est-elle assez récente à l'instant `now` (ms) ? */
export function voiceObservationFresh(at: string | null, now: number): boolean {
  const time = isoTime(at);
  return time !== null && now - time <= VOICE_OBSERVATION_FRESH_MINUTES * 60_000;
}

/**
 * Durée de garde d'une ligne de `bg_match_voice_channels` une fois le salon
 * rendu au bot (jours) — déclarée au registre des traitements (T18).
 */
export const VOICE_ROW_RETENTION_DAYS = 7;

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

function isoTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/**
 * Les salons d'un match sont-ils dus à l'instant `now` (ms) ? Un match sans
 * heure n'en a pas ; un match à plus d'un quart d'heure attend ; un match plus
 * proche — ou dont l'heure est passée sans qu'il soit lancé (option allumée en
 * cours de route) — les reçoit aussitôt.
 */
export function voiceChannelsDue(startAt: string | null, now: number): boolean {
  const start = isoTime(startAt);
  return start !== null && start - VOICE_CHANNEL_LEAD_MINUTES * 60_000 <= now;
}

/** Ce que l'on sait du salon d'une équipe (`bg_match_voice_channels`). */
export type VoiceChannelState = {
  /** Identifiant Discord du salon ; `null` : pas encore créé. */
  channelId: string | null;
  /** Dernier nombre de personnes compté ; `null` : jamais compté. */
  members: number | null;
  /** Le dernier appel au bot pour ce salon a échoué (injoignable, permission). */
  failed: boolean;
};

/** Ce que le verrou du lancement doit savoir d'un match. */
export type VoiceGateInput = {
  /** Option du tournoi allumée. */
  enabled: boolean;
  /** Heure du match ; `null` : aucun salon (match non programmé). */
  startAt: string | null;
  team1: { isSolo: boolean; isGhost: boolean };
  team2: { isSolo: boolean; isGhost: boolean };
  /** Salon de chaque équipe de l'appariement courant ; `null` : aucune ligne. */
  team1Channel: VoiceChannelState | null;
  team2Channel: VoiceChannelState | null;
};

/** Le salon est-il plein au dernier comptage ? */
export function voiceChannelFull(channel: VoiceChannelState | null): boolean {
  return channel !== null && channel.channelId !== null && (channel.members ?? 0) >= VOICE_CHANNEL_CAPACITY;
}

/**
 * Le match a-t-il des salons à suivre ? Option allumée, match programmé, deux
 * équipes réelles. Une entrée solo ou une fantôme d'un côté : aucun salon, ni
 * pour l'une ni pour l'autre — un salon d'un seul côté ne verrouillerait rien
 * de juste.
 */
export function voiceTracked(input: Pick<VoiceGateInput, "enabled" | "startAt" | "team1" | "team2">): boolean {
  return input.enabled && input.startAt !== null && voiceEligibleTeam(input.team1) && voiceEligibleTeam(input.team2);
}

/**
 * Le verrou retient-il le lancement ? Vrai tant que les deux salons ne sont
 * pas pleins — y compris avant leur création, que le balayage fait au plus
 * tard à l'heure du match.
 *
 * **Levé** si le bot a échoué sur l'un des deux salons (injoignable,
 * permission refusée) : une panne du bot ne bloque jamais un tournoi. Le
 * lancement forcé par l'arbitrage ne passe pas par ici.
 */
export function voiceGatePending(input: VoiceGateInput): boolean {
  if (!voiceTracked(input)) return false;
  if (input.team1Channel?.failed || input.team2Channel?.failed) return false;
  return !(voiceChannelFull(input.team1Channel) && voiceChannelFull(input.team2Channel));
}

/**
 * Ce que l'instantané dit des salons d'un match (`TournamentMatch.voice`) :
 * le nombre de personnes de chaque côté (`null` : salon pas encore créé) et
 * l'état du verrou. Un nombre, jamais qui : rien de personnel n'y figure.
 */
export type MatchVoiceInfo = {
  team1Members: number | null;
  team2Members: number | null;
  /** Le lancement attend le remplissage des deux salons. */
  pending: boolean;
};

function shownMembers(channel: VoiceChannelState | null): number | null {
  if (!channel?.channelId) return null;
  return Math.max(0, Math.min(channel.members ?? 0, VOICE_CHANNEL_CAPACITY));
}

/** Rendu de l'instantané pour un match suivi, `null` sinon. */
export function matchVoiceInfo(input: VoiceGateInput): MatchVoiceInfo | null {
  if (!voiceTracked(input)) return null;
  return {
    team1Members: shownMembers(input.team1Channel),
    team2Members: shownMembers(input.team2Channel),
    pending: voiceGatePending(input),
  };
}

/** Lecture tolérante de `TournamentMatch.voice` (données d'un flux ou d'un cache). */
export function parseMatchVoiceInfo(value: unknown): MatchVoiceInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const members = (entry: unknown) =>
    typeof entry === "number" && Number.isInteger(entry) && entry >= 0 ? Math.min(entry, VOICE_CHANNEL_CAPACITY) : null;
  return {
    team1Members: members(raw.team1Members),
    team2Members: members(raw.team2Members),
    pending: raw.pending === true,
  };
}
