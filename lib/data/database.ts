import mysql from 'mysql2/promise';
import dotenv from "dotenv";

dotenv.config();

/**
 * Encapsule l'objet MySQL. Singleton, le construit et l'initialise. Définition des tables en son sein
 */
export class Database {
    // #region Création / Destruction publiques

    /**
     * Singleton créé une instance de base de donnée si elle n'existe pas sinon la renvoie
     */
    public static async getInstance(): Promise<Database> {
        if (!Database.instance) {
            Database.instance = new Database();
            await Database.instance.connect();
        }
        return Database.instance;
    }

    /**
     * Déconnecte la base de donnée, détruit l'instance
     */
    public static async disconnect() {
        if (Database.instance && Database.instance.Connection) {
            await Database.instance.Connection.end();
            Database.instance = null;
        }
    }
    // #endregion

    // #region Méthodes publiques
    public async execute(sql: string, params?: unknown[]): Promise<[mysql.QueryResult, mysql.FieldPacket[]]> {
        return this.Connection.execute(sql, params);
    }

    public async beginTransaction() {
        await this.Connection.beginTransaction();
    }

    public async commit() {
        await this.Connection.commit();
    }
    // #endregion

    // #region Attributs Privés

    /**
     * Instance de la classe, pour le singleton
     * @private
     */
    private static instance: Database | null = null;

    /**
     * Connexion MySQL
     * @private
     */
    private Connection!: mysql.Connection;

    // #endregion

    // #region Initialiseurs privés

    private constructor() {}


    private async connect() {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
        });
        if (!conn)
            throw new Error("Database connection error");
        this.Connection = conn;
        await this.initialize();
    }

    /**
     * Initialise la base de donnée si elle ne l'est pas. Permet une construction automatique de la base de donnée.
     * @private
     */
    private async initialize() {
        await this.Connection.execute(`CREATE TABLE IF NOT EXISTS user
                                 (
                                    id_user  INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    username VARCHAR(15) COLLATE utf8mb4_bin NOT NULL,
                                    hash     VARCHAR(60) COLLATE utf8mb4_bin NOT NULL,
                                    token    VARCHAR(140) COLLATE utf8mb4_bin DEFAULT NULL,
                                    is_admin BOOLEAN                          DEFAULT false
                                 );`);
        await this.Connection.execute(`CREATE TABLE IF NOT EXISTS team
                                 (
                                    id_team       INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    name          VARCHAR(15) COLLATE utf8mb4_bin NOT NULL,
                                    creation_date DATETIME DEFAULT CURRENT_TIMESTAMP
                                 );`);
        await this.Connection.execute(`CREATE TABLE IF NOT EXISTS user_team
                                 (
                                    id_user INTEGER NOT NULL,
                                    id_team INTEGER NOT NULL,
                                    date_join DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    date_leave DATETIME DEFAULT NULL,
                                    PRIMARY KEY (id_user, id_team, date_join),
                                    FOREIGN KEY (id_user) REFERENCES user (id_user)
                                        ON DELETE CASCADE,
                                    FOREIGN KEY (id_team) REFERENCES team (id_team)
                                        ON DELETE CASCADE
                                 );`);
        await this.Connection.execute(`CREATE TABLE IF NOT EXISTS team_owner
                                        (
                                            id_user INTEGER NOT NULL,
                                            id_team INTEGER NOT NULL,
                                            PRIMARY KEY (id_user, id_team),
                                            FOREIGN KEY (id_user) 
                                                REFERENCES user (id_user)
                                                ON DELETE CASCADE,
                                            FOREIGN KEY (id_team) 
                                                REFERENCES team (id_team)
                                                ON DELETE CASCADE
                                       )`);
        await this.Connection.execute(`CREATE TABLE IF NOT EXISTS tournament
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
        await this.Connection.execute(`CREATE TABLE IF NOT EXISTS team_tournament
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
        await this.Connection.execute(`CREATE TABLE IF NOT EXISTS \`match\`
                                 (
                                    id_match        INTEGER PRIMARY KEY AUTO_INCREMENT,
                                    id_tournament   INTEGER  NOT NULL,
                                    id_victory_team INTEGER DEFAULT NULL,
                                    start_date      DATETIME NOT NULL,
                                    FOREIGN KEY (id_tournament) REFERENCES tournament (id_tournament)
                                        ON DELETE CASCADE,
                                    FOREIGN KEY (id_victory_team) REFERENCES team (id_team)
                                        ON DELETE SET NULL
                                 );`);
        await this.Connection.execute(`CREATE TABLE IF NOT EXISTS team_match
                                 (
                                    id_match INTEGER NOT NULL,
                                    id_team  INTEGER NOT NULL,
                                    score    INTEGER DEFAULT 0,
                                    PRIMARY KEY (id_match, id_team),
                                    FOREIGN KEY (id_match) REFERENCES \`match\` (id_match)
                                        ON DELETE CASCADE,
                                    FOREIGN KEY (id_team) REFERENCES team (id_team)
                                        ON DELETE CASCADE
                                 )`);
    }
    // #endregion
}