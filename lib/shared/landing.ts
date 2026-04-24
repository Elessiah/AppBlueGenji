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
};

export type LandingLive = {
  tournament: TournamentCard;
  currentMatch: LandingLiveMatch | null;
  viewers: number;
  game: string;
  phase: string;
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

export function inferGameLabel(value: string | null | undefined): "Overwatch 2" | "Marvel Rivals" {
  const text = (value ?? "").toLowerCase();
  if (text.includes("marvel") || text.includes("rivals")) {
    return "Marvel Rivals";
  }
  return "Overwatch 2";
}

export function inferGameCode(value: string | null | undefined): "ow2" | "mr" {
  return inferGameLabel(value) === "Marvel Rivals" ? "mr" : "ow2";
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

