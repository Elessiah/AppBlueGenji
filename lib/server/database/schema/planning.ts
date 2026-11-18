import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/**
 * Planning des casts, prods et arbitres (`docs/features/CAST_PLANNING.md`).
 *
 * Tables neuves : leur `CREATE TABLE IF NOT EXISTS` les crée telles quelles sur
 * une base qui tourne, aucune entrée de `RECENT_SCHEMA_CHANGES` n'est due (une
 * colonne ajoutée **plus tard** à l'une d'elles s'y écrira, comme ailleurs).
 *
 * Une entrée du planning est un match (`match_id`) ou un tournoi entier
 * (`match_id` nul) ; `entry_key` (`m:<id>` / `t:<id>`) la nomme d'une seule
 * colonne pour la clé primaire — une colonne nulle ne fait pas doublon dans une
 * clé unique. Clés étrangères en cascade : un tournoi, un match ou un compte
 * effacé emporte ses lignes ; l'anonymisation d'un compte (qui garde sa ligne
 * `bg_users`) les efface à la main (`account-erasure.ts`). Les lignes d'une
 * entrée commencée depuis plus de 90 jours sont purgées chaque jour
 * (`lib/server/planning/retention.ts`).
 */
export async function createPlanningTables(db: Pool): Promise<void> {
  // Disponibilité d'un membre pour une entrée, par rôle tenu, et sa préférence
  // (« je veux ce match »).
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_planning_availability (
      entry_key VARCHAR(24) NOT NULL,
      user_id BIGINT NOT NULL,
      role ENUM('REFEREE', 'CASTER', 'PROD') NOT NULL,
      tournament_id BIGINT NOT NULL,
      match_id BIGINT NULL,
      status ENUM('AVAILABLE', 'UNAVAILABLE', 'PENDING') NOT NULL DEFAULT 'PENDING',
      preferred TINYINT(1) NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (entry_key, user_id, role),
      INDEX idx_bg_planning_availability_user (user_id),
      INDEX idx_bg_planning_availability_tournament (tournament_id),
      INDEX idx_bg_planning_availability_match (match_id),
      CONSTRAINT fk_bg_planning_availability_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_planning_availability_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_planning_availability_match FOREIGN KEY (match_id)
        REFERENCES bg_matches(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Attributions du planning : casters et prods de toute entrée, arbitre d'un
  // tournoi entier. L'arbitre d'un **match** vit dans `bg_matches.referee_user_id`
  // (le modèle de l'arbitre désigné, `MATCH_REFEREE.md`) : une ligne REFEREE
  // sur un match n'y est que la **provenance** d'une désignation faite par le
  // planning confirmée (`AUTO` confirmée, ou `MANUAL`). Une proposition
  // **provisoire** d'arbitre de match n'existe qu'ici : elle n'est posée sur
  // le match qu'à sa confirmation.
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_planning_assignments (
      entry_key VARCHAR(24) NOT NULL,
      user_id BIGINT NOT NULL,
      role ENUM('REFEREE', 'CASTER', 'PROD') NOT NULL,
      tournament_id BIGINT NOT NULL,
      match_id BIGINT NULL,
      source ENUM('AUTO', 'MANUAL') NOT NULL,
      reason ENUM('PREFERENCE', 'LOAD', 'MANUAL') NOT NULL,
      -- Proposition du calcul (\`AUTO\`) : provisoire (0) jusqu'à sa
      -- confirmation par le staff ; un choix du staff naît confirmé.
      confirmed TINYINT(1) NOT NULL DEFAULT 0,
      assigned_by_user_id BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (entry_key, user_id, role),
      INDEX idx_bg_planning_assignments_user (user_id),
      INDEX idx_bg_planning_assignments_tournament (tournament_id),
      INDEX idx_bg_planning_assignments_match (match_id),
      INDEX idx_bg_planning_assignments_by (assigned_by_user_id),
      CONSTRAINT fk_bg_planning_assignments_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_planning_assignments_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_planning_assignments_match FOREIGN KEY (match_id)
        REFERENCES bg_matches(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_planning_assignments_by FOREIGN KEY (assigned_by_user_id)
        REFERENCES bg_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Historique des attributions : chaque pose et chaque retrait, calculé ou
  // manuel. Un retrait **manuel** écarte ce membre de ce rôle de cette entrée
  // pour les calculs suivants (le choix du staff tient) ; l'historique sert
  // aussi de base aux désistements d'un lot ultérieur (`kind` s'étendra).
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_planning_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      entry_key VARCHAR(24) NOT NULL,
      user_id BIGINT NOT NULL,
      role ENUM('REFEREE', 'CASTER', 'PROD') NOT NULL,
      tournament_id BIGINT NOT NULL,
      match_id BIGINT NULL,
      kind ENUM('ASSIGNED', 'CONFIRMED', 'REMOVED') NOT NULL,
      source ENUM('AUTO', 'MANUAL') NOT NULL,
      actor_user_id BIGINT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      -- Le calcul lit les retraits manuels (REMOVED, MANUAL) des entrées du lot :
      -- l'index les trouve sans filtrer, ligne à ligne, toute l'histoire d'une entrée.
      INDEX idx_bg_planning_events_entry (entry_key, kind, source),
      INDEX idx_bg_planning_events_user (user_id),
      INDEX idx_bg_planning_events_actor (actor_user_id),
      INDEX idx_bg_planning_events_tournament (tournament_id),
      INDEX idx_bg_planning_events_match (match_id),
      CONSTRAINT fk_bg_planning_events_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_planning_events_actor FOREIGN KEY (actor_user_id)
        REFERENCES bg_users(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_planning_events_tournament FOREIGN KEY (tournament_id)
        REFERENCES bg_tournaments(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_planning_events_match FOREIGN KEY (match_id)
        REFERENCES bg_matches(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Caster « autonome » : il diffuse seul, sans prod. Posé par le caster
  // lui-même ou par le staff ; une ligne absente vaut « non ».
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_planning_profiles (
      user_id BIGINT NOT NULL PRIMARY KEY,
      solo_caster TINYINT(1) NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_bg_planning_profiles_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}
