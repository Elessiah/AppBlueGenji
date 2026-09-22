import "dotenv/config";
import mysql, { type ExecuteValues, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { isSchemaNoOpError } from "@/lib/server/mysql-errors";
import { createOnceGate, withMigrationLock } from "@/lib/server/migration-lock";
import { CONTACT_DISCORD_URL_KEY } from "@/lib/shared/contact";
import { DISCORD_INVITE_URL, SUPERSEDED_DISCORD_INVITE_URLS } from "@/lib/shared/discord";

/**
 * Paramètres liés d'une requête préparée.
 *
 * `mysql2` typait ses paramètres en `any` jusqu'en 3.23 : un tableau déclaré
 * `unknown[]` — la forme qu'on écrivait partout — passait sans rien dire. Depuis,
 * `execute` n'accepte plus qu'`ExecuteValues`, et les quatorze tableaux qui
 * construisent une requête à rallonge ne satisfaisaient plus la signature.
 *
 * L'alias vit ici plutôt que recopié dans les sept modules concernés : c'est
 * `database.ts` qui possède la couche MySQL, et le jour où le type amont change
 * de nom il n'y aura qu'un endroit à corriger. `import type` étant effacé à la
 * compilation, y recourir ne charge pas ce module.
 */
export type SqlParam = ExecuteValues;
export type SqlParams = SqlParam[];

let pool: Pool | null = null;
const migrationGate = createOnceGate();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/**
 * Le schéma, **tel qu'il est aujourd'hui** — et non l'histoire de la façon dont
 * on y est arrivé.
 *
 * Jusqu'ici ce module racontait cette histoire : une poignée de `CREATE TABLE`
 * d'origine, puis soixante-trois `ALTER TABLE` empilés au fil des
 * fonctionnalités, chacun dans son `try {} catch {}` parce qu'il devait
 * retomber en silence sur une base qui l'avait déjà subi. Personne ne pouvait
 * plus lire la définition d'une table sans parcourir mille lignes, l'ordre des
 * colonnes n'avait plus aucun rapport avec leur sens, et chaque démarrage
 * rejouait des conversions d'ENUM et des `UPDATE` de rattrapage sans objet
 * depuis des mois.
 *
 * **La contrepartie, à connaître avant de toucher à ce fichier.** Sur une base
 * qui existe déjà, `CREATE TABLE IF NOT EXISTS` ne fait *rien* : il ne rattrape
 * ni une colonne ni un index manquants. Replier les anciens `ALTER` dans les
 * `CREATE` n'est donc sans danger que parce que la production porte déjà le
 * schéma complet — elle a joué tous ces `ALTER`, un par un, avant cette
 * consolidation. Une base restée à une version antérieure n'est **pas**
 * rattrapée par ce fichier et doit être migrée à la main.
 *
 * **La règle pour la suite est donc inchangée** : un changement de schéma
 * s'écrit ici en **deux** endroits — dans le `CREATE TABLE`, pour les bases
 * neuves, *et* en `ALTER TABLE` tolérant dans la section « Migrations », pour
 * celles qui tournent. La section « Migrations » ci-dessous porte donc trois
 * choses, et rien d'autre :
 *
 * - `RECENT_SCHEMA_CHANGES`, les changements trop récents pour qu'on sache la
 *   production passée dessus — des **instructions entières**, pour que la règle
 *   vaille aussi bien pour un `ENUM` élargi ou un index posé que pour une
 *   colonne ajoutée ; à retirer un par un, une fois un déploiement constaté ;
 * - les deux `DROP COLUMN`, qui n'ont pas de pendant dans un `CREATE TABLE`
 *   puisqu'ils *retirent* ;
 * - `warnIfSchemaIsBehind`, qui **dit** au démarrage qu'une base n'a pas joué
 *   les `ALTER` repliés — la prémisse ci-dessus était jusqu'ici affirmée et
 *   jamais vérifiée.
 */
/**
 * Ce qu'on fait d'une migration qui a échoué : la **dire**, jamais l'avaler, et
 * ne jamais faire tomber le démarrage avec elle.
 *
 * Les trois issues possibles ne se valent pas, et le choix s'est fait contre les
 * deux autres :
 *
 * - **Avaler** (`catch {}`) laisse le schéma en arrière du code sans qu'aucune
 *   trace n'existe. Pour le retrait de l'adresse e-mail, c'est pire qu'un
 *   schéma en retard : les adresses restent, et plus rien ne les efface.
 * - **Relancer** fait 500 sur **toute** requête, `createOnceGate` n'ayant pas de
 *   mémoire de l'échec : la passe entière se rejoue à chaque appel, sans recul,
 *   pendant que les autres processus expirent sur le verrou nommé. Un
 *   dépassement de délai de verrou sur `bg_users` — la table la plus chaude du
 *   site — suffit à y entrer, et c'est un incident transitoire.
 * - **Journaliser et poursuivre**, ce que fait cette fonction. Le site reste
 *   debout, la migration se rejoue au prochain démarrage, et la panne est
 *   lisible là où on la cherche (`pm2 logs`, cf. `docs/DEPLOYMENT.md`).
 *
 * Le cas nominal — la colonne est déjà là, ou déjà partie — ne journalise rien :
 * il se produit à chaque démarrage, et une ligne par entrée noierait la seule
 * qui compte.
 */
function reportSchemaFailure(error: unknown, statement: string): void {
  // L'instruction est passée au prédicat : le même code MySQL ne dit pas la même
  // chose sur un `ADD COLUMN` et sur un `ADD INDEX` (voir `mysql-errors.ts`).
  if (isSchemaNoOpError(error, statement)) return;
  console.error(
    `[migrations] « ${statement} » a échoué — le schéma reste en arrière du code.`,
    error,
  );
}

async function runMigrations(db: Pool): Promise<void> {
  // ───────────────────────────────────────────────────────────────────────────
  // Comptes
  // ───────────────────────────────────────────────────────────────────────────

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
  // `visible_pseudo` survit sans lecteur : le pseudo n'est plus masquable (c'est
  // l'identité de base du joueur : brackets, rosters, feuilles de match), la
  // colonne est conservée pour ne pas casser les installs.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_users (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      pseudo VARCHAR(40) NOT NULL UNIQUE,
      avatar_url TEXT NULL,
      discord_id VARCHAR(40) NULL UNIQUE,
      discord_pseudo VARCHAR(64) NULL,
      discord_verified_at DATETIME NULL,
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
      open_to_recruitment TINYINT(1) NOT NULL DEFAULT 1,
      platform_roles_json JSON NULL,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

  // `handle` retient le **tag** saisi à la demande du code : la certification
  // enregistre celui qui a servi à la résolution, et non celui que le client
  // renvoie à la confirmation — c'est la ligne du défi qui porte la preuve.
  // `NULL` sur une demande faite par identifiant numérique.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_discord_login_challenges (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      discord_id VARCHAR(40) NOT NULL,
      handle VARCHAR(64) NULL,
      code_hash CHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      attempts INT NOT NULL DEFAULT 0,
      INDEX idx_bg_challenges_discord_id (discord_id),
      INDEX idx_bg_challenges_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ───────────────────────────────────────────────────────────────────────────
  // Équipes
  // ───────────────────────────────────────────────────────────────────────────

  // Trois sortes de lignes cohabitent ici : les **équipes** ordinaires, les
  // **fantômes** (`is_ghost`, créées par le staff pour remplir un plateau) et
  // les **entrées solo** (`solo_user_id`, un joueur engagé en tournoi
  // individuel). Ne jamais compter `bg_teams` sans filtrer
  // `solo_user_id IS NULL`.
  //
  // `solo_user_id` n'a **pas** de clé étrangère, volontairement : une
  // suppression de compte en cascade effacerait l'engagé, et avec lui
  // l'historique des matchs qui le référencent. L'unicité garantit « un joueur =
  // au plus une entrée solo ».
  //
  // `uniq_bg_teams_tag` est nommé : `mapTeamTagConflict` lit le **nom de
  // l'index** dans `ER_DUP_ENTRY` pour distinguer « sigle pris » de « nom pris »,
  // et `bg_teams` porte deux uniques. L'unicité MySQL ignore les `NULL` — autant
  // d'équipes sans sigle qu'on veut, et les entrées solo restent hors de
  // l'espace de noms sans une règle de plus.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_teams (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(60) NOT NULL UNIQUE,
      tag VARCHAR(4) NULL,
      logo_url TEXT NULL,
      description TEXT NULL,
      is_ghost TINYINT(1) NOT NULL DEFAULT 0,
      solo_user_id BIGINT NULL,
      deleted_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_bg_teams_tag (tag),
      UNIQUE KEY uniq_bg_teams_solo_user (solo_user_id)
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

  // ───────────────────────────────────────────────────────────────────────────
  // Tournois
  // ───────────────────────────────────────────────────────────────────────────

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
  await db.execute(`
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

  // `phase_id = 0` désigne un tournoi **sans phases**, ce qui laisse tous les
  // formats non multi-phases inchangés.
  //
  // `live_trigger IS NULL` est le marqueur « ce match n'est pas casté » ; un
  // match ne recopie jamais la chaîne de son tournoi (un streamer indépendant
  // peut le caster). L'index `idx_bg_matches_live` porte le balayage du bouton
  // « Regarder le live » de l'accueil, qui lirait sinon toute la table à chaque
  // chargement.
  await db.execute(`
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
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_matches_tournament (tournament_id),
      INDEX idx_bg_matches_status (status),
      INDEX idx_bg_matches_round (round_number),
      INDEX idx_bg_matches_phase (tournament_id, phase_id),
      INDEX idx_bg_matches_live (live_trigger, status),
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

  // ───────────────────────────────────────────────────────────────────────────
  // Classements des moteurs à rejeu
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Les trois tables suivantes sont des **résultats**, pas des accumulateurs :
  // chaque entretien les réécrit depuis l'historique des matchs. Seules les
  // décisions humaines y sont des *entrées* du rejeu — le seed initial et les
  // abandons (`status`, `forfeit_round` / `eliminated_round`).
  //
  // La clé primaire porte `phase_id` : une même équipe traverse plusieurs phases
  // d'un tournoi multi-format, et chacune a son classement.

  await db.execute(`
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

  await db.execute(`
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
  await db.execute(`
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
    await db.execute(`
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

  // ───────────────────────────────────────────────────────────────────────────
  // Tournois multi-phases
  // ───────────────────────────────────────────────────────────────────────────

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

  // ───────────────────────────────────────────────────────────────────────────
  // Notifications déjà envoyées
  // ───────────────────────────────────────────────────────────────────────────
  //
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
    await db.execute(`
      CREATE TABLE IF NOT EXISTS bg_match_reminders (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        match_id BIGINT NOT NULL,
        offset_key VARCHAR(8) NOT NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bg_match_reminders (match_id, offset_key),
        CONSTRAINT fk_bg_match_reminders_match FOREIGN KEY (match_id)
          REFERENCES bg_matches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {
    // Table déjà présente, ou création refusée : les rappels se taisent.
  }

  try {
    await db.execute(`
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

  // ───────────────────────────────────────────────────────────────────────────
  // Vitrine et association
  // ───────────────────────────────────────────────────────────────────────────

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

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_about_pillars (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(60) NOT NULL,
      text VARCHAR(240) NOT NULL,
      display_order INT NOT NULL DEFAULT 100,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_about_pillars_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_settings (
      setting_key VARCHAR(80) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

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

  // `domain` porte le **pôle de bénévolat** visé (recrutement du staff
  // associatif) et non un jeu : la page a changé d'objet en cours de route.
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

  // Une ligne = une visite. `visitor_key` est un SHA-256 salé : ni IP ni
  // user-agent ne sont stockés en clair. Pas de clé étrangère sur `user_id` —
  // une suppression de compte ne doit pas réécrire l'historique de
  // fréquentation, qui n'est qu'un comptage (le lien est détaché à la main,
  // cf. `deleteOwnAccount`).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_site_visits (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      visitor_key CHAR(64) NOT NULL,
      user_id BIGINT NULL,
      path VARCHAR(191) NOT NULL DEFAULT '/',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bg_site_visits_created_at (created_at),
      INDEX idx_bg_site_visits_visitor (visitor_key, created_at),
      INDEX idx_bg_site_visits_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ───────────────────────────────────────────────────────────────────────────
  // Migrations
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Ce que les `CREATE TABLE` ci-dessus ne font **pas** sur une base qui existe
  // déjà : un `CREATE TABLE IF NOT EXISTS` n'ajoute aucune colonne à une table
  // présente, il ne fait rien du tout. C'est la seconde moitié de la règle des
  // deux endroits (`docs/DATABASE_SCHEMA.md`), et la seule que voie la
  // production.
  //
  // **Ce qui est replié, et ce qui ne l'est pas.** Replier un `ALTER` dans son
  // `CREATE TABLE` n'est sans danger que si toute base vivante l'a déjà joué.
  // Les soixante-trois anciens remplissent cette condition. Les colonnes
  // ci-dessous sont les **récentes** — celles dont on ne peut pas affirmer que
  // le serveur les a vues passer —, et elles restent donc écrites aux deux
  // endroits. Le coût est nul : chaque entrée retombe en silence quand la
  // colonne est là, et le bloc ne fait rien sur une base neuve.
  //
  // La liste est faite pour **rétrécir** : une colonne dont un déploiement a
  // confirmé le passage se retire d'ici, sa définition restant dans la table.
  // Ce qu'il ne faut pas faire, c'est la retirer *par anticipation* — la panne
  // n'apparaît qu'au redémarrage, sur une requête qui nomme la colonne, et il
  // est alors trop tard pour la reposer sans interruption.
  // La liste porte des **instructions entières**, et non un triplet
  // table/colonne/définition. Un triplet ne sait dire qu'`ADD COLUMN`, si bien
  // que la règle des deux endroits ne pouvait pas s'appliquer à tout le reste :
  // élargir un `ENUM`, poser un index, recomposer une clé primaire, remplir une
  // colonne neuve. La prochaine valeur de `format` n'aurait existé que dans le
  // `CREATE TABLE`, et la base qui tourne aurait rendu « Data truncated for
  // column 'format' » sur le premier tournoi créé.
  const RECENT_SCHEMA_CHANGES: readonly string[] = [
    // PR #135 — certification du tag Discord.
    `ALTER TABLE bg_discord_login_challenges ADD COLUMN handle VARCHAR(64) NULL`,
    `ALTER TABLE bg_users ADD COLUMN discord_verified_at DATETIME NULL`,
    // PR #135 — conditions d'inscription.
    `ALTER TABLE bg_tournaments ADD COLUMN registration_discord_requirement
       ENUM('NONE', 'ANY_PLAYER', 'ALL_PLAYERS') NOT NULL DEFAULT 'ANY_PLAYER'`,
    `ALTER TABLE bg_tournaments ADD COLUMN registration_min_players INT NOT NULL DEFAULT 5`,
    // PR #136 — troisième porte d'entrée. `UNIQUE` posé avec la colonne : c'est
    // l'index qui tranche la course entre deux comptes rattachant le même
    // Battle.net, le `SELECT` préalable ne donnant que le refus lisible.
    `ALTER TABLE bg_users ADD COLUMN blizzard_sub VARCHAR(191) NULL UNIQUE`,
    // PR #137 — condition d'inscription « compte Blizzard ». Le défaut `NONE`
    // n'est pas une prudence de migration : c'est le défaut du réglage, la
    // moitié du site jouant à Marvel Rivals, où un compte Battle.net ne veut
    // rien dire.
    `ALTER TABLE bg_tournaments ADD COLUMN registration_blizzard_requirement
       ENUM('NONE', 'ANY_PLAYER', 'ALL_PLAYERS') NOT NULL DEFAULT 'NONE'`,
  ];

  for (const statement of RECENT_SCHEMA_CHANGES) {
    try {
      await db.execute(statement);
    } catch (error) {
      reportSchemaFailure(error, statement.replace(/\s+/g, " ").trim());
    }
  }

  // **Un retrait de colonne ne se replie pas.** Une colonne qui part n'a aucune
  // contrepartie dans un `CREATE TABLE` : elle y est simplement absente, si bien
  // qu'une table neuve ne la porte jamais et qu'une base existante la garde pour
  // toujours. Les deux ci-dessous restent donc ici quoi qu'il arrive, et elles
  // disent la même chose : une adresse que plus personne ne lit.
  //
  // Celle des annonces de recrutement a perdu son lecteur quand le contact est
  // passé en « AUTO / DISCORD / LIEN » — plus aucun écran ne la saisit ni ne
  // l'affiche.
  try {
    await db.execute(`ALTER TABLE bg_recruitment_ads DROP COLUMN contact_email`);
  } catch (error) {
    reportSchemaFailure(error, "ALTER TABLE bg_recruitment_ads DROP COLUMN contact_email");
  }

  // L'adresse e-mail n'a plus aucun lecteur — le scope `email` a disparu de la
  // demande faite à Google et un compte ne se revendique plus par son adresse
  // (`docs/features/OAUTH_PROVIDERS.md`). La colonne restait pourtant, et avec
  // elle les adresses collectées avant la règle : garder une donnée que plus
  // personne ne lit n'est pas de la prudence, c'est une fuite en attente. Elle
  // part donc de la table, ce qui efface les valeurs du même geste.
  //
  // **L'échec ne passe pas en silence**, et c'est ici qu'il compte le plus : le
  // `DROP` est le geste d'effacement lui-même. Rien ne lit plus la colonne, donc
  // la base démarre parfaitement sans lui — et `anonymizeOwnAccount` ne met plus
  // l'adresse à `NULL`, cette ligne n'ayant plus d'objet. Un `ALTER` refusé et
  // avalé garderait donc les adresses **indéfiniment**, y compris sur les
  // comptes qui ont demandé leur suppression, sans que rien ne le dise.
  try {
    await db.execute(`ALTER TABLE bg_users DROP COLUMN email`);
  } catch (error) {
    reportSchemaFailure(error, "ALTER TABLE bg_users DROP COLUMN email");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rattrapages permanents
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Deux filets, et non des migrations à cocher : leur cause peut se reproduire,
  // et ils sont donc **volontairement** rejoués à chaque démarrage. Tous deux
  // sont idempotents et ne trouvent rien à faire dans le cas nominal.

  // L'invitation Discord est une constante partout **sauf** en pied de page, où
  // elle est une donnée que le staff peut modifier (`contact_discord_url`).
  // Changer de serveur ne suffit donc pas à changer ce lien-là, et l'écran qui
  // l'affiche est justement celui qu'on ne relit jamais — la panne serait muette,
  // l'ancienne adresse menant toujours quelque part.
  //
  // Seules les adresses **périmées connues** sont remplacées : une invitation que
  // le staff a saisie lui appartient, et l'écraser à chaque démarrage ferait de
  // ce champ un leurre.
  try {
    const placeholders = SUPERSEDED_DISCORD_INVITE_URLS.map(() => "?").join(", ");
    await db.execute(
      `UPDATE bg_settings
          SET setting_value = ?
        WHERE setting_key = ?
          AND setting_value IN (${placeholders})`,
      [DISCORD_INVITE_URL, CONTACT_DISCORD_URL_KEY, ...SUPERSEDED_DISCORD_INVITE_URLS],
    );
  } catch {
    // Rattrapage remis au prochain démarrage.
  }

  // Le logo d'une entrée solo est une **copie** de l'avatar du joueur. Le
  // masquage posé dans `solo-entries-service` ne vaut que pour les écritures à
  // venir — la prochaine inscription ou édition de profil —, si bien qu'une ligne
  // déjà écrite continuerait de publier un avatar masqué, jusque sur la carte
  // « match en direct » de l'accueil que lit un visiteur sans compte. Le chemin
  // inverse (l'avatar redevient public) est tenu par `syncSoloEntryIdentity`.
  //
  // Le `try` n'est pas une formalité : c'est la seule instruction de cette passe
  // qui prenne des **verrous de ligne** sur une table chaude — `registerGhostTeams`
  // tient `bg_teams` sous `SELECT … FOR UPDATE` le temps de 32 insertions. Un lot
  // d'inscriptions qui chevauche un démarrage à froid rendrait
  // `ER_LOCK_WAIT_TIMEOUT`, et l'exception emporterait tout ce qui suit.
  try {
    await db.execute(`
      UPDATE bg_teams t
        JOIN bg_users u ON u.id = t.solo_user_id
         SET t.logo_url = NULL
       WHERE t.solo_user_id IS NOT NULL
         AND u.visible_avatar = 0
         AND t.logo_url IS NOT NULL
    `);
  } catch {
    // Rattrapage remis au prochain démarrage.
  }

  await warnIfSchemaIsBehind(db);
}

/**
 * Le **filet** de la consolidation : dire, au démarrage, qu'une base n'a pas
 * joué les `ALTER` qu'on a repliés.
 *
 * Tout ce fichier repose sur une prémisse — « la production porte déjà les
 * soixante-trois `ALTER` » — qui était jusqu'ici **affirmée et jamais
 * vérifiée**. Si elle est fausse d'une seule version, la base démarre sans
 * bruit (`CREATE TABLE IF NOT EXISTS` ne fait rien), et la panne se découvre en
 * production sur la première requête qui nomme une colonne absente. Une lecture
 * d'`information_schema` au démarrage change ce scénario en une ligne de log,
 * avant le premier visiteur.
 *
 * Les colonnes témoins sont prises dans le **dernier lot replié** — celui qui a
 * le plus de chances de manquer. En trouver une absente ne prouve pas que les
 * soixante-deux autres sont là, mais l'inverse est vrai : les migrations étant
 * jouées dans l'ordre, une base à jour sur le dernier lot l'est sur les
 * précédents.
 *
 * Elle **ne répare rien** et ne fait échouer personne : la réparation d'une base
 * en retard se fait à la main (`docs/DATABASE_SCHEMA.md`), et interrompre le
 * démarrage n'y aiderait pas — cela remplacerait un site dégradé par un site
 * éteint.
 */
async function warnIfSchemaIsBehind(db: Pool): Promise<void> {
  /**
   * Un témoin, et ce qu'on attend de lui.
   *
   * `expect` couvre une classe que la seule **présence** d'une colonne ne voit
   * pas : un `ALTER … MODIFY` replié. La conversion de `game` de
   * `ENUM('OW2','MR')` vers `ENUM('OW','MR')` est la plus récente des trois, et
   * une base restée avant elle porte bien la colonne — elle rendrait simplement
   * « Data truncated for column 'game' » au premier tournoi écrit.
   *
   * `absent` couvre la classe symétrique : une colonne qui devait **partir**. Le
   * retrait de `bg_users.email` est au mieux best-effort — un dépassement de
   * délai de verrou suffit à le manquer — et il n'est jamais rejoué dans le
   * processus, la porte mémorisant une passe qui se résout désormais toujours.
   * Or plus rien d'autre n'efface ces adresses : `anonymizeOwnAccount` a perdu
   * son `email = NULL` dans la même version.
   */
  type Witness = {
    table: string;
    column: string;
    /** Fragment attendu dans `COLUMN_TYPE`, pour un type replié par `MODIFY`. */
    expect?: string;
    /** La colonne devait disparaître : la trouver **est** l'anomalie. */
    absent?: true;
  };

  // Une entrée par lot replié, la plus récente d'abord.
  const WITNESSES: readonly Witness[] = [
    { table: "bg_users", column: "email", absent: true },
    { table: "bg_tournaments", column: "game", expect: "'OW'" },
    { table: "bg_tournaments", column: "match_format_max_maps" },
    { table: "bg_tournaments", column: "endurance_playoff_format_type" },
    { table: "bg_matches", column: "phase_id" },
  ];

  try {
    const [rows] = await db.execute<
      (RowDataPacket & { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string })[]
    >(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (TABLE_NAME, COLUMN_NAME) IN (${WITNESSES.map(() => "(?, ?)").join(", ")})`,
      WITNESSES.flatMap((w) => [w.table, w.column]),
    );
    const found = new Map(rows.map((r) => [`${r.TABLE_NAME}.${r.COLUMN_NAME}`, r.COLUMN_TYPE]));

    const gaps: string[] = [];
    for (const witness of WITNESSES) {
      const name = `${witness.table}.${witness.column}`;
      const type = found.get(name);
      if (witness.absent) {
        if (type !== undefined) {
          gaps.push(`${name} devrait avoir disparu (les adresses y sont encore)`);
        }
      } else if (type === undefined) {
        gaps.push(`${name} manque`);
      } else if (witness.expect && !type.includes(witness.expect)) {
        gaps.push(`${name} est resté « ${type} », sans ${witness.expect}`);
      }
    }

    // Les **index** ne se lisent pas dans `COLUMNS`, et leur absence est la plus
    // silencieuse de toutes : une colonne manquante fait tomber la requête qui
    // la nomme, un index unique manquant ne fait **rien** — il cesse simplement
    // de trancher la course qu'il existe pour trancher. `mapTeamTagConflict`
    // continuerait de traduire un `ER_DUP_ENTRY` qui n'arrive plus jamais, et
    // deux équipes créées au même instant prendraient le même sigle.
    //
    // L'argument « les migrations sont jouées dans l'ordre » ne les couvre pas :
    // chaque ancien `ALTER` était tolérant **indépendamment**, et celui-ci
    // pouvait échouer de façon déterministe sur des données (des doublons à
    // libérer d'abord) pendant que les suivants passaient.
    const INDEX_WITNESSES: readonly (readonly [string, string])[] = [
      ["bg_teams", "uniq_bg_teams_tag"],
      ["bg_teams", "uniq_bg_teams_solo_user"],
    ];
    const [indexRows] = await db.execute<(RowDataPacket & { INDEX_NAME: string })[]>(
      `SELECT DISTINCT INDEX_NAME
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (TABLE_NAME, INDEX_NAME) IN (${INDEX_WITNESSES.map(() => "(?, ?)").join(", ")})`,
      INDEX_WITNESSES.flatMap(([table, index]) => [table, index]),
    );
    const indexes = new Set(indexRows.map((r) => r.INDEX_NAME));
    for (const [table, index] of INDEX_WITNESSES) {
      if (!indexes.has(index)) gaps.push(`l'index ${index} manque sur ${table}`);
    }

    if (gaps.length > 0) {
      console.error(
        `[migrations] Cette base est en retard sur le schéma : ${gaps.join(" ; ")}. ` +
          `Les ALTER concernés ont été repliés dans les CREATE TABLE, qui ne rattrapent ` +
          `rien sur une base existante — il faut la migrer à la main (docs/DATABASE_SCHEMA.md).`,
      );
    }
  } catch {
    // Le filet ne doit jamais devenir la panne : une base qui refuse
    // `information_schema` reste servie comme avant.
  }
}

/**
 * Joue le schéma une fois par processus, et une seule à la fois sur la base.
 *
 * Les deux garanties viennent de `migration-lock` : la porte oublie ses échecs
 * (une migration ratée ne condamne plus le processus jusqu'au redémarrage) et le
 * verrou nommé empêche deux processus d'exécuter les mêmes `ALTER TABLE` en même
 * temps, ce dont MySQL faisait un interblocage.
 */
async function ensureMigrations(db: Pool): Promise<void> {
  await migrationGate.run(() => withMigrationLock(db, () => runMigrations(db)));
}

/**
 * Emprunte une connexion du pool le temps d'une lecture, puis la rend — quoi
 * qu'il arrive.
 *
 * Le pool ne compte que 25 places : un `release()` oublié sur un chemin d'erreur
 * les épuise en silence, et le site se fige sans rien dire. Passer par ce
 * helper plutôt que d'écrire son propre `try` / `finally` supprime la question.
 */
export async function withConnection<T>(
  run: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    return await run(connection);
  } finally {
    connection.release();
  }
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
