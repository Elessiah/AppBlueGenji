import {RowDataPacket} from "mysql2/promise";

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