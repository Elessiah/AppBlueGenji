import {id, status, User, UserInfo, token_payload, getHistories, History} from "./types";
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
        user = await this.isExist(user);
        if (user == -1)
            return ({success: false, error: "This user does not exist!"});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT * FROM user WHERE user_id = ?`, [user]);
        const user_data: User = (rows as User[])[0];
        this.id = user_data.user_id;
        this.name = user_data.username;
        this.is_admin = user_data.is_admin;
        this.is_loaded = true;
        if (user_data.id_team == null) {
            this.team = null;
        } else {
            this.team = new TeamEntity();
            const status: status = await this.team.fetch(user_data.id_team);
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
        if (await this.isExist(username) != -1) {
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
                                   WHERE user_id = ?`, [token, result.insertId]);
        this.id = result.insertId;
        this.name = username;
        this.team = null;
        this.is_admin = true;
        this.is_loaded = true;
        return ({success: true, error: "", id: result.insertId, token: token});
    }

    public async authToken(token: string): Promise<status & {token: string}> {
        if (!this.is_loaded)
            return ({success: false, error: "Empty object!", token: ""});
        const database : Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT token FROM user WHERE user_id = ?`, [this.id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This user does not exist!", token: ""});
        const bdd_token: string = ((rows as unknown[])[0] as {token: string}).token;
        if (bdd_token != token)
            return ({success: true, error: "", token: ""}); // Pas d'erreur de programme juste auth rejeté
        const new_token = this.createToken(this.id!);
        await database.db!.execute(`UPDATE user SET token = ? WHERE user_id = ?`, [new_token, this.id]);
        return ({success: true, error: "", token: new_token});
    }

    public async authPassword(password: string): Promise<status & {token: string}> {
        if (!this.is_loaded)
            return ({success: false, error: "Empty object!", token: ""});
        const database : Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT hash FROM user WHERE user_id = ?`, [this.id]);
        if ((rows as unknown[]).length == 0)
            return ({success: false, error: "This user does not exist!", token: ""});
        const db_hash = ((rows as unknown[])[0] as {hash: string}).hash;
        if (!(await bcrypt.compare(password, db_hash)))
            return ({success: true, error: "", token: ""});
        const token: string = this.createToken(this.id!);
        await database.db!.execute(`UPDATE user SET token = ? WHERE user_id = ?`, [token, this.id]);
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
        await database.db!.execute(`UPDATE user SET hash = ? WHERE user_id = ?`, [hash, this.id]);
        return (status);
    }

    public async editUsername(new_username: string): Promise<status> {
        if (!this.is_loaded)
            return ({success: false, error: "Empty object!"});
        const user = await this.isExist(this.id!);
        if (user == -1)
            return ({success: false, error: "User does not exist!"});
        const status = this.checkNameNorm(new_username);
        if (!status.success)
            return status;
        if (await this.isExist(new_username) != -1)
            return ({success: false, error: "Username already exist or it's already your username!"});
        const database: Database = await Database.getInstance();
        await database.db!.execute(`UPDATE user
                               SET username = ?
                               WHERE user_id = ?`, [new_username, user]);
        this.name = new_username;
        return ({success: true, error: ""});
    }

    public async isExist(user: string | number,
                         checkWithoutTeam: boolean = false): Promise<number> {
        const database: Database = await Database.getInstance();
        let users: { user_id: number }[];
        let teamFilter: string = "";
        if (checkWithoutTeam)
            teamFilter = " AND id_team IS NULL";
        if (typeof user == typeof "string") {
            const [rows] = await database.db!.execute(`SELECT user_id
                                                       FROM user
                                                       WHERE username LIKE ? ${teamFilter}`, [user]);
            users = rows as { user_id: number }[];
        } else {
            const [rows] = await database.db!.execute(`SELECT user_id
                                                       FROM user
                                                       WHERE user_id = ? ${teamFilter}`, [user]);
            users = rows as { user_id: number }[];
        }
        if (!!users.length)
            return (users[0].user_id);
        return (-1);
    }

    public async delete(): Promise<status> {
        if (!this.is_loaded)
            return ({success: false, error: "Empty object!"});
        const user = await this.isExist(this.id!);
        if (user == -1) {
            return ({success: false, error: "This user does not exist!"});
        }
        const team = new TeamEntity();
        const ownedTeam: status & { result: number } = await team.isTeamOwner(this);
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
                                    FROM user_history
                                    WHERE id_user = ?`, [user]);
        await database.db!.execute(`DELETE
                                    FROM user
                                    WHERE user_id = ?`, [user]);
        this.is_loaded = false;
        return ({success: true, error: ""});
    }

    public async getUserHistory(): Promise<getHistories> {
        if (!this.is_loaded || !this.id)
            return ({success: false, error: "Empty object!", histories: []});
        if (await this.isExist(this.id) == -1)
            return ({success: false, error: "User not found!", histories: []});
        const database: Database = await Database.getInstance();
        const [rows] = await database.db!.execute(`SELECT tournament.*, team_tournament.*, team.name as team_name
                                              FROM tournament
                                                       INNER JOIN team_tournament ON tournament.tournament_id = team_tournament.id_tournament
                                                       INNER JOIN team ON team_tournament.id_team = team.team_id
                                                       INNER JOIN user_history ON team_tournament.team_tournament_id = user_history.id_team_tournament
                                              WHERE user_history.id_user = ?
                                              ORDER BY tournament.start DESC`, [this.id]);
        return ({success: true, error: "", histories: rows as History[]});
    }

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