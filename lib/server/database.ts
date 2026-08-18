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
      visible_avatar TINYINT(1) NOT NULL DEFAULT 1,
      visible_pseudo TINYINT(1) NOT NULL DEFAULT 1,
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

  // Migration: seed + abandon dans les standings suisses. L'état complet est
  // redérivé de l'historique des matchs ; seuls le seed initial et les abandons
  // (décisions humaines) sont stockés en entrée du rejeu.
  try {
    await db.execute(`
      ALTER TABLE bg_swiss_standings
      ADD COLUMN seed INT NOT NULL DEFAULT 0,
      ADD COLUMN status ENUM('ACTIVE', 'FORFEIT') NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN forfeit_round INT NULL
    `);
  } catch {
    // Columns already exist
  }

  // Backfill du seed : `ADD COLUMN seed ... DEFAULT 0` laisse les tournois déjà
  // créés à 0 pour toutes leurs équipes, et `initializeSwissTournament` ne
  // repasse jamais dessus (il ne s'exécute qu'à la bascule REGISTRATION →
  // RUNNING). Sans ce rattrapage, le départage ultime `a.seed - b.seed` vaut
  // toujours 0 et les ex æquo parfaits retombent sur un ordre arbitraire.
  // Idempotent : ne touche que les lignes restées à 0.
  try {
    await db.execute(`
      UPDATE bg_swiss_standings s
      JOIN (
        SELECT tournament_id, team_id,
               ROW_NUMBER() OVER (
                 PARTITION BY tournament_id ORDER BY points DESC, team_id ASC
               ) AS rn
        FROM bg_swiss_standings
      ) x ON x.tournament_id = s.tournament_id AND x.team_id = s.team_id
      SET s.seed = x.rn
      WHERE s.seed = 0
    `);
  } catch {
    // Rien à rattraper (table vide, ou backfill déjà appliqué)
  }

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

  // Migration: Add SURVIVAL format support
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      MODIFY COLUMN format ENUM('SINGLE', 'DOUBLE', 'SWISS', 'SURVIVAL') NOT NULL
    `);
  } catch {
    // Already done
  }

  // Migration: Add Survival tournament metadata columns.
  // survival_rounds_per_cut = nombre de rounds joués entre chaque coupe.
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN survival_rounds_per_cut INT NULL,
      ADD COLUMN survival_current_round INT NOT NULL DEFAULT 0
    `);
  } catch {
    // Columns already exist
  }

  // Migration: Délai avant la première coupe, réglable indépendamment de
  // l'intervalle entre les coupes suivantes. NULL sur les tournois créés avant
  // l'option : la cadence s'applique alors dès la première coupe (comportement
  // historique, cf. `resolveCutSchedule`).
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN survival_rounds_before_first_cut INT NULL
    `);
  } catch {
    // Column already exists
  }

  // Migration: Add Survival barrage counter.
  // survival_barrage_rounds = nombre de rounds de barrage d'équilibrage joués
  // (0 ou 1) ; ils ne comptent pas dans la cadence des coupes.
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN survival_barrage_rounds INT NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists
  }

  // Migration: Create Survival standings table.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_survival_standings (
      tournament_id BIGINT NOT NULL,
      team_id BIGINT NOT NULL,
      seed INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      status ENUM('ACTIVE', 'ELIMINATED', 'FORFEIT') NOT NULL DEFAULT 'ACTIVE',
      eliminated_round INT NULL,
      \`rank\` INT NOT NULL DEFAULT 0,
      PRIMARY KEY (tournament_id, team_id),
      CONSTRAINT fk_survival_standings_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_survival_standings_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Add MULTI format support for multi-phase tournaments
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      MODIFY COLUMN format ENUM('SINGLE', 'DOUBLE', 'SWISS', 'SURVIVAL', 'MULTI') NOT NULL
    `);
  } catch {
    // Already done
  }

  // Migration: Add current_phase_id to track active phase in multi-phase tournaments
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN current_phase_id BIGINT NULL
    `);
  } catch {
    // Column already exists
  }

  // Migration: Create tournament phases table for multi-phase tournament support
  // Chaque phase a son propre format, ses qualifications et son état de progression
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_tournament_phases (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      tournament_id BIGINT NOT NULL,
      position INT NOT NULL,
      name VARCHAR(60) NULL,
      format ENUM('SINGLE', 'DOUBLE', 'SWISS', 'SURVIVAL') NOT NULL,
      qualifier_mode ENUM('COUNT', 'PERCENT') NOT NULL DEFAULT 'COUNT',
      qualifier_value INT NOT NULL DEFAULT 0,
      has_third_place_match BOOLEAN NOT NULL DEFAULT FALSE,
      swiss_total_rounds INT NULL,
      swiss_current_round INT NOT NULL DEFAULT 0,
      survival_rounds_before_first_cut INT NULL,
      survival_rounds_per_cut INT NULL,
      survival_current_round INT NOT NULL DEFAULT 0,
      survival_barrage_rounds INT NOT NULL DEFAULT 0,
      state ENUM('PENDING', 'RUNNING', 'FINISHED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
      entrants INT NULL,
      qualifiers INT NULL,
      max_rounds INT NULL,
      bracket_size INT NULL,
      started_at DATETIME NULL,
      finished_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_bg_phase (tournament_id, position),
      INDEX idx_bg_phase_tournament (tournament_id),
      CONSTRAINT fk_bg_phase_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: compteur de manches suisses d'une phase. Ajouté après coup — les
  // bases ayant déjà créé bg_tournament_phases ne l'ont pas, et `CREATE TABLE IF
  // NOT EXISTS` ne rattrape pas une colonne manquante.
  try {
    await db.execute(`
      ALTER TABLE bg_tournament_phases
      ADD COLUMN swiss_current_round INT NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists
  }

  // Migration: Create tournament phase teams table for multi-phase entrants tracking
  // Enregistre la participation des équipes dans chaque phase (seed, rank, qualified)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_tournament_phase_teams (
      phase_id BIGINT NOT NULL,
      tournament_id BIGINT NOT NULL,
      team_id BIGINT NOT NULL,
      seed INT NOT NULL DEFAULT 0,
      \`rank\` INT NULL,
      qualified BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (phase_id, team_id),
      INDEX idx_bg_phase_teams_tournament (tournament_id, team_id),
      CONSTRAINT fk_bg_phase_teams_phase FOREIGN KEY (phase_id)
        REFERENCES bg_tournament_phases(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_phase_teams_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Add phase_id to matches
  // phase_id = 0 pour les tournois sans phases (existants) ; >0 pour les phases multi-format
  try {
    await db.execute(`
      ALTER TABLE bg_matches
      ADD COLUMN phase_id BIGINT NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists
  }

  // Migration: Add index on (tournament_id, phase_id) for efficient phase queries
  try {
    await db.execute(`
      ALTER TABLE bg_matches
      ADD INDEX idx_bg_matches_phase (tournament_id, phase_id)
    `);
  } catch {
    // Index already exists
  }

  // Migration: Add phase_id to Swiss standings for multi-phase support
  // Rekey primary key to allow same team across multiple phases
  try {
    await db.execute(`
      ALTER TABLE bg_swiss_standings
      ADD COLUMN phase_id BIGINT NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists
  }

  try {
    await db.execute(`
      ALTER TABLE bg_swiss_standings
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (tournament_id, phase_id, team_id)
    `);
  } catch {
    // Primary key already rekeyed
  }

  // Migration: Add phase_id to Survival standings for multi-phase support
  // Rekey primary key to allow same team across multiple phases
  try {
    await db.execute(`
      ALTER TABLE bg_survival_standings
      ADD COLUMN phase_id BIGINT NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists
  }

  try {
    await db.execute(`
      ALTER TABLE bg_survival_standings
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (tournament_id, phase_id, team_id)
    `);
  } catch {
    // Primary key already rekeyed
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

  // Migration: avatar + pseudo visibles par défaut (le pseudo/avatar est
  // l'identité publique de base). Aligne les installs existantes sur le nouveau
  // défaut sans écraser les choix explicites déjà enregistrés.
  try {
    await db.execute(`ALTER TABLE bg_users ALTER COLUMN visible_avatar SET DEFAULT 1`);
    await db.execute(`ALTER TABLE bg_users ALTER COLUMN visible_pseudo SET DEFAULT 1`);
  } catch {
    // Default already applied
  }

  // Migration: le pseudo n'est plus masquable — c'est l'identité de base du
  // joueur (brackets, rosters, feuilles de match). La colonne est conservée
  // pour ne pas casser les installs, mais forcée à 1 une bonne fois.
  try {
    await db.execute(`UPDATE bg_users SET visible_pseudo = 1 WHERE visible_pseudo = 0`);
  } catch {
    // Colonne absente sur une install neuve : rien à reprendre.
  }

  // Migration: ouverture au recrutement. Un joueur sans équipe est « free
  // agent » par défaut ; il peut se retirer pour ne plus être démarché.
  try {
    await db.execute(`
      ALTER TABLE bg_users
      ADD COLUMN open_to_recruitment TINYINT(1) NOT NULL DEFAULT 1
    `);
  } catch {
    // Column already exists
  }

  // Migration: Rôles de permission cumulables (ARBITRE, COMMUNITY_MANAGER,
  // RECRUTEUR). Le rôle ADMIN reste porté par la colonne `is_admin`.
  try {
    await db.execute(`
      ALTER TABLE bg_users
      ADD COLUMN platform_roles_json JSON NULL
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

  // Migration: format « BlueGenji Survie » (endurance + play-offs à 8).
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      MODIFY COLUMN format ENUM('SINGLE', 'DOUBLE', 'SWISS', 'SURVIVAL', 'MULTI', 'BG_SURVIE') NOT NULL
    `);
  } catch {
    // Already done
  }

  // Migration: barème d'endurance (capital de départ, gains/pertes, effectif
  // des play-offs) + manche courante de la phase qualificative.
  for (const [column, definition] of [
    ["endurance_start_points", "INT NULL"],
    ["endurance_win_delta", "INT NULL"],
    ["endurance_loss_delta", "INT NULL"],
    ["endurance_playoff_size", "INT NULL"],
    ["endurance_current_round", "INT NOT NULL DEFAULT 0"],
    // 1 dès que la phase éliminatoire a été générée : la phase qualificative
    // ne produit alors plus de manche.
    ["endurance_playoffs_started", "TINYINT(1) NOT NULL DEFAULT 0"],
  ] as const) {
    try {
      await db.execute(`ALTER TABLE bg_tournaments ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists
    }
  }

  // Migration: classement d'endurance (mode BlueGenji Survie).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_endurance_standings (
      tournament_id BIGINT NOT NULL,
      team_id BIGINT NOT NULL,
      seed INT NOT NULL DEFAULT 0,
      points INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      status ENUM('ACTIVE', 'ELIMINATED', 'FORFEIT') NOT NULL DEFAULT 'ACTIVE',
      eliminated_round INT NULL,
      \`rank\` INT NOT NULL DEFAULT 0,
      PRIMARY KEY (tournament_id, team_id),
      CONSTRAINT fk_endurance_standings_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_endurance_standings_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: seeding ordonné à la main par le staff. Tant que le drapeau vaut
  // 0, chaque format seede comme avant (classement du site) ; dès qu'un arbitre
  // réordonne, l'ordre de `bg_tournament_registrations.seed` fait autorité.
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN manual_seeding TINYINT(1) NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists
  }

  // Migration: Équipes fantômes — créées par le staff (permission `tournaments`)
  // pour représenter une équipe sans compte joueur sur le site (remplissage de
  // bracket, équipe invitée). Aucun membre : le drapeau suffit à les distinguer.
  try {
    await db.execute(`
      ALTER TABLE bg_teams
      ADD COLUMN is_ghost TINYINT(1) NOT NULL DEFAULT 0
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

  // Migration: Cartes « L'association » (valeur + titre, gérables par les admins)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_about_stats (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      value VARCHAR(40) NOT NULL,
      label VARCHAR(60) NOT NULL,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_about_stats_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Réglages clé/valeur de l'association (ex. email contact presse)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_settings (
      setting_key VARCHAR(80) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
      category_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_benevoles_category (category),
      INDEX idx_bg_benevoles_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: ordre d'affichage des catégories de bénévoles (réordonnable admin)
  try {
    await db.execute(`
      ALTER TABLE bg_benevoles
      ADD COLUMN category_order INT NOT NULL DEFAULT 100
    `);
  } catch {
    // Column already exists
  }

  // Migration: annonces de recrutement (page dédiée + mise en avant urgente
  // via banderole ou modale). Réordonnable par les administrateurs. La colonne
  // `domain` porte le pôle de bénévolat visé (recrutement du staff associatif).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_recruitment_ads (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(140) NOT NULL,
      team_name VARCHAR(120) NULL,
      domain ENUM('ARBITRAGE', 'CASTING', 'DEV', 'COMMUNICATION', 'DESIGN', 'MODERATION', 'EVENEMENTIEL', 'ADMIN', 'AUTRE') NOT NULL DEFAULT 'AUTRE',
      roles VARCHAR(200) NULL,
      body TEXT NULL,
      contact_url VARCHAR(2048) NULL,
      contact_discord VARCHAR(120) NULL,
      contact_discord_id VARCHAR(32) NULL,
      contact_preferred ENUM('AUTO', 'DISCORD', 'LINK') NOT NULL DEFAULT 'AUTO',
      highlight ENUM('NONE', 'BANNER', 'MODAL') NOT NULL DEFAULT 'NONE',
      active TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_recruitment_active_order (active, display_order),
      INDEX idx_bg_recruitment_highlight (highlight)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: réorientation « staff associatif » — l'ancienne colonne `game`
  // (jeu : OW2/MR/ANY) devient `domain` (pôle de bénévolat). On élargit d'abord
  // en VARCHAR pour renommer sans erreur de conversion d'ENUM, on neutralise les
  // anciennes valeurs, puis on reverrouille sur le nouvel ENUM. Chaque étape est
  // tolérante : sur une base récente `domain` existe déjà et les ALTER échouent
  // silencieusement.
  try {
    await db.execute(`
      ALTER TABLE bg_recruitment_ads
      CHANGE COLUMN game domain VARCHAR(32) NOT NULL DEFAULT 'AUTRE'
    `);
  } catch {
    // `game` déjà renommé (base récente) ou table absente.
  }
  try {
    await db.execute(`
      UPDATE bg_recruitment_ads
      SET domain = 'AUTRE'
      WHERE domain NOT IN ('ARBITRAGE', 'CASTING', 'DEV', 'COMMUNICATION', 'DESIGN', 'MODERATION', 'EVENEMENTIEL', 'ADMIN', 'AUTRE')
    `);
  } catch {
    // Rien à normaliser.
  }
  try {
    await db.execute(`
      ALTER TABLE bg_recruitment_ads
      MODIFY COLUMN domain ENUM('ARBITRAGE', 'CASTING', 'DEV', 'COMMUNICATION', 'DESIGN', 'MODERATION', 'EVENEMENTIEL', 'ADMIN', 'AUTRE') NOT NULL DEFAULT 'AUTRE'
    `);
  } catch {
    // Colonne déjà au bon type.
  }

  // Migration: canaux de contact directs (tag Discord + lien de candidature). Sur
  // une base ancienne les colonnes manquent ; sur une base récente elles existent
  // déjà et les ALTER échouent silencieusement.
  try {
    await db.execute(`
      ALTER TABLE bg_recruitment_ads
      ADD COLUMN contact_discord VARCHAR(120) NULL AFTER contact_url
    `);
  } catch {
    // Colonne déjà présente.
  }
  try {
    await db.execute(`
      ALTER TABLE bg_recruitment_ads
      ADD COLUMN contact_discord_id VARCHAR(32) NULL AFTER contact_discord
    `);
  } catch {
    // Colonne déjà présente.
  }
  try {
    await db.execute(`
      ALTER TABLE bg_recruitment_ads
      ADD COLUMN contact_preferred ENUM('AUTO', 'DISCORD', 'LINK') NOT NULL DEFAULT 'AUTO' AFTER contact_discord_id
    `);
  } catch {
    // Colonne déjà présente.
  }

  // Migration: abandon du canal email. On neutralise l'ancienne valeur de canal
  // préféré `EMAIL`, on resserre l'ENUM, puis on supprime la colonne `contact_email`
  // si elle subsiste d'une version antérieure. Étapes tolérantes.
  try {
    await db.execute(`UPDATE bg_recruitment_ads SET contact_preferred = 'AUTO' WHERE contact_preferred = 'EMAIL'`);
  } catch {
    // Valeur déjà absente / colonne au bon type.
  }
  try {
    await db.execute(`
      ALTER TABLE bg_recruitment_ads
      MODIFY COLUMN contact_preferred ENUM('AUTO', 'DISCORD', 'LINK') NOT NULL DEFAULT 'AUTO'
    `);
  } catch {
    // ENUM déjà resserré.
  }
  try {
    await db.execute(`ALTER TABLE bg_recruitment_ads DROP COLUMN contact_email`);
  } catch {
    // Colonne déjà absente (cas nominal).
  }

  // Migration: tournois individuels. `participant_type = 'SOLO'` fait inscrire
  // les joueurs eux-mêmes plutôt que leur équipe ; le moteur, lui, continue de
  // raisonner en engagés (`team_id`), si bien que tous les formats existants
  // fonctionnent à l'identique. Défaut `TEAM` : les tournois déjà créés ne
  // changent pas de comportement.
  try {
    await db.execute(`
      ALTER TABLE bg_tournaments
      ADD COLUMN participant_type ENUM('TEAM', 'SOLO') NOT NULL DEFAULT 'TEAM'
    `);
  } catch {
    // Column already exists
  }

  // Migration: entrée solo d'un joueur — une ligne `bg_teams` qui le représente
  // en tournoi individuel, sans aucun membre (comme une équipe fantôme). Pas de
  // clé étrangère volontairement : une suppression de compte en cascade
  // effacerait l'engagé, et avec lui l'historique des matchs qui le référencent.
  // L'unicité garantit « un joueur = au plus une entrée solo ».
  try {
    await db.execute(`
      ALTER TABLE bg_teams
      ADD COLUMN solo_user_id BIGINT NULL
    `);
  } catch {
    // Column already exists
  }
  try {
    await db.execute(`
      ALTER TABLE bg_teams
      ADD UNIQUE INDEX uniq_bg_teams_solo_user (solo_user_id)
    `);
  } catch {
    // Index already exists
  }
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
      dateStrings: true,
    });
  }

  await ensureMigrations(pool);
  return pool;
}
