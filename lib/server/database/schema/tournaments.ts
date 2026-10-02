import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/** Tournois : réglages, inscriptions et matchs. */
export async function createTournamentTables(db: Pool): Promise<void> {
  // Les réglages sont groupés par famille et non par date d'ajout : général,
  // inscriptions, format de match, puis un bloc par moteur (suisse, survie,
  // endurance). Un tournoi ne renseigne jamais que le bloc de son format.
  //
  // `organizer_user_id` est en `ON DELETE RESTRICT` : un tournoi sans
  // organisateur n'aurait plus de titulaire, et c'est cette contrainte qui
  // interdit d'effacer un compte organisateur (cf. `accountDeletionMode`).
  //
  // Les deux colonnes `match_format_*` vont **par paire** : tant que l'une est
  // `NULL`, la saisie des scores reste libre. `match_format_max_maps` borne les
  // maps *décisives* et n'a de sens qu'avec `match_format_draws`.
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_tournaments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      organizer_user_id BIGINT NOT NULL,
      name VARCHAR(120) NOT NULL,
      description TEXT NULL,
      game ENUM('OW', 'MR') NOT NULL DEFAULT 'OW',
      format ENUM('SINGLE', 'DOUBLE', 'SWISS', 'SURVIVAL', 'MULTI', 'BG_SURVIE') NOT NULL,
      participant_type ENUM('TEAM', 'SOLO') NOT NULL DEFAULT 'TEAM',
      max_teams INT NOT NULL,
      bracket_size INT NULL,
      state ENUM('UPCOMING', 'REGISTRATION', 'RUNNING', 'FINISHED') NOT NULL DEFAULT 'UPCOMING',
      has_third_place_match TINYINT(1) NOT NULL DEFAULT 0,
      manual_seeding TINYINT(1) NOT NULL DEFAULT 0,
      registration_discord_requirement
        ENUM('NONE', 'ANY_PLAYER', 'ALL_PLAYERS') NOT NULL DEFAULT 'ANY_PLAYER',
      -- Le défaut \`NONE\` de la condition Blizzard n'est pas une prudence de
      -- migration : c'est le défaut du réglage lui-même, la moitié du site
      -- jouant à Marvel Rivals, où un compte Battle.net ne veut rien dire.
      registration_blizzard_requirement
        ENUM('NONE', 'ANY_PLAYER', 'ALL_PLAYERS') NOT NULL DEFAULT 'NONE',
      registration_min_players INT NOT NULL DEFAULT 5,
      -- Matchs planifiés par l'arbitrage (\`lib/shared/match-planning.ts\`).
      referee_scheduling TINYINT(1) NOT NULL DEFAULT 0,
      match_format_type ENUM('BO', 'FT') NULL,
      match_format_value INT NULL,
      match_format_max_maps INT NULL,
      match_format_draws TINYINT(1) NOT NULL DEFAULT 0,
      swiss_total_rounds INT NULL,
      swiss_current_round INT NOT NULL DEFAULT 0,
      swiss_points_win INT NOT NULL DEFAULT 3,
      swiss_points_draw INT NOT NULL DEFAULT 1,
      swiss_points_loss INT NOT NULL DEFAULT 0,
      swiss_points_bye INT NOT NULL DEFAULT 3,
      swiss_tiebreakers_json JSON NULL,
      survival_rounds_before_first_cut INT NULL,
      survival_rounds_per_cut INT NULL,
      survival_current_round INT NOT NULL DEFAULT 0,
      survival_barrage_rounds INT NOT NULL DEFAULT 0,
      endurance_start_points INT NULL,
      endurance_win_delta INT NULL,
      endurance_loss_delta INT NULL,
      endurance_playoff_size INT NULL,
      endurance_max_rounds INT NULL,
      endurance_current_round INT NOT NULL DEFAULT 0,
      endurance_playoffs_started TINYINT(1) NOT NULL DEFAULT 0,
      endurance_playoff_format_type ENUM('BO', 'FT') NULL,
      endurance_playoff_format_value INT NULL,
      current_phase_id BIGINT NULL,
      live_url VARCHAR(255) NULL,
      -- Illustration ou logo, facultatif (\`lib/shared/tournament-image.ts\`) :
      -- fichier stocké sans recadrage, cadrage décidé au rendu.
      image_url VARCHAR(255) NULL,
      image_fit ENUM('COVER', 'CONTAIN') NOT NULL DEFAULT 'COVER',
      image_focus_x TINYINT UNSIGNED NOT NULL DEFAULT 50,
      image_focus_y TINYINT UNSIGNED NOT NULL DEFAULT 50,
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

  await createTable(db, `
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

  // `phase_id = 0` désigne un tournoi **sans phases**, ce qui laisse tous les
  // formats non multi-phases inchangés.
  //
  // `live_trigger IS NULL` est le marqueur « ce match n'est pas casté » ; un
  // match ne recopie jamais la chaîne de son tournoi (un streamer indépendant
  // peut le caster). L'index `idx_bg_matches_live` porte le balayage du bouton
  // « Regarder le live » de l'accueil, qui lirait sinon toute la table à chaque
  // chargement.
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_matches (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      tournament_id BIGINT NOT NULL,
      phase_id BIGINT NOT NULL DEFAULT 0,
      bracket ENUM('UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') NOT NULL,
      round_number INT NOT NULL,
      match_number INT NOT NULL,
      swiss_round INT NULL,
      is_bye BOOLEAN NOT NULL DEFAULT FALSE,
      team1_id BIGINT NULL,
      team2_id BIGINT NULL,
      team1_placeholder VARCHAR(255) NULL,
      team2_placeholder VARCHAR(255) NULL,
      team1_score INT NULL,
      team2_score INT NULL,
      status ENUM('PENDING', 'READY', 'AWAITING_CONFIRMATION', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
      winner_team_id BIGINT NULL,
      loser_team_id BIGINT NULL,
      forfeit_team_id BIGINT NULL,
      double_forfeit BOOLEAN NOT NULL DEFAULT FALSE,
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
      start_at DATETIME NULL,
      live_trigger ENUM('AUTO', 'START_TIME', 'MANUAL') NULL,
      live_url VARCHAR(255) NULL,
      live_started_at DATETIME NULL,
      host_team_id BIGINT NULL,
      caster_user_id BIGINT NULL,
      lobby_opened_at DATETIME NULL,
      launch_pairing VARCHAR(48) NULL,
      launched_at DATETIME NULL,
      team1_ready_at DATETIME NULL,
      team2_ready_at DATETIME NULL,
      caster_ready_at DATETIME NULL,
      replay_url VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_matches_tournament (tournament_id),
      INDEX idx_bg_matches_status (status),
      INDEX idx_bg_matches_round (round_number),
      INDEX idx_bg_matches_phase (tournament_id, phase_id),
      INDEX idx_bg_matches_live (live_trigger, status),
      INDEX idx_bg_matches_caster (caster_user_id),
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
        REFERENCES bg_matches(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_matches_host_team FOREIGN KEY (host_team_id)
        REFERENCES bg_teams(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_matches_caster FOREIGN KEY (caster_user_id)
        REFERENCES bg_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}
