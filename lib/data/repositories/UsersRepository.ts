// user.service.ts
import type {Connection, ResultSetHeader} from "mysql2/promise";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import {User, UserRow} from "../../types";

/**
 * Objet Service pour la table User
 */
export class UsersRepository {
    /**
     * Constructeur pour récupérer la connexion à la base de donnée
     * @param db Connexion à la base de donnée
     */
    constructor(private readonly db: Connection) {}

    /**
     * Transforme l'objet brut retourné par SQL en objet User
     * @param row Objet brut retourné par SQL
     * @private
     */
    private static normalizeUser(row: UserRow): User {
        return {
            id_user: row.id_user,
            username: row.username,
            is_admin: Boolean(row.is_admin),
            created_at: new Date(row.created_at),
        };
    }

    /**
     * Génère un nouveau token aléatoire sur 48 caractères
     * @private
     */
    private static newToken(): string {
        return crypto.randomBytes(48).toString("hex"); // 96 chars
    }

    /**
     * Créé un nouveau utilisateur
     * @param username Nom d'utilisateur
     * @param password Mot de passe
     * @param isAdmin s'il est admin ou pas. Défaut à false
     */
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

    /**
     * Authentifie un utilisateur avec son nom d'utilisateur et son mot de passe
     * @param username Nom d'utilisateur
     * @param password Mot de passe
     */
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

        const token: string = UsersRepository.newToken();

        await this.db.execute<ResultSetHeader>(
            `UPDATE users SET token = ? WHERE id_user = ?`,
            [token, rows[0].id_user]
        );

        return { user: UsersRepository.normalizeUser(rows[0]), token };
    }

    /**
     * Récupère un utilisateur par son ID
     * @param id_user ID de l'utilisateur à récupérer
     */
    async getById(id_user: number): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT id_user, username, hash, token, is_admin, created_at
       FROM users
       WHERE id_user = ?
       LIMIT 1`,
            [id_user]
        );

        if (rows.length === 0) return null;
        return UsersRepository.normalizeUser(rows[0]);
    }

    /**
     * Récupère l'utilisateur par son nom d'utilisateur
     * @param username
     */
    async getByUsername(username: string): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT id_user, username, hash, token, is_admin, created_at
       FROM users
       WHERE username = ?
       LIMIT 1`,
            [username]
        );

        if (rows.length === 0) return null;
        return UsersRepository.normalizeUser(rows[0]);
    }

    /**
     * Récupère un utilisateur par son token
     * @param token
     */
    async getByToken(token: string): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT id_user, username, hash, token, is_admin, created_at
       FROM users
       WHERE token = ?
       LIMIT 1`,
            [token]
        );

        if (rows.length === 0) return null;
        return UsersRepository.normalizeUser(rows[0]);
    }

    /**
     * Change le token d'un utilisateur
     * @param id_user ID de l'utilisateur à mettre à jour
     */
    async rotateToken(id_user: number): Promise<string> {
        const token: string = UsersRepository.newToken();
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET token = ? WHERE id_user = ?`,
            [token, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
        return token;
    }

    /**
     * Supprime le token d'un utilisateur
     * @param id_user ID de l'utilisateur à mettre à jour
     */
    async revokeToken(id_user: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET token = NULL WHERE id_user = ?`,
            [id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    /**
     * Modifie le mot de passe d'un utilisateur
     * @param id_user ID de l'utilisateur à mettre à jour
     * @param newPassword Nouveau mot de passe à appliquer
     */
    async changePassword(id_user: number, newPassword: string): Promise<void> {
        const password_hash: string = await bcrypt.hash(newPassword, 12);
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET hash = ? WHERE id_user = ?`,
            [password_hash, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    /**
     * Change le status admin d'un utilisateur
     * @param id_user ID de l'utilisateur à mettre à jour
     * @param is_admin Status admin à appliquer
     */
    async setAdmin(id_user: number, is_admin: boolean): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET is_admin = ? WHERE id_user = ?`,
            [is_admin, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    /**
     * Supprime un utilisateur
     * @param id_user ID de l'utilisateur à supprimer
     */
    async deleteUser(id_user: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `DELETE FROM users WHERE id_user = ?`,
            [id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }
}
