import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/**
 * Conformité et modération : journaux légaux, visites, information RGPD,
 * conditions d'utilisation, signalements, quarantaines et suspensions — les
 * `CREATE TABLE`, joués dans cet ordre.
 */
const COMPLIANCE_TABLES: readonly string[] = [
  // Journal des données de connexion (obligation légale de l'hébergeur, LCEN
  // art. 6 — `lib/shared/connection-logs.ts`) : une ligne par ouverture de
  // session, gardée un an. **Pas de clé étrangère sur `user_id`**, et c'est la
  // règle : la ligne doit survivre à la suppression du compte jusqu'à son
  // échéance (RGPD art. 17.3.b). Table neuve, donc créée telle quelle sur une
  // base qui tourne — aucune entrée de migration n'est due.
  `
      CREATE TABLE IF NOT EXISTS bg_connection_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      event_type VARCHAR(32) NOT NULL,
      ip VARCHAR(45) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bg_connection_logs_created_at (created_at),
      INDEX idx_bg_connection_logs_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Une ligne = une visite. `visitor_key` est un SHA-256 salé : ni IP ni
  // user-agent ne sont stockés en clair. Pas de clé étrangère sur `user_id` —
  // une suppression de compte ne doit pas réécrire l'historique de
  // fréquentation, qui n'est qu'un comptage (le lien est détaché à la main,
  // cf. `deleteOwnAccount`).
  `
      CREATE TABLE IF NOT EXISTS bg_site_visits (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      visitor_key CHAR(64) NOT NULL,
      authenticated TINYINT(1) NOT NULL DEFAULT 0,
      path VARCHAR(191) NOT NULL DEFAULT '/',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bg_site_visits_created_at (created_at),
      INDEX idx_bg_site_visits_visitor (visitor_key, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Le détail ci-dessus n'est gardé que `SITE_VISIT_DETAIL_RETENTION_DAYS`
  // jours : les totaux « depuis toujours » vivent dans ces deux tables, qui ne
  // gardent ni page ni heure. Un jour révolu devient une ligne de compteur ; un
  // visiteur, une empreinte — c'est le seul moyen de compter les visiteurs
  // uniques depuis la mise en service sans relire tout l'historique.
  `
      CREATE TABLE IF NOT EXISTS bg_site_visit_days (
      day DATE PRIMARY KEY,
      visits INT UNSIGNED NOT NULL DEFAULT 0,
      first_visit_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,
  `
      CREATE TABLE IF NOT EXISTS bg_site_visitors (
      visitor_key CHAR(64) PRIMARY KEY,
      authenticated TINYINT(1) NOT NULL DEFAULT 0,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bg_site_visitors_last_seen (last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Changements du traitement des données (`lib/shared/privacy-changes.ts`) :
  // une ligne par changement **dont le joueur a pris connaissance**, avec sa
  // date — la trace de l'information, que l'export RGPD rend au joueur
  // (`accepted_at` garde son nom d'origine : aucun accord n'est demandé). Le registre vit dans le
  // code, pas en base : `change_id` n'a donc pas de clé étrangère.
  `
      CREATE TABLE IF NOT EXISTS bg_privacy_acknowledgments (
      user_id BIGINT NOT NULL,
      change_id VARCHAR(80) NOT NULL,
      accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, change_id),
      CONSTRAINT fk_bg_privacy_ack_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Annonce Discord de ces changements, **réservée avant l'envoi** : la clé
  // primaire est ce qui interdit le doublon entre deux balayages concurrents
  // (`lib/server/privacy-change-notifications.ts`).
  `
      CREATE TABLE IF NOT EXISTS bg_privacy_change_notifications (
      user_id BIGINT NOT NULL,
      change_id VARCHAR(80) NOT NULL,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, change_id),
      CONSTRAINT fk_bg_privacy_notif_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Acceptations des conditions d'utilisation (`lib/shared/terms-of-use.ts`) :
  // une ligne par acceptation, avec la version et l'écran où elle a été donnée.
  // `bg_users.terms_version` n'en garde que la dernière — c'est elle qu'on
  // consulte avant un geste de gestion ; cette table est la **preuve**.
  `
      CREATE TABLE IF NOT EXISTS bg_terms_acceptances (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      version INT NOT NULL,
      context ENUM('SIGNUP', 'LOGIN', 'TEAM_CREATION', 'TEAM_MANAGEMENT') NOT NULL,
      accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bg_terms_acceptances_user (user_id),
      CONSTRAINT fk_bg_terms_acceptances_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Signalements adressés à l'association (`lib/shared/content-reports.ts`).
  // Le signalant peut être anonyme : `reporter_user_id` est facultatif, et
  // **détaché** si son compte disparaît — le signalement reste à traiter.
  // `resolved_at` fixe l'effacement (`REPORT_RETENTION_DAYS_AFTER_RESOLUTION`),
  // d'où l'index sur le couple que la purge balaie. Une contestation
  // (`CONTEST`) pend à son signalement d'origine (`parent_report_id`) et part
  // avec lui : elle n'a pas de sens seule.
  `
      CREATE TABLE IF NOT EXISTS bg_reports (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      category ENUM('COPYRIGHT', 'MODERATION', 'BUG', 'RGPD', 'HOSTING', 'OTHER', 'CONTEST') NOT NULL,
      status ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
      parent_report_id BIGINT NULL,
      -- Contestation seulement : qui conteste, jugé à l'écriture
      -- (canContestReport) — une personne visée défend une image, l'auteur
      -- du signalement non. NULL : contestation d'avant la colonne, toutes
      -- posées par une personne visée.
      contest_role ENUM('TARGET', 'NOTIFIER') NULL,
      description TEXT NOT NULL,
      page_path VARCHAR(300) NULL,
      reporter_user_id BIGINT NULL,
      contact_name VARCHAR(120) NULL,
      contact_email VARCHAR(191) NULL,
      rights_relation ENUM('HOLDER', 'AGENT', 'THIRD_PARTY') NULL,
      -- NULL : catégorie traitée par obligation légale, sans case d'accord
      -- (legalBasis de la catégorie, lib/shared/content-reports.ts).
      consent_at DATETIME NULL,
      assignee_user_id BIGINT NULL,
      resolution_note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      resolved_at DATETIME NULL,
      INDEX idx_bg_reports_status (status, resolved_at),
      INDEX idx_bg_reports_created (created_at),
      INDEX idx_bg_reports_parent (parent_report_id),
      CONSTRAINT fk_bg_reports_parent FOREIGN KEY (parent_report_id)
        REFERENCES bg_reports(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_reports_reporter FOREIGN KEY (reporter_user_id)
        REFERENCES bg_users(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_reports_assignee FOREIGN KEY (assignee_user_id)
        REFERENCES bg_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Ce qu'un signalement désigne. **Aucune clé étrangère vers la cible** : une
  // équipe dissoute ou un compte effacé ne doivent pas emporter le signalement
  // qui les visait. Le libellé est relevé à l'envoi pour la même raison — le
  // panneau dit encore de quoi il s'agissait quand la fiche n'existe plus.
  // `notified_at` : instant où la cible a été prévenue, `NULL` si rien ne lui a
  // été envoyé (tournoi, cible déjà prévenue, auteur retenu par son plafond).
  `
      CREATE TABLE IF NOT EXISTS bg_report_targets (
      report_id BIGINT NOT NULL,
      target_type ENUM('USER', 'TEAM', 'TOURNAMENT') NOT NULL,
      target_id BIGINT NOT NULL,
      label_snapshot VARCHAR(191) NULL,
      notified_at DATETIME NULL,
      PRIMARY KEY (report_id, target_type, target_id),
      INDEX idx_bg_report_targets_target (target_type, target_id),
      CONSTRAINT fk_bg_report_targets_report FOREIGN KEY (report_id)
        REFERENCES bg_reports(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Logos d'équipe masqués après un signalement (`lib/shared/logo-quarantine.ts`).
  // Le fichier quitte `public/uploads` pour `data/quarantine` — il n'est plus
  // servi — et la ligne dit d'où il vient pour le rétablir tel quel, ou quand le
  // supprimer définitivement. La ligne survit à la purge du signalement
  // (`SET NULL`) : c'est elle qui porte l'échéance.
  // `team_id` / `user_id` : mutuellement exclusifs, sans colonne « type » à
  // côté — même principe que `bg_teams.solo_user_id`, qui distingue déjà une
  // entrée solo d'une équipe réelle sans énumération à tenir à jour. Une ligne
  // masque le logo d'une équipe (`team_id` posé) ou l'avatar d'un joueur
  // (`user_id` posé) ; jamais les deux, jamais aucun.
  `
      CREATE TABLE IF NOT EXISTS bg_logo_quarantines (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      team_id BIGINT NULL,
      user_id BIGINT NULL,
      report_id BIGINT NULL,
      logo_url TEXT NOT NULL,
      status ENUM('HIDDEN', 'RESTORED', 'PURGED') NOT NULL DEFAULT 'HIDDEN',
      hidden_by_user_id BIGINT NULL,
      hidden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      purge_after DATETIME NOT NULL,
      closed_at DATETIME NULL,
      INDEX idx_bg_logo_quarantines_due (status, purge_after),
      INDEX idx_bg_logo_quarantines_report (report_id),
      INDEX idx_bg_logo_quarantines_team (team_id),
      INDEX idx_bg_logo_quarantines_user (user_id),
      CONSTRAINT fk_bg_logo_quarantines_team FOREIGN KEY (team_id)
        REFERENCES bg_teams(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_logo_quarantines_quarantined_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_logo_quarantines_report FOREIGN KEY (report_id)
        REFERENCES bg_reports(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_logo_quarantines_hidden_by FOREIGN KEY (hidden_by_user_id)
        REFERENCES bg_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,

  // Suspensions de compte prononcées par la modération
  // (`lib/shared/account-suspension.ts`). `ends_at` à `NULL` = durée
  // indéterminée ; `lifted_at` posé = levée avant terme. L'auteur et celui qui
  // lève sont **détachés** si leur compte disparaît : la décision reste due à
  // son titulaire, comme une pénalité d'endurance. Le compte suspendu, lui,
  // emporte ses suspensions (`ON DELETE CASCADE`). L'index sert les deux
  // lectures chaudes — la session de chaque requête et le refus d'une connexion
  // —, qui cherchent une ligne non levée d'un compte.
  `
      CREATE TABLE IF NOT EXISTS bg_account_suspensions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      reason VARCHAR(500) NOT NULL,
      ground ENUM('ACCOUNT', 'BEHAVIOR', 'CONTENT') NOT NULL,
      starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ends_at DATETIME NULL,
      created_by BIGINT NULL,
      lifted_at DATETIME NULL,
      lifted_by BIGINT NULL,
      INDEX idx_bg_account_suspensions_user (user_id, lifted_at),
      CONSTRAINT fk_bg_account_suspensions_user FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bg_account_suspensions_created_by FOREIGN KEY (created_by)
        REFERENCES bg_users(id) ON DELETE SET NULL,
      CONSTRAINT fk_bg_account_suspensions_lifted_by FOREIGN KEY (lifted_by)
        REFERENCES bg_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `,
];

/** Conformité et modération. */
export async function createComplianceTables(db: Pool): Promise<void> {
  for (const ddl of COMPLIANCE_TABLES) await createTable(db, ddl);
}
