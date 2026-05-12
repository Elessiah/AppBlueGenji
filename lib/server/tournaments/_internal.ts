import type { RowDataPacket } from "mysql2/promise";
import { toIso } from "@/lib/server/serialization";
import type { BracketMatch, TournamentCard } from "@/lib/shared/types";

export type TournamentRow = RowDataPacket & {
  id: number;
  name: string;
  description: string | null;
  format: "SINGLE" | "DOUBLE";
  game: "OW2" | "MR";
  max_teams: number;
  state: "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";
  start_visibility_at: Date;
  registration_open_at: Date;
  registration_close_at: Date;
  start_at: Date;
  bracket_size: number | null;
  created_at: Date;
  organizer_user_id: number;
  finished_at: Date | null;
  has_third_place_match: number;
};

export type RegistrationRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  logo_url: string | null;
  seed: number | null;
  final_rank: number | null;
  registered_at: Date;
};

export type MatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  bracket: "UPPER" | "LOWER" | "GRAND" | "THIRD_PLACE";
  round_number: number;
  match_number: number;
  status: "PENDING" | "READY" | "AWAITING_CONFIRMATION" | "COMPLETED";
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_placeholder: string | null;
  team2_placeholder: string | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  loser_team_id: number | null;
  forfeit_team_id: number | null;
  next_winner_match_id: number | null;
  next_winner_slot: number | null;
  next_loser_match_id: number | null;
  next_loser_slot: number | null;
  team1_report_score: number | null;
  team1_report_opponent_score: number | null;
  team1_reported_at: Date | null;
  team2_report_score: number | null;
  team2_report_opponent_score: number | null;
  team2_reported_at: Date | null;
  score_deadline_at: Date | null;
  updated_at: Date;
};

export type TournamentListRow = TournamentRow & {
  registered_teams: number;
};

export function statusFromTeams(
  team1Id: number | null,
  team2Id: number | null,
): "PENDING" | "READY" {
  return team1Id !== null && team2Id !== null ? "READY" : "PENDING";
}

export function mapCard(row: TournamentListRow): TournamentCard {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    format: row.format,
    game: row.game,
    maxTeams: Number(row.max_teams),
    registeredTeams: Number(row.registered_teams),
    state: row.state,
    startVisibilityAt: row.start_visibility_at.toISOString(),
    registrationOpenAt: row.registration_open_at.toISOString(),
    registrationCloseAt: row.registration_close_at.toISOString(),
    startAt: row.start_at.toISOString(),
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
  };
}

export function mapMatch(row: MatchRow): BracketMatch {
  return {
    id: Number(row.id),
    tournamentId: Number(row.tournament_id),
    bracket: row.bracket,
    roundNumber: Number(row.round_number),
    matchNumber: Number(row.match_number),
    status: row.status,
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
    team1Name: row.team1_name,
    team2Name: row.team2_name,
    team1Placeholder: row.team1_placeholder ?? null,
    team2Placeholder: row.team2_placeholder ?? null,
    team1Score: row.team1_score === null ? null : Number(row.team1_score),
    team2Score: row.team2_score === null ? null : Number(row.team2_score),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
    forfeitTeamId: row.forfeit_team_id === null ? null : Number(row.forfeit_team_id),
    nextWinnerMatchId: row.next_winner_match_id === null ? null : Number(row.next_winner_match_id),
    nextWinnerSlot: row.next_winner_slot === null ? null : Number(row.next_winner_slot),
    nextLoserMatchId: row.next_loser_match_id === null ? null : Number(row.next_loser_match_id),
    nextLoserSlot: row.next_loser_slot === null ? null : Number(row.next_loser_slot),
    scoreDeadlineAt: toIso(row.score_deadline_at),
    updatedAt: row.updated_at.toISOString(),
  };
}
