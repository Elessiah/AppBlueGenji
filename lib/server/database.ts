import "dotenv/config";
import mysql, { type Pool } from "mysql2/promise";

let pool: Pool | null = null;
let migrationPromise: Promise<void> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

async function runMigrations(db: Pool): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_users (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      pseudo VARCHAR(40) NOT NULL UNIQUE,
      avatar_url TEXT NULL,
      discord_id VARCHAR(40) NULL UNIQUE,
      google_sub VARCHAR(191) NULL UNIQUE,
      email VARCHAR(191) NULL UNIQUE,
      is_adult TINYINT(1) NULL DEFAULT NULL,
      overwatch_battletag VARCHAR(64) NULL,
      marvel_rivals_tag VARCHAR(64) NULL,
      visible_avatar TINYINT(1) NOT NULL DEFAULT 0,
      visible_pseudo TINYINT(1) NOT NULL DEFAULT 0,
      visible_overwatch TINYINT(1) NOT NULL DEFAULT 0,
      visible_marvel TINYINT(1) NOT NULL DEFAULT 0,
      visible_major TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      is_admin TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_user_sessions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      token_hash CHAR(64) NOT NULL UNIQUE,
      user_id BIGINT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      INDEX idx_bg_sessions_user_id (user_id),
      INDEX idx_bg_sessions_expires_at (expires_at),
      CONSTRAINT fk_bg_sessions_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_discord_login_challenges (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      discord_id VARCHAR(40) NOT NULL,
      code_hash CHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      attempts INT NOT NULL DEFAULT 0,
      INDEX idx_bg_challenges_discord_id (discord_id),
      INDEX idx_bg_challenges_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_teams (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(60) NOT NULL UNIQUE,
      logo_url TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_team_members (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      team_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      roles_json JSON NOT NULL,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      left_at DATETIME NULL,
      INDEX idx_bg_team_members_team_id (team_id),
      INDEX idx_bg_team_members_user_id (user_id),
      INDEX idx_bg_team_members_left_at (left_at),
      CONSTRAINT fk_bg_team_members_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_team_members_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_tournaments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      organizer_user_id BIGINT NOT NULL,
      name VARCHAR(120) NOT NULL,
      description TEXT NULL,
      format ENUM('SINGLE', 'DOUBLE') NOT NULL,
      max_teams INT NOT NULL,
      bracket_size INT NULL,
      state ENUM('UPCOMING', 'REGISTRATION', 'RUNNING', 'FINISHED') NOT NULL DEFAULT 'UPCOMING',
      start_visibility_at DATETIME NOT NULL,
      registration_open_at DATETIME NOT NULL,
      registration_close_at DATETIME NOT NULL,
      start_at DATETIME NOT NULL,
      finished_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_tournaments_state (state),
      INDEX idx_bg_tournaments_start_at (start_at),
      CONSTRAINT fk_bg_tournaments_organizer FOREIGN KEY (organizer_user_id)
        REFERENCES bg_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_tournament_registrations (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      tournament_id BIGINT NOT NULL,
      team_id BIGINT NOT NULL,
      seed INT NULL,
      final_rank INT NULL,
      registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_bg_registration (tournament_id, team_id),
      INDEX idx_bg_registration_tournament (tournament_id),
      INDEX idx_bg_registration_team (team_id),
      CONSTRAINT fk_bg_registration_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_registration_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_matches (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      tournament_id BIGINT NOT NULL,
      bracket ENUM('UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') NOT NULL,
      round_number INT NOT NULL,
      match_number INT NOT NULL,
      team1_id BIGINT NULL,
      team2_id BIGINT NULL,
      team1_score INT NULL,
      team2_score INT NULL,
      status ENUM('PENDING', 'READY', 'AWAITING_CONFIRMATION', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
      winner_team_id BIGINT NULL,
      loser_team_id BIGINT NULL,
      next_winner_match_id BIGINT NULL,
      next_winner_slot TINYINT NULL,
      next_loser_match_id BIGINT NULL,
      next_loser_slot TINYINT NULL,
      team1_report_score INT NULL,
      team1_report_opponent_score INT NULL,
      team1_reported_at DATETIME NULL,
      team2_report_score INT NULL,
      team2_report_opponent_score INT NULL,
      team2_reported_at DATETIME NULL,
      score_deadline_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_matches_tournament (tournament_id),
      INDEX idx_bg_matches_status (status),
      INDEX idx_bg_matches_round (round_number),
      CONSTRAINT fk_bg_matches_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_matches_team1 FOREIGN KEY (team1_id)
        REFERENCES bg_teams(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_matches_team2 FOREIGN KEY (team2_id)
        REFERENCES bg_teams(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_matches_winner FOREIGN KEY (winner_team_id)
        REFERENCES bg_teams(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_matches_loser FOREIGN KEY (loser_team_id)
        REFERENCES bg_teams(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_matches_next_winner FOREIGN KEY (next_winner_match_id)
        REFERENCES bg_matches(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_matches_next_loser FOREIGN KEY (next_loser_match_id)
        REFERENCES bg_matches(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Add placeholder columns for loser bracket initialization
  try {
    await db.execute(`
      ALTER TABLE bg_matches
      ADD COLUMN team1_placeholder VARCHAR(255) NULL
    `);
  } catch {
    // Column already exists, ignore
  }
  try {
    await db.execute(`
      ALTER TABLE bg_matches
      ADD COLUMN team2_placeholder VARCHAR(255) NULL
    `);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add forfeit tracking
  try {
    await db.execute(`
      ALTER TABLE bg_matches
      ADD COLUMN forfeit_team_id BIGINT NULL
    `);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Reset invalid forfeit_team_id values (0 or non-matching team IDs)
  try {
    await db.execute(`
      UPDATE bg_matches
      SET forfeit_team_id = NULL
      WHERE forfeit_team_id = 0
      OR (forfeit_team_id IS NOT NULL AND status != 'COMPLETED')
    `);
  } catch {
    // Ignore if already done
  }

  // Migration: Add has_third_place_match to bg_tournaments
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN has_third_place_match TINYINT(1) NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add THIRD_PLACE to bracket ENUM
  try {
    await db.execute(`
      ALTER TABLE bg_matches
      MODIFY COLUMN bracket ENUM('UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') NOT NULL
    `);
  } catch {
    // Ignore if already done
  }

  // Migration: Add game column to tournaments (multi-game support)
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN game ENUM('OW2', 'MR') NOT NULL DEFAULT 'OW2'
      AFTER description
    `);
  } catch (err: unknown) {
    // Column already exists or other error; MySQL 8.0.29+ supports IF NOT EXISTS
    const error = err as { message?: string };
    if (!error.message?.includes("Duplicate column name")) {
      throw err;
    }
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_sponsors (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      tier ENUM('GOLD', 'SILVER', 'BRONZE', 'PARTNER') NOT NULL DEFAULT 'PARTNER',
      logo_url TEXT NULL,
      website_url TEXT NULL,
      description TEXT NULL,
      display_order INT NOT NULL DEFAULT 100,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_sponsors_active_order (active, display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Add SWISS format support
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      MODIFY COLUMN format ENUM('SINGLE', 'DOUBLE', 'SWISS') NOT NULL
    `);
  } catch {
    // Already done
  }

  // Migration: Add Swiss tournament metadata columns
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN swiss_total_rounds INT NULL,
      ADD COLUMN swiss_current_round INT NOT NULL DEFAULT 0,
      ADD COLUMN swiss_points_win INT NOT NULL DEFAULT 3,
      ADD COLUMN swiss_points_draw INT NOT NULL DEFAULT 1,
      ADD COLUMN swiss_points_loss INT NOT NULL DEFAULT 0,
      ADD COLUMN swiss_points_bye INT NOT NULL DEFAULT 3,
      ADD COLUMN swiss_tiebreakers_json JSON NULL
    `);
  } catch {
    // Columns already exist
  }

  // Migration: Create Swiss standings table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_swiss_standings (
      tournament_id BIGINT NOT NULL,
      team_id BIGINT NOT NULL,
      points INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0,
      draws INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      byes INT NOT NULL DEFAULT 0,
      opponent_ids_json JSON NOT NULL,
      buchholz DECIMAL(6, 2) NOT NULL DEFAULT 0,
      \`rank\` INT NOT NULL DEFAULT 0,
      PRIMARY KEY (tournament_id, team_id),
      CONSTRAINT fk_swiss_standings_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_swiss_standings_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Add Swiss round and bye columns to matches
  try {
    await db.execute(`
      ALTER TABLE bg_matches
      ADD COLUMN swiss_round INT NULL,
      ADD COLUMN is_bye BOOLEAN NOT NULL DEFAULT FALSE
    `);
  } catch {
    // Columns already exist
  }

  // Migration: Add Discord pseudo + soft-delete (anonymisation) to users
  try {
    await db.execute(`
      ALTER TABLE bg_users
      ADD COLUMN discord_pseudo VARCHAR(64) NULL
    `);
  } catch {
    // Column already exists
  }
  try {
    await db.execute(`
      ALTER TABLE bg_users
      ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists
  }

  // Migration: Add description to teams
  try {
    await db.execute(`
      ALTER TABLE bg_teams
      ADD COLUMN description TEXT NULL
    `);
  } catch {
    // Column already exists
  }

  // Migration: Soft-delete (dissolution) des équipes — conserve les stats
  try {
    await db.execute(`
      ALTER TABLE bg_teams
      ADD COLUMN deleted_at DATETIME NULL
    `);
  } catch {
    // Column already exists
  }

  // Migration: Team invitations / join requests
  // kind = INVITE (management → user) or REQUEST (user → team, self-service)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_team_invitations (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      team_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      created_by BIGINT NOT NULL,
      kind ENUM('INVITE', 'REQUEST') NOT NULL,
      status ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME NULL,
      INDEX idx_bg_team_inv_team (team_id),
      INDEX idx_bg_team_inv_user (user_id),
      INDEX idx_bg_team_inv_status (status),
      CONSTRAINT fk_bg_team_inv_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_team_inv_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_team_inv_creator FOREIGN KEY (created_by)
        REFERENCES bg_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Membres du bureau de l'association (gérables par les admins)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_bureau_members (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      role VARCHAR(120) NOT NULL,
      initials VARCHAR(4) NOT NULL,
      color VARCHAR(40) NOT NULL,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_bureau_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Bénévoles de l'association, groupés par catégorie dynamique
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_benevoles (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(80) NOT NULL,
      pseudo VARCHAR(80) NULL,
      last_name VARCHAR(80) NOT NULL,
      category VARCHAR(120) NOT NULL,
      photo_url VARCHAR(500) NULL,
      joined_at DATE NOT NULL,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_benevoles_category (category),
      INDEX idx_bg_benevoles_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureMigrations(db: Pool): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runMigrations(db).then();
  }
  await migrationPromise;
}

export async function getDatabase(): Promise<Pool> {
  if (!pool) {
    pool = mysql.createPool({
      host: requireEnv("DB_HOST"),
      user: requireEnv("DB_USER"),
      password: requireEnv("DB_PASSWORD"),
      database: requireEnv("DB_DATABASE"),
      waitForConnections: true,
      connectionLimit: 25,
      connectTimeout: 10000,
      namedPlaceholders: true,
      charset: "utf8mb4",
    });
  }

  await ensureMigrations(pool);
  return pool;
}
