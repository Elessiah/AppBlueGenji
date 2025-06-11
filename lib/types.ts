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
    members: User[];
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
    matchs: TournamentMatch[];
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
    user_id: number;
    username: string;
    id_team: number;
    is_admin: boolean;
}

export interface UserHistory {
    user_history_id: number;
    id_user: number;
    id_team_tournament: number;
}

export interface Team {
    team_id: number;
    name: string;
    creation_date: string;
    id_owner: number;
}

export interface TeamTournament {
    team_tournament_id: number;
    id_tournament: number;
    id_team: number;
    position: number;
}

export interface Tournament {
    tournament_id: number;
    name: string;
    description: string;
    format: 'SIMPLE' | 'DOUBLE';
    size: number;
    id_owner: number;
    creation_date: Date;
    start_visibility: Date;
    open_registration: Date;
    close_registration: Date;
    start: Date;
}

export interface TournamentMatch {
    tournament_match_id: number;
    id_tournament: number;
    id_team_tournament_host: number;
    id_team_tournament_guest: number;
    score_host: number;
    score_guest: number;
    victory: 'host' | 'guest' | null;
}

export interface id {
    id: number;
}