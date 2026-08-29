import type { MatchLiveState } from "@/lib/shared/live-streams";
import type { TournamentCard } from "@/lib/shared/types";

export type LandingStats = {
  players: number;
  teams: number;
  tournaments: number;
};

export type LandingLiveMatch = {
  id: number;
  team1Name: string | null;
  team2Name: string | null;
  team1Score: number | null;
  team2Score: number | null;
  bracket: string;
  roundLabel: string;
  /** État de diffusion du match, dérivé (`lib/shared/live-streams.ts`). */
  liveState: MatchLiveState;
  /** Chaîne diffusant ce match ; `null` = casté sans lien, ou non casté. */
  liveUrl: string | null;
};

/**
 * Cible du bouton « Regarder le live » de l'accueil.
 *
 * Résolue côté serveur et volontairement absente tant qu'aucun match n'est
 * réellement à l'antenne : un bouton qui mène vers une chaîne hors ligne est
 * pire que pas de bouton du tout.
 */
export type LandingLiveStream = {
  tournamentId: number;
  tournamentName: string;
  /** Chaîne officielle du tournoi, déjà normalisée. */
  url: string;
};

export type LandingLive = {
  tournament: TournamentCard;
  currentMatch: LandingLiveMatch | null;
  viewers: number;
  game: string;
  phase: string;
  /**
   * Cible du bouton « Regarder le live ». `null` tant qu'aucun match n'est à
   * l'antenne — le bouton disparaît alors plutôt que de mener nulle part.
   */
  stream: LandingLiveStream | null;
};

export type LandingLeaderboardRow = {
  rank: number;
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  points: number;
  trend: "up" | "down" | "flat";
  trendValue: number;
};

export type LandingCalendarEvent = {
  tournamentId: number;
  name: string;
  startAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  state: "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";
  maxTeams: number;
  registeredTeams: number;
};

export type LandingTickerPayload = {
  items: string[];
};

export function inferGameLabel(value: string | null | undefined): "Overwatch" | "Marvel Rivals" {
  const text = (value ?? "").toLowerCase();
  if (text.includes("marvel") || text.includes("rivals")) {
    return "Marvel Rivals";
  }
  return "Overwatch";
}

export function inferGameCode(value: string | null | undefined): "ow2" | "mr" {
  return inferGameLabel(value) === "Marvel Rivals" ? "mr" : "ow2";
}

/** Abréviation du jeu, pour les pastilles trop étroites pour le libellé complet. */
export function inferGameShortLabel(value: string | null | undefined): "OW" | "MR" {
  return inferGameLabel(value) === "Marvel Rivals" ? "MR" : "OW";
}

export function inferPhaseLabel(match: LandingLiveMatch | null): string {
  if (!match) {
    return "EN ATTENTE";
  }

  const label = match.roundLabel.toUpperCase();
  if (label.includes("FINALE")) {
    return "PHASE FINALE";
  }
  if (label.includes("DEMI")) {
    return "PHASE FINALE";
  }
  if (label.includes("QUART")) {
    return "PHASE ÉLIMINATOIRE";
  }
  return label;
}

export function toBestOfLabel(match: LandingLiveMatch | null): "BO5" | "BO3" {
  if (!match) return "BO3";
  return match.roundLabel.toLowerCase().includes("final") ? "BO5" : "BO3";
}

