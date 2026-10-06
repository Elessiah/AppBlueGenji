import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/**
 * Vitrine et association : les `CREATE TABLE`, joués dans cet ordre. Une liste
 * plutôt qu'une suite d'appels identiques — chaque entrée garde son commentaire.
 */
const SHOWCASE_TABLES: readonly string[] = [
  `
      CREATE TABLE IF NOT EXISTS bg_sponsors (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      tier ENUM('GOLD', 'SILVER', 'BRONZE', 'PARTNER') NOT NULL DEFAULT 'PARTNER',
      logo_url TEXT NULL,
      banner_url VARCHAR(255) NULL,
      website_url TEXT NULL,
      description TEXT NULL,
      description_en TEXT NULL,
      display_order INT NOT NULL DEFAULT 100,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_sponsors_active_order (active, display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  `
      CREATE TABLE IF NOT EXISTS bg_bureau_members (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      role VARCHAR(120) NOT NULL,
      role_en VARCHAR(120) NULL,
      initials VARCHAR(4) NOT NULL,
      color VARCHAR(40) NOT NULL,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_bureau_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  `
      CREATE TABLE IF NOT EXISTS bg_about_stats (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      value VARCHAR(40) NOT NULL,
      label VARCHAR(60) NOT NULL,
      label_en VARCHAR(60) NULL,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_about_stats_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  `
      CREATE TABLE IF NOT EXISTS bg_about_pillars (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(60) NOT NULL,
      text VARCHAR(240) NOT NULL,
      title_en VARCHAR(60) NULL,
      text_en VARCHAR(240) NULL,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_about_pillars_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  `
      CREATE TABLE IF NOT EXISTS bg_settings (
      setting_key VARCHAR(80) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  `
      CREATE TABLE IF NOT EXISTS bg_benevoles (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(80) NOT NULL,
      pseudo VARCHAR(80) NULL,
      last_name VARCHAR(80) NOT NULL,
      category VARCHAR(120) NOT NULL,
      category_en VARCHAR(120) NULL,
      photo_url VARCHAR(500) NULL,
      joined_at DATE NOT NULL,
      display_order INT NOT NULL DEFAULT 100,
      category_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_benevoles_category (category),
      INDEX idx_bg_benevoles_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // `domain` porte le **pôle de bénévolat** visé (recrutement du staff
  // associatif) et non un jeu : la page a changé d'objet en cours de route.
  `
      CREATE TABLE IF NOT EXISTS bg_recruitment_ads (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(140) NOT NULL,
      title_en VARCHAR(140) NULL,
      team_name VARCHAR(120) NULL,
      domain ENUM('ARBITRAGE', 'CASTING', 'DEV', 'COMMUNICATION', 'DESIGN', 'MODERATION', 'EVENEMENTIEL', 'ADMIN', 'AUTRE') NOT NULL DEFAULT 'AUTRE',
      roles VARCHAR(200) NULL,
      roles_en VARCHAR(200) NULL,
      body TEXT NULL,
      body_en TEXT NULL,
      contact_url VARCHAR(2048) NULL,
      contact_discord VARCHAR(120) NULL,
      contact_discord_id VARCHAR(32) NULL,
      contact_preferred ENUM('AUTO', 'DISCORD', 'LINK') NOT NULL DEFAULT 'AUTO',
      priority ENUM('PRIORITY', 'IMPORTANT', 'OPTIONAL') NOT NULL DEFAULT 'OPTIONAL',
      active TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_recruitment_active_order (active, display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,
];

/** Vitrine et association. */
export async function createShowcaseTables(db: Pool): Promise<void> {
  for (const ddl of SHOWCASE_TABLES) await createTable(db, ddl);
}
