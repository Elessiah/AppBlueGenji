import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/** Tournois multi-phases. */
export async function createPhaseTables(db: Pool): Promise<void> {
  await createTable(db, `
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

  await createTable(db, `
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
}
