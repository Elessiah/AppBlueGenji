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