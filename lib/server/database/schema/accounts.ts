import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/** Comptes : `bg_users` et les tables qui en dépendent directement. */
export async function createAccountTables(db: Pool): Promise<void> {
  // Les trois portes d'entrée du site (`google_sub`, `discord_id`,
  // `blizzard_sub`) sont des colonnes **uniques** de cette table plutôt qu'une
  // table d'identités : un compte n'a qu'une identité par fournisseur, et c'est
  // l'unicité qui tranche la course entre deux comptes qui rattacheraient la
  // même identité au même instant (le `SELECT` préalable ne donne que le refus
  // lisible). Aucune adresse e-mail : le site n'en demande plus à personne.
  //
  // `discord_verified_at` ne dit pas « ce compte a un Discord » — `discord_id`
  // le dit — mais « le tag de `discord_pseudo` a été prouvé par son titulaire »,
  // ce qui se perd à chaque modification du tag.
  //
  // `discord_link_method` dit une **troisième** chose, et la seule des trois qui
  // parle du fournisseur plutôt que du compte : sur quoi le rattachement repose
  // — un aller-retour OAuth, qui laisse une autorisation d'application chez
  // Discord, ou le code reçu en message privé, qui n'en laisse aucune. `NULL`
  // sur les rattachements antérieurs à la colonne : ils ne se classent pas après
  // coup (`lib/shared/account-connections.ts`).
  //
  // `discord_pseudo_from_discord` dit d'où vient `discord_pseudo` : `1` quand
  // Discord l'a nommé (connexion, rattachement, code reçu), `0` pour une saisie.
  // C'est la condition de la certification **en un clic** d'un compte rattaché
  // (`certifyLinkedDiscordTag`) : on n'y certifie jamais ce qu'un joueur a tapé.
  //
  // `visible_pseudo` survit sans lecteur : le pseudo n'est plus masquable (c'est
  // l'identité de base du joueur : brackets, rosters, feuilles de match), la
  // colonne est conservée pour ne pas casser les installs.
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_users (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      pseudo VARCHAR(40) NOT NULL UNIQUE,
      avatar_url TEXT NULL,
      discord_id VARCHAR(40) NULL UNIQUE,
      discord_pseudo VARCHAR(64) NULL,
      discord_verified_at DATETIME NULL,
      discord_link_method ENUM('DM_CODE', 'OAUTH') NULL,
      discord_pseudo_from_discord TINYINT(1) NOT NULL DEFAULT 0,
      google_sub VARCHAR(191) NULL UNIQUE,
      blizzard_sub VARCHAR(191) NULL UNIQUE,
      is_adult TINYINT(1) NULL DEFAULT NULL,
      overwatch_battletag VARCHAR(64) NULL,
      marvel_rivals_tag VARCHAR(64) NULL,
      visible_avatar TINYINT(1) NOT NULL DEFAULT 1,
      visible_pseudo TINYINT(1) NOT NULL DEFAULT 1,
      visible_overwatch TINYINT(1) NOT NULL DEFAULT 0,
      visible_marvel TINYINT(1) NOT NULL DEFAULT 0,
      visible_major TINYINT(1) NOT NULL DEFAULT 0,
      visible_discord TINYINT(1) NOT NULL DEFAULT 0,
      open_to_recruitment TINYINT(1) NOT NULL DEFAULT 0,
      platform_roles_json JSON NULL,
      terms_version INT NULL,
      terms_accepted_at DATETIME NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await createTable(db, `
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

  // `handle` retient le **tag** saisi à la demande du code : la certification
  // enregistre celui qui a servi à la résolution, et non celui que le client
  // renvoie à la confirmation — c'est la ligne du défi qui porte la preuve.
  // `NULL` sur une demande faite par identifiant numérique.
  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_discord_login_challenges (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      discord_id VARCHAR(40) NOT NULL,
      lookup_hash CHAR(64) NULL,
      handle VARCHAR(64) NULL,
      code_hash CHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      attempts INT NOT NULL DEFAULT 0,
      INDEX idx_bg_challenges_discord_id (discord_id),
      INDEX idx_bg_challenges_expires_at (expires_at),
      UNIQUE INDEX uniq_bg_challenges_lookup (lookup_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}
