import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/** Classements des moteurs à rejeu. */
export async function createReplayStandingTables(db: Pool): Promise<void> {
  // Les trois tables suivantes sont des **résultats**, pas des accumulateurs :
  // chaque entretien les réécrit depuis l'historique des matchs. Seules les
  // décisions humaines y sont des *entrées* du rejeu — le seed initial et les
  // abandons (`status`, `forfeit_round` / `eliminated_round`).
  //
  // La clé primaire porte `phase_id` : une même équipe traverse plusieurs phases
  // d'un tournoi multi-format, et chacune a son classement.

  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_swiss_standings (
      tournament_id BIGINT NOT NULL,
      phase_id BIGINT NOT NULL DEFAULT 0,
      team_id BIGINT NOT NULL,
      seed INT NOT NULL DEFAULT 0,
      points INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0,
      draws INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      byes INT NOT NULL DEFAULT 0,
      opponent_ids_json JSON NOT NULL,
      buchholz DECIMAL(6, 2) NOT NULL DEFAULT 0,
      status ENUM('ACTIVE', 'FORFEIT') NOT NULL DEFAULT 'ACTIVE',
      forfeit_round INT NULL,
      \`rank\` INT NOT NULL DEFAULT 0,
      PRIMARY KEY (tournament_id, phase_id, team_id),
      CONSTRAINT fk_swiss_standings_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_swiss_standings_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_survival_standings (
      tournament_id BIGINT NOT NULL,
      phase_id BIGINT NOT NULL DEFAULT 0,
      team_id BIGINT NOT NULL,
      seed INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      status ENUM('ACTIVE', 'ELIMINATED', 'FORFEIT') NOT NULL DEFAULT 'ACTIVE',
      eliminated_round INT NULL,
      \`rank\` INT NOT NULL DEFAULT 0,
      PRIMARY KEY (tournament_id, phase_id, team_id),
      CONSTRAINT fk_survival_standings_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_survival_standings_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // `OUT_OF_CONTENTION` (« hors course ») n'est pas `ELIMINATED` : l'équipe
  // garde son capital mais ne peut plus mathématiquement rejoindre les
  // play-offs. « Éliminée » à côté de neuf points serait un contresens.
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_endurance_standings (
      tournament_id BIGINT NOT NULL,
      team_id BIGINT NOT NULL,
      seed INT NOT NULL DEFAULT 0,
      points INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      draws INT NOT NULL DEFAULT 0,
      status ENUM('ACTIVE', 'ELIMINATED', 'OUT_OF_CONTENTION', 'FORFEIT') NOT NULL DEFAULT 'ACTIVE',
      eliminated_round INT NULL,
      \`rank\` INT NOT NULL DEFAULT 0,
      PRIMARY KEY (tournament_id, team_id),
      CONSTRAINT fk_endurance_standings_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_endurance_standings_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Une table à part, et non une colonne de plus sur `bg_endurance_standings` :
  // une pénalité est une **entrée** du rejeu, au même titre qu'un abandon, et un
  // cumul rangé dans un classement réécrit à chaque entretien serait effacé au
  // premier score corrigé. La ligne porte sa manche, ce qui la place dans la
  // chronologie du tournoi. L'auteur s'efface en `NULL` sans emporter la
  // sanction : le compte s'en va, la sanction reste due.
  // Créée sous un `catch` muet comme les deux tables de notification :
  // `tournaments/deletion.ts` et `tournaments/rollback.ts` citent cette
  // tolérance pour s'accommoder d'une table absente. La retirer ici rendrait
  // leur garde morte et ferait tomber le démarrage sur une table accessoire.
  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_endurance_penalties (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tournament_id BIGINT NOT NULL,
        team_id BIGINT NOT NULL,
        round_number INT NOT NULL,
        points INT NOT NULL,
        reason VARCHAR(255) NOT NULL,
        created_by BIGINT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_bg_endurance_penalties_tournament (tournament_id),
        CONSTRAINT fk_bg_endurance_penalties_tournament FOREIGN KEY (tournament_id)
          REFERENCES bg_tournaments(id) ON DELETE CASCADE,
        CONSTRAINT fk_bg_endurance_penalties_team FOREIGN KEY (team_id)
          REFERENCES bg_teams(id) ON DELETE CASCADE,
        CONSTRAINT fk_bg_endurance_penalties_author FOREIGN KEY (created_by)
          REFERENCES bg_users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les sanctions se taisent.
  }
}
