// repositories/UsersRepository.ts
import type { Connection, ResultSetHeader } from "mysql2/promise";
import {PublicUser, PublicUserRow, User, UserRow} from "../../types";

/**
 * Classe d'accès des données utilisateur
 */
export class UsersRepository {
    /**
     * Constructeur
     * @param db Connection à la base de donnée
     */
    constructor(private readonly db: Connection) {}

    /**
     * Transforme un objet SQL utilisateur complet en objet métier
     * @param row utilisateur SQL à transformer
     * @private
     */
    private static normalizeUser(row: UserRow): User {
        return {
            id_user: row.id_user,
            username: row.username,
            password_hash: row.password_hash,
            token: row.token ?? "",
            is_admin: Boolean(row.is_admin),
            created_at: new Date(row.created_at),
        };
    }

    /**
     * Transforme un objet SQL utilisateur public en objet métier
     * @param row utilisateur public SQL à transformer
     * @private
     */
    private static normalizePublicUser(row: PublicUserRow): PublicUser {
        return {
            username: row.username,
            is_admin: Boolean(row.is_admin),
            created_at: new Date(row.created_at),
        }
    }

    /**
     * Créer un nouvelle utilisateur dans la base de données
     * @param username Nom d'utilisateur du nouvel utilisateur
     * @param passwordHash Hash du mot de passe du nouvel utilisateur
     * @param isAdmin status admin de l'utilisateur
     */
    async create(username: string, passwordHash: string, isAdmin = false): Promise<User> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `INSERT INTO users (username, hash, is_admin)
             VALUES (?, ?, ?)`,
            [username, passwordHash, isAdmin]
        );

        const created: User | null = await this.getById(res.insertId);
        if (!created) throw new Error("USER_CREATE_FAILED");
        return created;
    }

    /**
     * Récupère un utilisateur
     * @param id_user id de l'utilisateur
     */
    async getById(id_user: number): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT
                 id_user,
                 username,
                 hash AS password_hash,
                 token,
                 is_admin,
                 created_at
             FROM users
             WHERE id_user = ?
             LIMIT 1`,
            [id_user]
        );

        if (rows.length === 0) return null;
        return UsersRepository.normalizeUser(rows[0]);
    }


    /**
     * Récupère un utilisateur public
     * @param id id de l'utilisateur à récupèrer
     */
    async getPublicById(id: number): Promise<PublicUser | null> {
        const [rows] = await this.db.execute<PublicUserRow[]>(`SELECT username, created_at FROM users WHERE id_user = ? LIMIT 1`, [id]);

        if (rows.length === 0) return null;
        return UsersRepository.normalizePublicUser(rows[0]);
    }

    /**
     * Récupère un utilisateur
     * @param username de l'utilisateur
     */
    async getByUsername(username: string): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT
                 id_user,
                 username,
                 hash AS password_hash,
                 token,
                 is_admin,
                 created_at
             FROM users
             WHERE username = ?
             LIMIT 1`,
            [username]
        );

        if (rows.length === 0) return null;
        return UsersRepository.normalizeUser(rows[0]);
    }

    /**
     * Récupère un utilisateur
     * @param token token de l'utilisateur
     */
    async getByToken(token: string): Promise<User | null> {
        const [rows] = await this.db.execute<UserRow[]>(
            `SELECT
                 id_user,
                 username,
                 hash AS password_hash,
                 token,
                 is_admin,
                 created_at
             FROM users
             WHERE token = ?
             LIMIT 1`,
            [token]
        );

        if (rows.length === 0) return null;
        return UsersRepository.normalizeUser(rows[0]);
    }

    /**
     * Défini le token d'un utilisateur
     * @param id_user id de l'utilisateur
     * @param token token à appliquer
     */
    async setToken(id_user: number, token: string | null): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET token = ? WHERE id_user = ?`,
            [token, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    /**
     * Révoque le token d'un utilisateur
     * @param id_user id de l'utilisateur à modifier
     */
    async revokeToken(id_user: number): Promise<void> {
        await this.setToken(id_user, null);
    }

    /**
     * Défini un nouveau hash de mot de passe à un utilisateur
     * @param id_user id de l'utilisateur
     * @param passwordHash nouveau hash à appliquer
     */
    async setPasswordHash(id_user: number, passwordHash: string): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET hash = ? WHERE id_user = ?`,
            [passwordHash, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    /**
     * Défini un nouveau status admin
     * @param id_user id de l'utilisateur
     * @param is_admin nouveau status à appliquer
     */
    async setAdmin(id_user: number, is_admin: boolean): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET is_admin = ? WHERE id_user = ?`,
            [is_admin, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    /**
     * Défini un nouveau nom à un utilisateur
     * @param id_user id de l'utilisateur à modifier
     * @param username Nouveau nom à appliquer
     */
    async setUsername(id_user: number, username: string): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `UPDATE users SET username = ? WHERE id_user = ?`,
            [username, id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }

    /**
     * Supprime un utilisateur
     * @param id_user id de l'utilisateur à supprimer
     */
    async delete(id_user: number): Promise<void> {
        const [res] = await this.db.execute<ResultSetHeader>(
            `DELETE FROM users WHERE id_user = ?`,
            [id_user]
        );
        if (res.affectedRows !== 1) throw new Error("USER_NOT_FOUND");
    }
}
