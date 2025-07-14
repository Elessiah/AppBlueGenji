import {id, status, User, token_payload, getHistories, History} from "../types";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import {Database} from "./database";
import crypto from "crypto";
import {TeamEntity} from "./TeamEntity";

export class UserEntity {
    public id: number | undefined;
    public name: string | undefined;
    public team: TeamEntity | null | undefined;
    public is_admin: boolean | undefined;
    public is_loaded: boolean = false;

    constructor(user : UserEntity | null = null) {
        if (user === null) {
            this.is_loaded = false;
        } else {
            if (!user.is_loaded) {
                this.is_loaded = false;
                return;
            }
            this.id = user.id;
            this.name = user.name;
            this.team = user.team == null ? null : new TeamEntity(user.team);
            this.is_admin = user.is_admin;
            this.is_loaded = true;
        }
    }

    public async fetch(user: number | string): Promise<status> {
        user = await UserEntity.isExist(user);
        if (user == -1)
            return ({success: false, error: "This user does not exist!"});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT * FROM user WHERE id_user = ?`, [user]);
        const user_data: User = (rows as User[])[0];
        this.id = user_data.id_user;
        this.name = user_data.username;
        this.is_admin = Boolean(user_data.is_admin);
        this.is_loaded = true;
        const checkStatus: status & {result: number} = await TeamEntity.isMemberOfTeam(this.id);
        if (!checkStatus.success)
            return ({success: false, error: checkStatus.error});
        if (checkStatus.result == -1) {
            this.team = null;
        } else {
            this.team = new TeamEntity();
            const status: status = await this.team.fetch(checkStatus.result);
            if (!status.success)
                return ({success: false, error: status.error});
        }
        return ({success: true, error: ""});
    }

    public compare(other: UserEntity): boolean {
        if (!this.is_loaded || !other.is_loaded)
            return false;
        return (this.id == other.id);
    }

    public async new(username: string,
                     password: string,
                     is_admin: boolean = false): Promise<status & id & {token: string}> {
        const database: Database = await Database.getInstance();
        const status = this.checkNameNorm(username);
        if (!status.success)
            return ({...status, id: -1, token: ""});
        if (await UserEntity.isExist(username) != -1) {
            return ({success: false, error: "Username already exist !", id: -1, token: ""});
        }
        if (password.length < 8 || password.length > 50)
            return ({
                success: false,
                error: "Password must be contain between 8 and 50 characters!",
                id: -1,
                token: ""
            });
        const hash: string = await bcrypt.hash(password, 10);
        const [result] = await database.db!.execute<mysql.ResultSetHeader>(`INSERT INTO user (username, hash, is_admin)
                                                                            VALUES (?, ?,
                                                                                    ?)`, [username, hash, is_admin]);
        const token: string = this.createToken(result.insertId);
        await database.db!.execute(`UPDATE user
                                   SET token = ?
                                   WHERE id_user = ?`, [token, result.insertId]);
        this.id = result.insertId;
        this.name = username;
        this.team = null;
        this.is_admin = is_admin;
        this.is_loaded = true;
        return ({success: true, error: "", id: result.insertId, token: token});
    }

    public async authToken(token: string): Promise<status & {token: string}> {
        if (!this.is_loaded)
            return ({success: false, error: "Empty object!", token: ""});
        const database : Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT token FROM user WHERE id_user = ?`, [this.id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This user does not exist!", token: ""});
        const bdd_token: string = ((rows as unknown[])[0] as {token: string}).token;
        if (bdd_token != token)
            return ({success: true, error: "", token: ""}); // Pas d'erreur de programme juste auth rejeté
        const new_token = this.createToken(this.id!);
        await database.db!.execute(`UPDATE user SET token = ? WHERE id_user = ?`, [new_token, this.id]);
        return ({success: true, error: "", token: new_token});
    }

    public async authPassword(password: string): Promise<status & {token: string}> {
        if (!this.is_loaded)
            return ({success: false, error: "Empty object!", token: ""});
        const database : Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT hash FROM user WHERE id_user = ?`, [this.id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This user does not exist!", token: ""});
        const db_hash = ((rows as unknown[])[0] as {hash: string}).hash;
        if (!(await bcrypt.compare(password, db_hash)))
            return ({success: true, error: "", token: ""});
        const token: string = this.createToken(this.id!);
        await database.db!.execute(`UPDATE user SET token = ? WHERE id_user = ?`, [token, this.id]);
        return ({success: true, error: "", token: token});
    }

    public async updatePassword(old_password: string,
                                new_password: string): Promise<status & {token: string}> {
        if (!this.is_loaded)
            return ({success: false,  error: "Empty object!", token: ""});
        if (old_password == new_password)
            return ({success: false, error: "The new password is the same as the last one!", token: ""});
        if (new_password.length < 8 || new_password.length > 50)
            return ({success: false, error: "Password must be contain between 8 and 50 characters!", token: ""});
        const status: status & {token: string} = await this.authPassword(old_password);
        if (!status.success)
            return (status);
        if (status.token.length == 0)
            return ({success: false, error: "Old password is wrong", token: ""});
        const hash: string = await bcrypt.hash(new_password, 10);
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE user SET hash = ? WHERE id_user = ?`, [hash, this.id]);
        return (status);
    }

    public async rename(new_username: string): Promise<status> {
        if (!this.is_loaded)
            return ({success: false, error: "Empty object!"});
        const user = await UserEntity.isExist(this.id!);
        if (user == -1)
            return ({success: false, error: "User does not exist!"});
        const status = this.checkNameNorm(new_username);
        if (!status.success)
            return status;
        if (await UserEntity.isExist(new_username) != -1)
            return ({success: false, error: "Username already exist or it's already your username!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE user
                               SET username = ?
                               WHERE id_user = ?`, [new_username, user]);
        this.name = new_username;
        return ({success: true, error: ""});
    }

    public async delete(): Promise<status> {
        if (!this.is_loaded)
            return ({success: false, error: "Empty object!"});
        const user = await UserEntity.isExist(this.id!);
        if (user == -1) {
            return ({success: false, error: "This user does not exist!"});
        }
        const team = new TeamEntity();
        const ownedTeam: status & { result: number } = await TeamEntity.isTeamOwner(this);
        if (!ownedTeam.success)
            return ({success: false, error: ownedTeam.error})
        if (ownedTeam.result != -1) {
            let status: status = await team.fetch(ownedTeam.result);
            if (!status.success)
                return ({success: false, error: status.error});
            status = await team.softDelete();
            if (!status.success)
                return ({success: false, error: status.error});
        }
        const database: Database = await Database.getInstance();
        await database.db!.execute(`DELETE
                                    FROM user
                                    WHERE id_user = ?`, [user]);
        this.is_loaded = false;
        return ({success: true, error: ""});
    }

    public async getHistory(): Promise<getHistories> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty object!", histories: []});
        if (await UserEntity.isExist(this.id) == -1)
            return ({success: false, error: "User not found!", histories: []});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT tournament.*, team_tournament.*, team.name as team_name
                                                   FROM team
                                                            LEFT JOIN team_tournament ON team_tournament.id_team = team.id_team
                                                            LEFT JOIN user_team ON user_team.id_team = team.id_team
                                                            LEFT JOIN tournament ON team_tournament.id_tournament = tournament.id_tournament
                                                   WHERE user_team.id_user = ?
                                                     AND user_team.date_join < tournament.start
                                                     AND (user_team.date_leave IS NULL OR
                                                          user_team.date_leave >= tournament.start)
                                                   ORDER BY tournament.start DESC`, [this.id]);
        return ({success: true, error: "", histories: rows as History[]});
    }

    // Static
    public static async isExist(user: string | number,
                                checkWithoutTeam: boolean = false): Promise<number> {
        const database: Database = await Database.getInstance();
        let users: { id_user: number }[];
        if (typeof user == typeof "string") {
            const [rows] = await database.db!.execute(`SELECT id_user
                                                       FROM user
                                                       WHERE username LIKE ?`, [user]);
            users = rows as { id_user: number }[];
        } else {
            const [rows] = await database.db!.execute(`SELECT id_user
                                                       FROM user
                                                       WHERE id_user = ?`, [user]);
            users = rows as { id_user: number }[];
        }
        if (users.length > 0) {
            if (checkWithoutTeam) {
                const checkStatus: status & { result: number } = await TeamEntity.isMemberOfTeam(users[0].id_user);
                if (!checkStatus.success || checkStatus.result != -1)
                    return (-1)
            }
            return (users[0].id_user);
        }
        return (-1);
    }

    // Private
    private checkNameNorm(name: string): status {
        if (name.length < 3 || name.length > 15) {
            return ({success: false, error: "The name must be at least 3 characters and maximum 15!"});
        }
        return ({success: true, error: ""});
    }

    private generateToken(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    private createToken(user_id: number): string {
        const token_payload: token_payload = {
            user_id: user_id,
            creation: Date.now(),
            token: this.generateToken(),
        };

        const token_base64 = Buffer.from(JSON.stringify(token_payload)).toString('base64url');
        return token_base64;
    }
}