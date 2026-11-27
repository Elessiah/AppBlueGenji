import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/**
 * Annonces GETI (`docs/features/GETI_INFO.md`) : le miroir des annonces de
 * recrutement Overwatch publiées dans six salons de notre serveur Discord.
 */
export async function createGetiTables(db: Pool): Promise<void> {
  try {
    // Une ligne par message Discord : le message brut tel que le bot l'a
    // poussé (`raw_json`, borné), son analyse à l'écriture (`parsed_json`,
    // `parseGetiPost`), le pseudo et l'identifiant Discord de l'auteur. Aucun
    // lien avec un compte du site. Retirée dès que le message est supprimé sur
    // Discord, et quatorze jours après sa publication par la purge horaire
    // (`purgeExpiredGetiPosts`).
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_geti_posts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        message_id VARCHAR(22) NOT NULL,
        channel_id VARCHAR(22) NOT NULL,
        category VARCHAR(8) NOT NULL,
        author_id VARCHAR(22) NULL,
        author_tag VARCHAR(40) NULL,
        raw_json MEDIUMTEXT NOT NULL,
        parsed_json MEDIUMTEXT NOT NULL,
        posted_at DATETIME NOT NULL,
        edited_at DATETIME NULL,
        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bg_geti_posts_message (message_id),
        KEY idx_bg_geti_posts_category (category, posted_at),
        KEY idx_bg_geti_posts_channel (channel_id, posted_at),
        KEY idx_bg_geti_posts_posted (posted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les routes du bot répondent GETI_UNAVAILABLE.
  }
}
