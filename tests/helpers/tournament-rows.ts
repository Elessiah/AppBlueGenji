import type {
  MatchRow,
  PhaseRow,
  RegistrationRow,
  TournamentListRow,
  TournamentRow,
} from "@/lib/server/tournaments/_internal";
import type { RowOverrides } from "./row-overrides";

/**
 * Les colonnes d'une ligne mysql2, **toutes requises** : `RowDataPacket` porte
 * des signatures d'index (`[column: string]: any`) qui font accepter n'importe
 * quel objet partiel. Elles sont retirées, avec le `constructor` littéral, pour
 * que l'oubli d'une colonne se voie à la compilation.
 */
type RowColumns<T> = {
  [K in keyof T as K extends "constructor"
    ? never
    : string extends K
      ? never
      : number extends K
        ? never
        : K]: T[K];
};

/**
 * Une ligne `bg_tournaments` **complète**, surchargée colonne par colonne.
 *
 * Le moteur la reçoit de `loadTournamentRow` ; les tests la simulaient par un
 * `Record<string, unknown>` passé en `as never`, si bien qu'une colonne ajoutée
 * au type n'était reportée dans aucun. Une fabrique locale garde ses valeurs
 * propres et délègue le reste ici — même principe que `tournamentCard()`.
 */
export function tournamentRow(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  const columns: RowColumns<TournamentRow> = {
    id: 1,
    name: "Tournoi",
    description: null,
    format: "SINGLE",
    game: "OW",
    max_teams: 8,
    state: "UPCOMING",
    start_visibility_at: new Date("2026-05-01T10:00:00.000Z"),
    registration_open_at: new Date("2026-05-02T10:00:00.000Z"),
    registration_close_at: new Date("2026-05-10T10:00:00.000Z"),
    start_at: new Date("2026-05-12T10:00:00.000Z"),
    bracket_size: null,
    created_at: new Date("2026-04-01T10:00:00.000Z"),
    organizer_user_id: 1,
    finished_at: null,
    has_third_place_match: 0,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    survival_current_round: 0,
    current_phase_id: null,
    manual_seeding: 0,
    participant_type: "TEAM",
    match_format_type: null,
    match_format_value: null,
    match_format_max_maps: null,
    match_format_draws: 0,
    endurance_playoff_format_type: null,
    endurance_playoff_format_value: null,
    // Défauts des colonnes (`DEFAULT_REGISTRATION_FILTERS`), comme un tournoi
    // créé sans toucher aux conditions.
    registration_discord_requirement: "ANY_PLAYER",
    registration_blizzard_requirement: "NONE",
    registration_min_players: 5,
    live_url: null,
  };
  return { ...columns, ...overrides } as TournamentRow;
}

/** La même, telle que la lit la liste (`registered_teams` en plus). */
export function tournamentListRow(
  overrides: RowOverrides<TournamentListRow> = {},
): TournamentListRow {
  return { ...tournamentRow(overrides), registered_teams: overrides.registered_teams ?? 0 };
}

/** Une ligne `bg_matches` **complète** : match prêt entre les engagés 1 et 2. */
export function matchRow(overrides: RowOverrides<MatchRow> = {}): MatchRow {
  const columns: RowColumns<MatchRow> = {
    id: 1,
    tournament_id: 1,
    bracket: "UPPER",
    round_number: 1,
    match_number: 1,
    status: "READY",
    team1_id: 1,
    team2_id: 2,
    team1_name: "A",
    team2_name: "B",
    team1_placeholder: null,
    team2_placeholder: null,
    team1_score: null,
    team2_score: null,
    winner_team_id: null,
    loser_team_id: null,
    forfeit_team_id: null,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    team1_report_score: null,
    team1_report_opponent_score: null,
    team1_reported_at: null,
    team2_report_score: null,
    team2_report_opponent_score: null,
    team2_reported_at: null,
    score_deadline_at: null,
    updated_at: new Date("2026-05-20T10:00:00.000Z"),
    phase_id: 0,
    phase_position: null,
    start_at: null,
    live_trigger: null,
    live_url: null,
    live_started_at: null,
  };
  return { ...columns, ...overrides } as MatchRow;
}

/** Une ligne `bg_tournament_phases` **complète** : première phase, à venir. */
export function phaseRow(overrides: RowOverrides<PhaseRow> = {}): PhaseRow {
  const columns: RowColumns<PhaseRow> = {
    id: 1,
    tournament_id: 1,
    position: 1,
    name: null,
    format: "SWISS",
    qualifier_mode: "COUNT",
    qualifier_value: 4,
    has_third_place_match: 0,
    swiss_total_rounds: null,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    survival_current_round: 0,
    survival_barrage_rounds: 0,
    state: "PENDING",
    entrants: null,
    qualifiers: null,
    max_rounds: null,
    bracket_size: null,
    started_at: null,
    finished_at: null,
    created_at: new Date("2026-04-01T10:00:00.000Z"),
  };
  return { ...columns, ...overrides } as PhaseRow;
}

/** Une ligne d'inscription **complète**, telle que la lit le moteur. */
export function registrationRow(overrides: RowOverrides<RegistrationRow> = {}): RegistrationRow {
  const columns: RowColumns<RegistrationRow> = {
    team_id: 1,
    team_name: "Équipe",
    logo_url: null,
    seed: null,
    final_rank: null,
    registered_at: new Date("2026-05-05T10:00:00.000Z"),
  };
  return { ...columns, ...overrides } as RegistrationRow;
}
