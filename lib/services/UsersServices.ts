// user.service.ts
import type { Pool, ResultSetHeader } from "mysql2/promise";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import {User, UserRow} from "../types";


export class UserService {
    constructor(private readonly db: Pool) {}

    private static normalizeUser(row: UserRow): User {
        return {
            id_user: row.id_user,
            username: row.username,
            is_admin: Boolean(row.is_admin),
            created_at: new Date(row.created_at),
        };
    }

    private static newToken(): string {
        return crypto.randomBytes(48).toString("hex"); // 96 chars
    }

    async createUser(username: string, password: string, isAdmin = false): Promise<User> {
        const password_hash = await bcrypt.hash(password, 12);

        const [res] = await this.db.execute<ResultSetHeader>(
            `INSERT INTO users (username, hash, is_admin)
       VALUES (?, ?, ?)`,
            [username, password_hash, isAdmin]
        );

        const user: User | null = await this.getById(res.insertId);
        if (!user) throw new Error("USER_CREATE_FAILED");
        return user;
    }

    async authenticate(username: string, password: string): Promise<{ user: User; token: string } | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT id_user, username, hash, token, is_admin, created_at
       FROM users
       WHERE username = ?
       LIMIT 1`,
            [username]
        );

        if (rows.length === 0) return null;

        const status: boolean = await bcrypt.compare(password, rows[0].password_hash);
        if (!status) return null;

        const token: string = UserService.newToken();

        await this.db.execute<ResultSetHeader>(
            `UPDATE users SET token = ? WHERE id_user = ?`,
            [token, rows[0].id_user]
        );

        return { user: UserService.normalizeUser(rows[0]), token };
    }

    async getById(id_user: number): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT id_user, username, hash, token, is_admin, created_at
       FROM users
       WHERE id_user = ?
       LIMIT 1`,
            [id_user]
        );

        if (rows.length === 0) return null;
        return UserService.normalizeUser(rows[0]);
    }

    async getByUsername(username: string): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT id_user, username, hash, token, is_admin, created_at
       FROM users
       WHERE username = ?
       LIMIT 1`,
            [username]
        );

        if (rows.length === 0) return null;
        return UserService.normalizeUser(rows[0]);
    }

    async getByToken(token: string): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT id_user, username, hash, token, is_admin, created_at
       FROM users
       WHERE token = ?
       LIMIT 1`,
            [token]
        );

        if (rows.length === 0) return null;
        return UserService.normalizeUser(rows[0]);
    }

    async rotateToken(id_user: number): Promise<string> {
        const token: string = UserService.newToken();
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET token = ? WHERE id_user = ?`,
            [token, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
        return token;
    }

    async revokeToken(id_user: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET token = NULL WHERE id_user = ?`,
            [id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    async changePassword(id_user: number, newPassword: string): Promise<void> {
        const password_hash: string = await bcrypt.hash(newPassword, 12);
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET hash = ? WHERE id_user = ?`,
            [password_hash, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    async setAdmin(id_user: number, is_admin: boolean): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET is_admin = ? WHERE id_user = ?`,
            [is_admin, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    async deleteUser(id_user: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `DELETE FROM users WHERE id_user = ?`,
            [id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }
}
