import mysql from 'mysql2/promise';
import dotenv from "dotenv";
import crypto from 'crypto';
import bcrypt from 'bcrypt';

dotenv.config();

import {
    getTeamMembers,
    History,
    getHistories,
    status,
    Team,
    User,
    SQLGetParams,
    SQLEditParams,
    SQLQuery,
    SQLGetResult,
    SQLWhere,
    Match,
    getMatchs,
    getTournamentTeams,
    TeamTournament, id, Tournament, token_payload, TeamInfo, UserInfo, TournamentTeamsCount,
} from '../types';

export class Database {
    // public
    public static async getInstance(): Promise<Database> {
        if (!Database.instance) {
            Database.instance = new Database();
            await Database.instance.ready;
        }
        return Database.instance;
    }

    // Primary function
    public async insert(params: SQLEditParams): Promise<status & id> {
        await this.ready;
        try {
            const placeholders = params.values.map(() => "?").join(", ");

            const [result] = await this.db!.execute<mysql.ResultSetHeader>(
                `INSERT INTO ${params.table} (${params.columns.join(", ")})
                 VALUES (${placeholders})`,
                params.values,
            );

            return {success: true, error: "", id: result.insertId};
        } catch (error: any) {
            return {success: false, error: error.message, id: -1};
        }
    }

    public async update(params: SQLEditParams, where: SQLWhere[]): Promise<status> {
        await this.ready;
        if (where.length === 0)
            return ({success: false, error: "Impossible car trop dangereux"});
        try {
            const placeholders = params.columns.map((column) => `${column} = ?`).join(", ");
            let filter: string = ' WHERE ';
            where.forEach((elem) => {
                filter += ` ${elem.column} ${elem.condition} ?`;
                params.values.push(elem.value);
            })
            await this.db!.execute(
                `UPDATE ${params.table}
                 SET ${placeholders} ${filter}`,
                params.values,
            );

            return {success: true, error: ""};
        } catch (error: any) {
            return {success: false, error: error.message};
        }
    }

    public async get(
        rawParams: Partial<SQLGetParams>,
    ): Promise<SQLGetResult> {
        await this.ready;
        const query = await this.buildSelectQuery(rawParams, true);

        try {
            const [rows] = await this.db!.execute(query.query, query.values);

            return ({success: true, error: "", result: rows as unknown[]});
        } catch (error: any) {
            return ({success: false, error: error.message, result: []});
        }
    }

    public async remove(rawParams: Partial<SQLGetParams>): Promise<status> {
        await this.ready;
        const query = await this.buildSelectQuery(rawParams, false);

        await this.db!.execute(query.query, query.values);

        return {success: true, error: ""};
    }

    // App function

    // private
    private static instance: Database;
    public db: mysql.Connection | null = null;
    public readonly ready: Promise<void>;

    private constructor() {
        this.ready = this.connect();
    }

    private async connect() {
        this.db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
        });
        if (!this.db)
            throw ("Database connection error");
        await this.initialize();
    }

    private async initialize() {
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS user
                                (
                                    id_user  INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    username VARCHAR(15) COLLATE utf8mb4_bin NOT NULL,
                                    hash     VARCHAR(60) COLLATE utf8mb4_bin NOT NULL,
                                    token    VARCHAR(140) COLLATE utf8mb4_bin DEFAULT NULL,
                                    is_admin BOOLEAN                          DEFAULT false
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS team
                                (
                                    id_team       INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    name          VARCHAR(15) COLLATE utf8mb4_bin NOT NULL,
                                    creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    id_user       INTEGER,
                                    FOREIGN KEY (id_user) REFERENCES user (id_user)
                                        ON DELETE SET NULL
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS user_team
                                (
                                    id_user INTEGER NOT NULL,
                                    id_team INTEGER NOT NULL,
                                    date_join DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    date_leave DATETIME DEFAULT NULL,
                                    PRIMARY KEY (id_user, id_team),
                                    FOREIGN KEY (id_user) REFERENCES user (id_user)
                                        ON DELETE CASCADE,
                                    FOREIGN KEY (id_team) REFERENCES team (id_team)
                                        ON DELETE CASCADE
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS tournament
                                (
                                    id_tournament      INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    name               VARCHAR(255)              NOT NULL,
                                    description        TEXT                      NOT NULL,
                                    format             ENUM ('SIMPLE', 'DOUBLE') NOT NULL,
                                    size               INTEGER                   NOT NULL,
                                    id_user            INTEGER,
                                    creation_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    start_visibility   DATETIME                  NOT NULL,
                                    open_registration  DATETIME                  NOT NULL,
                                    close_registration DATETIME                  NOT NULL,
                                    start              DATETIME                  NOT NULL,
                                    current_round      INTEGER  DEFAULT -1       NOT NULL,
                                    FOREIGN KEY (id_user) REFERENCES user (id_user)
                                        ON DELETE SET NULL
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS team_tournament
                                (
                                    id_tournament INTEGER NOT NULL,
                                    id_team       INTEGER NOT NULL,
                                    position      INTEGER DEFAULT -1,
                                    PRIMARY KEY (id_tournament, id_team),
                                    FOREIGN KEY (id_tournament) REFERENCES tournament (id_tournament)
                                        ON DELETE CASCADE,
                                    FOREIGN KEY (id_team) REFERENCES team (id_team)
                                        ON DELETE CASCADE
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS \`match\`
                                (
                                    id_match        INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    id_tournament   INTEGER  NOT NULL,
                                    id_victory_team INTEGER DEFAULT NULL,
                                    start_date      DATETIME NOT NULL,
                                    FOREIGN KEY (id_tournament) REFERENCES tournament (id_tournament)
                                        ON DELETE CASCADE,
                                    FOREIGN KEY (id_victory_team) REFERENCES team (id_team)
                                );`);
        await this.db!.execute(`CREATE TABLE IF NOT EXISTS team_match
                                (
                                    id_match INTEGER NOT NULL,
                                    id_team  INTEGER NOT NULL,
                                    PRIMARY KEY (id_match, id_team),
                                    FOREIGN KEY (id_match) REFERENCES \`match\` (id_match)
                                        ON DELETE CASCADE,
                                    FOREIGN KEY (id_team) REFERENCES team (id_team)
                                        ON DELETE CASCADE
                                )`);
    }

    private async buildSelectQuery(
        rawParams: Partial<SQLGetParams>,
        isSelect: boolean,
    ): Promise<SQLQuery> {
        if (rawParams.table == undefined) {
            return {success: false, error: "Table must be define to get something!", query: "", values: []};
        }

        const params: SQLGetParams = {
            table: "",
            values: ["*"],
            joinOption: [],
            whereOption: [],
            order: [],
            all: true,
            ...rawParams,
        };
        let query: string;

        if (isSelect) {
            query = `SELECT ${params.values?.join(", ")} `;
        } else {
            query = `DELETE `;
        }
        query += ` FROM ${params.table} ${params.joinOption?.join(" ")} `;

        let values: (string | number | bigint)[] = [];

        if (params.whereOption.length > 0) {
            query += ` WHERE `;
            params.whereOption.forEach((elem, index, array) => {
                query += ` ${elem.column} ${elem.condition} ?`;
                if (index + 1 < array.length) {
                    query += ` AND `;
                }
                values.push(elem.value);
            });
        }
        if (isSelect && params.order && params.order.length > 0) {
            query += ` ORDER BY `;
            params.order?.forEach((elem) => {
                query += ` ${elem.orderBy} [${elem.isAscending ? "ASC" : "DESC"}] `;
            });
        }

        return {success: true, error: "", query: query, values: values};
    }
}

await Database.getInstance();