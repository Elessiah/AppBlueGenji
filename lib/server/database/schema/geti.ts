import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/**
 * Annonces GETI (`docs/features/GETI_INFO.md`) : le miroir des annonces de
 * recrutement Overwatch publiées dans six salons de notre serveur Discord.
 */
export async function createGetiTables(db: Pool): Promise<void> {
  try {
    // Une ligne par message Discord — annonce écrite directement dans le salon
    // (`source` = `direct`) ou relayée par GETI Bot (`relay`) : le message brut
    // tel que le bot l'a poussé (`raw_json`, borné), son analyse à l'écriture
    // (`parsed_json`, `parseGetiPost`), le pseudo et l'identifiant Discord de
    // l'auteur. Aucun lien avec un compte du site. Retirée dès que le message
    // est supprimé sur Discord, et au bout de la durée de garde de sa catégorie
    // (7 jours pour un scrim, 14 sinon) par la purge horaire
    // (`purgeExpiredGetiPosts`).
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_geti_posts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        message_id VARCHAR(22) NOT NULL,
        channel_id VARCHAR(22) NOT NULL,
        category VARCHAR(8) NOT NULL,
        source VARCHAR(8) NOT NULL DEFAULT 'relay',
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
        KEY idx_bg_geti_posts_posted (posted_at),
        KEY idx_bg_geti_posts_author (author_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les routes du bot répondent GETI_UNAVAILABLE.
  }

  try {
    // Oppositions (RGPD, art. 21 — `lib/server/geti/objections.ts`) : un auteur
    // (`kind` = `author`, son identifiant Discord) ou un message (`message`)
    // dont les annonces ne sont plus recopiées. Celle d'un auteur tient jusqu'à
    // sa levée ; celle d'un message part avec la purge horaire, passée la plus
    // longue durée de garde.
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_geti_objections (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        kind VARCHAR(8) NOT NULL,
        target_id VARCHAR(22) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bg_geti_objections_target (kind, target_id),
        KEY idx_bg_geti_objections_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table absente : l'écriture d'un lot échoue (GETI_UNAVAILABLE, le bot réessaie) plutôt que de
    // recopier une annonce sans savoir si son auteur s'y est opposé.
  }

  // Alertes sur une recherche (`docs/features/GETI_INFO.md` § Alertes) : la
  // catégorie et les filtres qu'un compte veut suivre (`search`, forme
  // canonique de l'adresse de la page), un nom facultatif, la pause, et
  // l'instant de la dernière notification (au plus une par alerte toutes les
  // dix minutes). Effacées par le compte, ou avec lui.
  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_geti_alerts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        category VARCHAR(8) NOT NULL,
        name VARCHAR(60) NULL,
        search VARCHAR(600) NOT NULL DEFAULT '',
        paused TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_notified_at DATETIME NULL,
        KEY idx_bg_geti_alerts_user (user_id),
        KEY idx_bg_geti_alerts_category (category, paused),
        CONSTRAINT fk_bg_geti_alerts_user FOREIGN KEY (user_id)
          REFERENCES bg_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : la page se rend sans alertes.
  }

  // Une ligne par couple (alerte, annonce) déjà vu : une alerte ne prévient
  // jamais deux fois pour la même annonce (modification, rattrapage du bot).
  // Purgée au-delà de la plus longue durée de garde d'une annonce.
  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_geti_alert_hits (
        alert_id BIGINT NOT NULL,
        message_id VARCHAR(22) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (alert_id, message_id),
        KEY idx_bg_geti_alert_hits_created (created_at),
        CONSTRAINT fk_bg_geti_alert_hits_alert FOREIGN KEY (alert_id)
          REFERENCES bg_geti_alerts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : aucune alerte ne part.
  }
}
