import mysql, {Connection} from "mysql2/promise";
import "dotenv/config";

class Database {
    private static instance: Connection;

    static async getConnection(): Promise<Connection> {
        if (!Database.instance) {
            Database.instance = await mysql.createConnection({
                host: process.env.DB_HOST,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_DATABASE,
                waitForConnections: true,
            });
            await this.initDatabase(Database.instance);
        }
        return Database.instance;
    }

    private static async initDatabase(database: Connection): Promise<void> {
        try {
            await database.beginTransaction();

            // Entités
            await database.execute(`CREATE TABLE IF NOT EXISTS users (
                                            id_user INT AUTO_INCREMENT PRIMARY KEY,
                                            username VARCHAR(30) NOT NULL UNIQUE,
                                            hash VARCHAR(30) NOT NULL,
                                            token VARCHAR(96) DEFAULT NULL,
                                            is_admin BOOLEAN DEFAULT false,
                                            created_at TIMESTAMP DEFAULT now()
                                    ) `);
            await database.execute(`CREATE TABLE IF NOT EXISTS teams (
                                            id_team INT AUTO_INCREMENT PRIMARY KEY,
                                            name VARCHAR(30) NOT NULL UNIQUE,
                                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                        )
                                    `);
            await database.execute(`CREATE TABLE IF NOT EXISTS tournaments (
                                            id_tournament INT AUTO_INCREMENT PRIMARY KEY,
                                            organizer_user_id INT NOT NULL,
                                            name VARCHAR(80) NOT NULL,
                                            description TEXT,
                                            format ENUM('SIMPLE','DOUBLE') NOT NULL,
                                            max_teams INT NOT NULL,
                                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                            start_visibility_at TIMESTAMP NULL,
                                            open_registration_at TIMESTAMP NULL,
                                            close_registration_at TIMESTAMP NULL,
                                            start_at TIMESTAMP NULL,
                                            status ENUM('DRAFT','OPEN','RUNNING','DONE') DEFAULT 'DRAFT',
                                            current_round INT NULL,
                                        
                                            FOREIGN KEY (organizer_user_id)
                                                REFERENCES users(id_user)
                                                ON DELETE RESTRICT
                                        )
                                `);
            await database.execute(`CREATE TABLE IF NOT EXISTS matches (
                                            id_match INT AUTO_INCREMENT PRIMARY KEY,
                                            id_tournament INT NOT NULL,
                                            start_at TIMESTAMP NULL,
                                            round INT NOT NULL,
                                            bracket ENUM('UPPER','LOWER') NULL,
                                            match_index INT NULL,
                                        
                                            FOREIGN KEY (id_tournament)
                                                REFERENCES tournaments(id_tournament)
                                                ON DELETE CASCADE
                                            )
                                    `);


            // Associations
            await database.execute(`CREATE TABLE IF NOT EXISTS memberships (
                                            id_membership INT AUTO_INCREMENT PRIMARY KEY,
                                            id_user INT NOT NULL,
                                            id_team INT NOT NULL,
                                            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                            left_at TIMESTAMP NULL,
                                            role ENUM('MEMBER','OWNER') DEFAULT 'MEMBER',
                                        
                                            UNIQUE (id_user, id_team, joined_at),
                                        
                                            FOREIGN KEY (id_user)
                                                REFERENCES users(id_user)
                                                ON DELETE CASCADE,
                                            FOREIGN KEY (id_team)
                                                REFERENCES teams(id_team)
                                                ON DELETE CASCADE
                                            )
                                `);
            await database.execute(`CREATE TABLE IF NOT EXISTS registrations (
                                            id_registration INT AUTO_INCREMENT PRIMARY KEY,
                                            id_tournament INT NOT NULL,
                                            id_team INT NOT NULL,
                                            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                            final_position INT NULL,
                                            seed INT NULL,
                                        
                                            UNIQUE (id_tournament, id_team),
                                        
                                            FOREIGN KEY (id_tournament)
                                                REFERENCES tournaments(id_tournament)
                                                ON DELETE CASCADE,
                                            FOREIGN KEY (id_team)
                                                REFERENCES teams(id_team)
                                                ON DELETE CASCADE
                                            )
                                `);
            await database.execute(`CREATE TABLE IF NOT EXISTS match_participations (
                                            id_participation INT AUTO_INCREMENT PRIMARY KEY,
                                            id_match INT NOT NULL,
                                            id_team INT NOT NULL,
                                            score INT DEFAULT 0,
                                            is_winner BOOLEAN DEFAULT false,
                                        
                                            UNIQUE (id_match, id_team),
                                        
                                            FOREIGN KEY (id_match)
                                                REFERENCES matches(id_match)
                                                ON DELETE CASCADE,
                                            FOREIGN KEY (id_team)
                                                REFERENCES teams(id_team)
                                                ON DELETE CASCADE
                                            )
                                    `);
            await database.commit();
        } catch (e) {
            await database.rollback();
            throw e;
        } finally {
            await database.end();
        }
    }
}

export default Database;
