import type { Pool } from "mysql2/promise";
import { reportSchemaFailure } from "./report-schema-failure";

/** Migrations : les changements trop récents pour être repliés (`RECENT_SCHEMA_CHANGES`). */
export async function applyRecentSchemaChanges(db: Pool): Promise<void> {
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
    // Double forfait : les deux engagées d'une rencontre déclarent forfait. Une
    // colonne à part plutôt qu'une valeur de `forfeit_team_id`, qui ne sait
    // nommer qu'une équipe (`lib/shared/double-forfeit.ts`).
    `ALTER TABLE bg_matches ADD COLUMN double_forfeit BOOLEAN NOT NULL DEFAULT FALSE
       AFTER forfeit_team_id`,
    // Illustration ou logo d'un tournoi, facultatif.
    `ALTER TABLE bg_tournaments ADD COLUMN image_url VARCHAR(255) NULL`,
    `ALTER TABLE bg_tournaments ADD COLUMN image_fit ENUM('COVER', 'CONTAIN') NOT NULL DEFAULT 'COVER'`,
    `ALTER TABLE bg_tournaments ADD COLUMN image_focus_x TINYINT UNSIGNED NOT NULL DEFAULT 50`,
    `ALTER TABLE bg_tournaments ADD COLUMN image_focus_y TINYINT UNSIGNED NOT NULL DEFAULT 50`,
    // Rôles portés par une invitation : le formulaire d'invitation les
    // demandait, le serveur les jetait et le joueur arrivait toujours en DPS.
    `ALTER TABLE bg_team_invitations ADD COLUMN roles_json JSON NULL`,
    // Visites sans lien vers le compte : seul reste le fait qu'il y en avait un.
    // Le retrait de `user_id` suit, plus bas, avec les autres `DROP COLUMN`.
    `ALTER TABLE bg_site_visits ADD COLUMN authenticated TINYINT(1) NOT NULL DEFAULT 0
       AFTER visitor_key`,
    // Sur quoi repose le rattachement Discord : le bouton (OAuth) ou le code en
    // message privé. `NULL` par défaut, et **aucun remplissage** — les
    // rattachements existants ne portent aucune trace de leur porte, et leur en
    // attribuer une serait affirmer ce qu'on ignore.
    `ALTER TABLE bg_users ADD COLUMN discord_link_method ENUM('DM_CODE', 'OAUTH') NULL
       AFTER discord_verified_at`,
    // Lancement d'un match (`lib/shared/match-launch.ts`) : équipe hôte, caster
    // inscrit et les trois « Prêt ». Colonne et clé étrangère dans **une seule**
    // instruction : rejouée sur une base qui les porte, elle bute d'abord sur la
    // colonne (`ER_DUP_FIELDNAME`, toléré) au lieu de journaliser une contrainte
    // en double à chaque démarrage. `launched_at` suit plus bas, à part : elle
    // demande un remplissage.
    `ALTER TABLE bg_matches ADD COLUMN host_team_id BIGINT NULL AFTER live_started_at,
       ADD CONSTRAINT fk_bg_matches_host_team FOREIGN KEY (host_team_id)
         REFERENCES bg_teams(id) ON DELETE SET NULL`,
    `ALTER TABLE bg_matches ADD COLUMN caster_user_id BIGINT NULL AFTER host_team_id,
       ADD INDEX idx_bg_matches_caster (caster_user_id),
       ADD CONSTRAINT fk_bg_matches_caster FOREIGN KEY (caster_user_id)
         REFERENCES bg_users(id) ON DELETE SET NULL`,
    `ALTER TABLE bg_matches ADD COLUMN lobby_opened_at DATETIME NULL AFTER caster_user_id`,
    // Appariement auquel l'état de lancement se rapporte (`launchPairingKey`) :
    // un match réécrit sur place ne doit pas hériter des « Prêt » d'avant.
    `ALTER TABLE bg_matches ADD COLUMN launch_pairing VARCHAR(48) NULL AFTER lobby_opened_at`,
    `ALTER TABLE bg_matches ADD COLUMN team1_ready_at DATETIME NULL AFTER lobby_opened_at`,
    `ALTER TABLE bg_matches ADD COLUMN team2_ready_at DATETIME NULL AFTER team1_ready_at`,
    `ALTER TABLE bg_matches ADD COLUMN caster_ready_at DATETIME NULL AFTER team2_ready_at`,
    // Lien YouTube de la rediff d'un match terminé (`lib/shared/match-replay.ts`).
    `ALTER TABLE bg_matches ADD COLUMN replay_url VARCHAR(255) NULL AFTER live_started_at`,
    // Bandeau d'une carte partenaire (`lib/shared/sponsor-card.ts`), facultatif.
    `ALTER TABLE bg_sponsors ADD COLUMN banner_url VARCHAR(255) NULL AFTER logo_url`,
    // Statut d'importance d'une annonce de recrutement, qui remplace la mise en
    // avant `highlight` (report et retrait de l'ancienne colonne plus bas).
    `ALTER TABLE bg_recruitment_ads ADD COLUMN priority
       ENUM('PRIORITY', 'IMPORTANT', 'OPTIONAL') NOT NULL DEFAULT 'OPTIONAL'
       AFTER contact_preferred`,
    // Tag Discord visible des autres joueurs (`canViewDiscordTag`). Défaut `0` :
    // l'exposition est un choix du joueur, et le tag d'un compte existant garde
    // le public sous lequel il a été saisi.
    `ALTER TABLE bg_users ADD COLUMN visible_discord TINYINT(1) NOT NULL DEFAULT 0
       AFTER visible_major`,
    // Conditions d'utilisation : dernière version acceptée par le compte
    // (`lib/shared/terms-of-use.ts`). `NULL` = jamais acceptées, et **aucun
    // remplissage** — on n'attribue pas une acceptation que personne n'a donnée.
    `ALTER TABLE bg_users ADD COLUMN terms_version INT NULL AFTER platform_roles_json`,
    `ALTER TABLE bg_users ADD COLUMN terms_accepted_at DATETIME NULL AFTER terms_version`,
    // Même type que `bg_teams.logo_url`, dont la colonne recopie la valeur : en
    // `VARCHAR(255)`, supprimer un ancien logo à l'adresse longue échouait
    // (`ER_DATA_TOO_LONG`) et le laissait en ligne. Sans effet sur une base qui
    // la porte déjà en `TEXT`.
    `ALTER TABLE bg_logo_quarantines MODIFY logo_url TEXT NOT NULL`,
    // Quarantaine des avatars, à côté de celle des logos d'équipe — même table,
    // même cycle (masquage, contestation, rétablissement ou suppression), un
    // second pointeur mutuellement exclusif du premier plutôt qu'une colonne
    // « type » (voir le commentaire du `CREATE TABLE`). `team_id` devient
    // nullable pour laisser la place à une ligne qui ne désigne qu'un joueur.
    `ALTER TABLE bg_logo_quarantines MODIFY team_id BIGINT NULL`,
    `ALTER TABLE bg_logo_quarantines ADD COLUMN user_id BIGINT NULL AFTER team_id`,
    `ALTER TABLE bg_logo_quarantines ADD INDEX idx_bg_logo_quarantines_user (user_id)`,
    `ALTER TABLE bg_logo_quarantines
       ADD CONSTRAINT fk_bg_logo_quarantines_quarantined_user FOREIGN KEY (user_id)
         REFERENCES bg_users(id) ON DELETE CASCADE`,    // Catégories « RGPD » et « Hébergeur » du formulaire de signalement, qui
    // remplacent l'adresse électronique de contact que le site ne publie plus
    // (`lib/shared/legal-contact.ts`). Un `MODIFY` qui ne fait qu'élargir
    // l'ENUM : rejoué sur une base qui le porte déjà, il ne change rien.
    `ALTER TABLE bg_reports MODIFY category
       ENUM('COPYRIGHT', 'MODERATION', 'BUG', 'RGPD', 'HOSTING', 'OTHER', 'CONTEST') NOT NULL`,
    // Jeton d'un défi de connexion Discord, **haché** : la demande de code ne
    // rend plus l'identifiant Discord (c'était un oracle anonyme), et désigner
    // le défi par son numéro de ligne, séquentiel, laissait brûler les codes de
    // tout le site. `NULL` pour les lignes d'avant, qui expirent en dix minutes.
    // Colonne et index dans **une seule** instruction : rejouée, elle bute
    // d'abord sur la colonne (`ER_DUP_FIELDNAME`, toléré).
    `ALTER TABLE bg_discord_login_challenges ADD COLUMN lookup_hash CHAR(64) NULL AFTER discord_id,
       ADD UNIQUE INDEX uniq_bg_challenges_lookup (lookup_hash)`,
    // Cible d'un signalement réellement prévenue : le délai de reprévenance et
    // le plafond de l'auteur ne comptent plus que les messages partis. `NULL`
    // pour les lignes d'avant, **sans remplissage** — on ne sait pas lesquelles
    // ont reçu un message.
    `ALTER TABLE bg_report_targets ADD COLUMN notified_at DATETIME NULL AFTER label_snapshot`,
    // Origine du tag Discord : la connexion n'en certifie plus aucun, elle
    // l'enregistre, et un compte rattaché certifie d'un clic — un pseudo
    // **nommé par Discord** seulement. `0` par défaut et **aucun remplissage** :
    // on ne sait pas quels tags anciens ont été tapés à la main. Un tag déjà
    // certifié n'a de toute façon plus rien à certifier.
    `ALTER TABLE bg_users ADD COLUMN discord_pseudo_from_discord TINYINT(1) NOT NULL DEFAULT 0
       AFTER discord_link_method`,
    // Signalements traités par obligation légale (RGPD, droit d'auteur,
    // hébergeur, contestation) : plus de case d'accord, donc pas de date de
    // consentement. Idempotent, rejouable.
    `ALTER TABLE bg_reports MODIFY COLUMN consent_at DATETIME NULL`,
    // Contestation ouverte à l'auteur du signalement : qui conteste est écrit
    // avec la contestation, la purge des images masquées ne comptant que celle
    // d'une personne visée. Aucun remplissage : avant la colonne, seules les
    // personnes visées pouvaient contester, et `NULL` se lit ainsi.
    `ALTER TABLE bg_reports ADD COLUMN contest_role ENUM('TARGET', 'NOTIFIER') NULL AFTER parent_report_id`,
    // Empreintes de visiteur bornées à `SITE_VISITOR_RETENTION_MONTHS` depuis la
    // dernière visite. Aucun remplissage : la dernière visite d'une empreinte
    // déjà repliée n'est écrite nulle part, et le défaut (l'instant de l'ajout)
    // fait courir sa durée depuis le déploiement — la lecture prudente, qui
    // n'efface rien sur une date inventée. Le repli rajeunit ensuite celles
    // dont le détail est encore là.
    `ALTER TABLE bg_site_visitors ADD COLUMN last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE bg_site_visitors ADD INDEX idx_bg_site_visitors_last_seen (last_seen_at)`,
    // Suspensions de compte : une **table neuve** n'a pas d'`ALTER` à jouer — son
    // `CREATE TABLE IF NOT EXISTS`, plus haut, *est* sa migration sur une base
    // qui tourne. L'entrée ci-dessous ne fait que tenir la règle des deux
    // endroits pour l'index que lisent la session et la connexion : sans effet
    // (erreur tolérée) quand la table vient d'être créée avec lui.
    `ALTER TABLE bg_account_suspensions ADD INDEX idx_bg_account_suspensions_user (user_id, lifted_at)`,
    // Matchs planifiés par l'arbitrage : option éteinte par défaut, donc aucun
    // tournoi existant ne change de comportement.
    `ALTER TABLE bg_tournaments ADD COLUMN referee_scheduling TINYINT(1) NOT NULL DEFAULT 0
       AFTER registration_min_players`,
  ];

  for (const statement of RECENT_SCHEMA_CHANGES) {
    try {
      await db.execute(statement);
    } catch (error) {
      reportSchemaFailure(error, statement.replace(/\s+/g, " ").trim());
    }
  }
}
