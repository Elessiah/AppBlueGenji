export interface status {
    success: boolean;
    error: string;
}

export interface SQLEditParams {
    table: string;
    columns: string[];
    values: (string | number | bigint)[];
}

export interface SQLWhere {
    column: string;
    condition: string;
    value: string | bigint | number;
}

export interface SQLOrder {
    orderBy: string;
    isAscending: boolean;
}

export interface SQLQuery {
    success: boolean;
    error: string;
    query: string;
    values: (string | number | bigint)[];
}

export interface SQLGetParams {
    table: string;
    values: (string | number | bigint)[];
    joinOption: string[];
    whereOption: SQLWhere[];
    order: SQLOrder[];
    all: boolean;
}

export interface SQLGetResult {
    success: boolean;
    error: string;
    result: unknown[];
}

export interface getTeamMembers {
    members: UserInfo[];
    success:  boolean;
    error: string;
}

export interface getTournamentTeams {
    teams: (Team & TeamTournament)[];
    success: boolean;
    error: string;
}

export interface getTeams {
    teams: Team[];
    success: boolean;
    error: string;
}

export interface getTournaments {
    tournaments: Tournament[];
    success: boolean;
    error: string;
}

export interface getMatchs {
    matchs: Match[];
    success: boolean;
    error: string;
}

export type History = Tournament & TeamTournament & { team_name: string };

export interface getHistories {
    histories: History[];
    success: boolean;
    error: string;
}

export interface User {
    id_user: number;
    username: string;
    hash: string;
    token: string;
    id_team: number | null;
    is_admin: boolean;
}

export interface UserInfo {
    id_user: number;
    username: string;
    id_team: number | null;
    is_admin: boolean;
}

export interface UserTeam {
    id_user: number;
    id_team_tournament: number;
}

export interface Team {
    id_team: number;
    name: string;
    creation_date: Date;
    id_user: number;
}

export interface TeamInfo {
    id_team: number;
    name: string;
    creation_date: Date;
    username: string;
    id_user: number | null;
    members_count: number;
}

export interface TeamTournament {
    id_team_tournament: number;
    id_tournament: number;
    id_team: number;
    position: number;
}

export interface Tournament {
    id_tournament: number;
    name: string;
    description: string;
    format: 'SIMPLE' | 'DOUBLE';
    size: number;
    current_round: number;
    id_user: number;
    creation_date: Date;
    start_visibility: Date;
    open_registration: Date;
    close_registration: Date;
    start: Date;
}

export type TournamentTeamsCount = Tournament & {nb_teams: number};

export interface Match {
    id_match: number;
    id_tournament: number;
    victory: number | null;
    start_date: Date;
}

export interface TeamMatch {
    id_match: number;
    id_team: number;
    score: number;
}

export interface TeamAndMatch {
    id_match: number;
    id_tournament: number;
    id_victory_team: number;
    start_date: Date;
    id_team: number;
    score: number;
}

export interface MatchTeams {
    id_match: number;
    id_tournament: number;
    id_victory_team: number;
    start_date: Date;
    teams: {id_team: number, score: number}[];
}

export interface id {
    id: number;
}

export interface token_payload {
    user_id: number;
    creation: number;
    token: string;
}