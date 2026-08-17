import type { RowDataPacket } from "mysql2/promise";
import { toIso } from "@/lib/server/serialization";
import type { BracketMatch, TournamentCard, TournamentPhase } from "@/lib/shared/types";

export type TournamentRow = RowDataPacket & {
  id: number;
  name: string;
  description: string | null;
  format: "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL" | "MULTI";
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
  survival_rounds_before_first_cut: number | null;
  survival_rounds_per_cut: number | null;
  survival_current_round: number;
  current_phase_id: number | null;
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
  phase_id: number;
  phase_position: number | null;
};

export type TournamentListRow = TournamentRow & {
  registered_teams: number;
};

export type PhaseRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  position: number;
  name: string | null;
  format: "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL";
  qualifier_mode: "COUNT" | "PERCENT";
  qualifier_value: number;
  has_third_place_match: number;
  swiss_total_rounds: number | null;
  survival_rounds_before_first_cut: number | null;
  survival_rounds_per_cut: number | null;
  survival_current_round: number;
  survival_barrage_rounds: number;
  state: "PENDING" | "RUNNING" | "FINISHED" | "SKIPPED";
  entrants: number | null;
  qualifiers: number | null;
  max_rounds: number | null;
  bracket_size: number | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
};

export function mapPhase(row: PhaseRow): TournamentPhase {
  return {
    id: Number(row.id),
    position: Number(row.position),
    name: row.name,
    format: row.format,
    qualifierMode: row.qualifier_mode,
    qualifierValue: Number(row.qualifier_value),
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
    swissTotalRounds: row.swiss_total_rounds === null ? null : Number(row.swiss_total_rounds),
    survivalRoundsBeforeFirstCut:
      row.survival_rounds_before_first_cut === null ? null : Number(row.survival_rounds_before_first_cut),
    survivalRoundsPerCut:
      row.survival_rounds_per_cut === null ? null : Number(row.survival_rounds_per_cut),
    state: row.state,
    entrants: row.entrants === null ? null : Number(row.entrants),
    qualifiers: row.qualifiers === null ? null : Number(row.qualifiers),
    maxRounds: row.max_rounds === null ? null : Number(row.max_rounds),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  };
}

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
    startVisibilityAt: toIso(row.start_visibility_at)!,
    registrationOpenAt: toIso(row.registration_open_at)!,
    registrationCloseAt: toIso(row.registration_close_at)!,
    startAt: toIso(row.start_at)!,
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
    survivalRoundsBeforeFirstCut:
      row.survival_rounds_before_first_cut === null
        ? null
        : Number(row.survival_rounds_before_first_cut),
    survivalRoundsPerCut:
      row.survival_rounds_per_cut === null ? null : Number(row.survival_rounds_per_cut),
    phases: null,
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
    updatedAt: toIso(row.updated_at)!,
    phaseId: Number(row.phase_id ?? 0),
    phasePosition: row.phase_position == null ? null : Number(row.phase_position),
  };
}
