import {type Pool, RowDataPacket} from "mysql2/promise";

export interface User {
    id_user: number;
    username: string;
    is_admin: boolean;
    created_at: Date;
}

export type UserRow = RowDataPacket & {
    id_user: number;
    username: string;
    password_hash: string;
    token: string | null;
    is_admin: 0 | 1;
    created_at: Date;
};

export type Team = {
    id_team: number;
    name: string;
    created_at: Date;
};

export type TeamRow = RowDataPacket & {
    id_team: number;
    name: string;
    created_at: Date;
};

export type TeamMemberRole = "MEMBER" | "OWNER";

export type Membership = {
        id_membership: number;
        id_user: number;
        id_team: number;
        joined_at: Date;
        left_at: Date | null;
        role: TeamMemberRole;
    }
export type MembershipRow = RowDataPacket & Membership;

export type MatchBracket = "UPPER" | "LOWER";

export type Match = {
    id_match: number;
    id_tournament: number;
    start_at: Date | null;
    round: number;
    bracket: MatchBracket | null;
    match_index: number | null;
};

export type MatchRow = RowDataPacket & {
    id_match: number;
    id_tournament: number;
    start_at: Date | null;
    round: number;
    bracket: MatchBracket | null;
    match_index: number | null;
};

export type MatchParticipation = {
    id_participation: number;
    id_match: number;
    id_team: number;
    score: number;
    is_winner: boolean;
};

export type ParticipationRow = RowDataPacket & {
    id_participation: number;
    id_match: number;
    id_team: number;
    score: number;
    is_winner: 0 | 1;
};

export type TournamentFormat = "SIMPLE" | "DOUBLE";
export type TournamentStatus = "DRAFT" | "OPEN" | "RUNNING" | "DONE";

export type Tournament = {
    id_tournament: number;
    organizer_user_id: number;
    name: string;
    description: string | null;
    format: TournamentFormat;
    max_teams: number;
    created_at: Date;
    start_visibility_at: Date | null;
    open_registration_at: Date | null;
    close_registration_at: Date | null;
    start_at: Date | null;
    status: TournamentStatus;
    current_round: number | null;
};

export type TournamentRow = RowDataPacket & {
    id_tournament: number;
    organizer_user_id: number;
    name: string;
    description: string | null;
    format: TournamentFormat;
    max_teams: number;
    created_at: Date;
    start_visibility_at: Date | null;
    open_registration_at: Date | null;
    close_registration_at: Date | null;
    start_at: Date | null;
    status: TournamentStatus;
    current_round: number | null;
};

export type RegistrationRow = RowDataPacket & {
    id_registration: number;
    id_tournament: number;
    id_team: number;
    registered_at: Date;
    final_position: number | null;
    seed: number | null;
};