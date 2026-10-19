import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/** Notifications déjà envoyées. */
export async function createSentNotificationTables(db: Pool): Promise<void> {
  // Même motif dans les deux tables : la ligne est **réservée avant l'envoi**,
  // et c'est sa clé unique qui interdit le doublon — deux requêtes concurrentes
  // déclenchent toutes deux le balayage. `ON DELETE CASCADE` suit la manche : un
  // plateau régénéré efface ses matchs, donc ses réservations, et les nouvelles
  // repartent de zéro.

  // Ces deux-là, et elles seules, sont créées sous un `catch` muet : c'est le
  // contrat qu'`isMissingTableError` décrit et sur lequel les chemins de
  // notification s'appuient — une base où leur création a échoué reste debout,
  // et un rappel ou une alerte perdus valent mieux qu'un report de score en
  // erreur. Le replier a failli leur coûter cette propriété.
  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_match_reminders (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        match_id BIGINT NOT NULL,
        offset_key VARCHAR(8) NOT NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        start_at DATETIME NULL,
        UNIQUE KEY uniq_bg_match_reminders (match_id, offset_key),
        CONSTRAINT fk_bg_match_reminders_match FOREIGN KEY (match_id)
          REFERENCES bg_matches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les rappels se taisent.
  }

  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_referee_alerts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        match_id BIGINT NOT NULL,
        alert_key VARCHAR(32) NOT NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bg_referee_alerts (match_id, alert_key),
        CONSTRAINT fk_bg_referee_alerts_match FOREIGN KEY (match_id)
          REFERENCES bg_matches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les alertes se taisent.
  }

  // Notifications push (`lib/shared/push-notifications.ts`). Même contrat que
  // les rappels : un canal accessoire, créé sous un `catch` muet — une base où
  // elles manquent sert le site sans push, jamais une erreur.
  //
  // L'adresse d'un abonnement dépasse souvent 255 caractères : l'unicité porte
  // sur son empreinte SHA-256, pas sur la colonne elle-même.
  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_push_subscriptions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        endpoint_hash CHAR(64) NOT NULL,
        endpoint VARCHAR(1024) NOT NULL,
        p256dh VARCHAR(128) NOT NULL,
        auth VARCHAR(64) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_success_at DATETIME NULL,
        UNIQUE KEY uniq_bg_push_subscriptions_endpoint (endpoint_hash),
        KEY idx_bg_push_subscriptions_user (user_id),
        CONSTRAINT fk_bg_push_subscriptions_user FOREIGN KEY (user_id)
          REFERENCES bg_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : le push se tait.
  }

  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_push_topic_optouts (
        user_id BIGINT NOT NULL,
        topic VARCHAR(32) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, topic),
        CONSTRAINT fk_bg_push_topic_optouts_user FOREIGN KEY (user_id)
          REFERENCES bg_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : tous les sujets restent actifs.
  }

  // Réservation d'une notification de départ de match : une par match, par
  // appariement et par phase (`LOBBY`, `LAUNCHED`) — même mécanique que
  // `bg_match_reminders`, la clé unique interdit le doublon entre deux
  // balayages concurrents.
  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_match_start_notices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        match_id BIGINT NOT NULL,
        pairing VARCHAR(48) NOT NULL,
        phase VARCHAR(16) NOT NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bg_match_start_notices (match_id, pairing, phase),
        CONSTRAINT fk_bg_match_start_notices_match FOREIGN KEY (match_id)
          REFERENCES bg_matches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les départs se taisent.
  }

  // Réservation d'une annonce de live sur Discord (#live, `@everyone`) : une
  // par match et par affiche (`pairing` : les deux engagés sans ordre, `5:7`)
  // — `docs/features/LIVE_STREAMS.md`. Même mécanique :
  // la clé unique interdit qu'un balayage concurrent reposte.
  try {
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_live_announcements (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        match_id BIGINT NOT NULL,
        pairing VARCHAR(48) NOT NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        refused BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE KEY uniq_bg_live_announcements (match_id, pairing),
        CONSTRAINT fk_bg_live_announcements_match FOREIGN KEY (match_id)
          REFERENCES bg_matches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les lives ne sont pas annoncés.
  }
  try {
    // Une ligne par soirée d'annonces #live et par public (`everyone` pour la
    // chaîne officielle, `stream-viewer` sinon) : l'identifiant du message
    // Discord à modifier quand un autre match de la soirée passe à l'antenne,
    // et `silent` si ce message est parti sans mention (ses modifications n'en
    // écrivent pas), `notified` si un envoi qui notifie est parti vers le bot
    // (même d'issue incertaine), `closed` si son message a été supprimé de
    // #live (plus rien n'y est publié). Aucune donnée personnelle ; effacée un jour
    // après la fin de la soirée.
    await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_live_evenings (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        target VARCHAR(16) NOT NULL,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        window_end DATETIME NOT NULL,
        discord_message_id VARCHAR(20) NULL,
        silent BOOLEAN NOT NULL DEFAULT FALSE,
        notified BOOLEAN NOT NULL DEFAULT FALSE,
        closed BOOLEAN NOT NULL DEFAULT FALSE,
        KEY idx_bg_live_evenings_target (target, window_end)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les lives ne sont pas annoncés.
  }
}
