import type { Pool } from "mysql2/promise";
import { createTable } from "../declared-tables";

/** Équipes, et la règle de `fk_bg_team_inv_creator` vérifiée après la table. */
export async function createTeamTables(db: Pool): Promise<void> {
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
  await createTable(db, `
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

  await createTable(db, `
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

  await createTable(db, `
      CREATE TABLE IF NOT EXISTS bg_team_invitations (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      team_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      -- NULL = l'auteur a supprimé son compte. L'invitation, elle, reste : elle
      -- est l'acte de l'équipe (seule sa gestion peut l'émettre) et personne ne
      -- lit jamais cette colonne. En NOT NULL avec sa cascade, l'effacement d'un
      -- compte emportait silencieusement les invitations encore en attente chez
      -- des tiers.
      created_by BIGINT NULL,
      kind ENUM('INVITE', 'REQUEST') NOT NULL,
      -- Rôles proposés par la gestion avec une invitation (INVITE), posés à
      -- l'arrivée du joueur. NULL sur une demande (REQUEST) et sur les
      -- invitations d'avant la colonne : le joueur arrive alors en DPS.
      roles_json JSON NULL,
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
        REFERENCES bg_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: l'auteur d'une invitation peut disparaître, l'invitation reste.
  //
  // `bg_team_invitations.created_by` était `NOT NULL` en `ON DELETE CASCADE`.
  // Tant qu'aucun compte ne s'effaçait vraiment, la cascade ne partait jamais ;
  // l'effacement l'a réveillée, et elle emporte alors **les invitations encore
  // en attente chez des tiers** — un gérant qui n'a jamais joué supprime son
  // compte, et trois joueurs voient leur invitation disparaître sans que
  // personne ne l'ait retirée. Or l'invitation est l'acte de l'équipe (seule sa
  // gestion peut l'émettre), la colonne n'est **lue nulle part**, et le projet
  // tranche déjà ce cas ailleurs de la même façon : `bg_endurance_penalties`
  // .`created_by` passe à `NULL`, la sanction restant due.
  //
  // La condition n'est pas une optimisation : sans elle, chaque démarrage
  // détruirait et reposerait la clé étrangère.
  // La condition porte sur la **règle de la clé**, et non sur la nullabilité de
  // la colonne. Ce n'est pas la même question : la manœuvre est en trois temps
  // et rien ne garantit qu'elle aille au bout (processus tué, déploiement,
  // droits manquants). Lue sur `IS_NULLABLE`, elle disait « c'est fait » dès la
  // deuxième instruction — la clé pouvait rester absente pour toujours, sans un
  // signal. Lue sur `DELETE_RULE`, elle ne dit « c'est fait » que lorsque la clé
  // *existe* et *dit ce qu'il faut* ; tout état intermédiaire se retente au
  // démarrage suivant.
  //
  // **Après** le `CREATE TABLE` ci-dessus, et non parmi les migrations de
  // colonnes : sur une base neuve la table n'existe pas encore à cet
  // endroit-là du fichier, les trois `ALTER` échouaient dans le vide et la
  // garde sur `DELETE_RULE` ne décidait plus rien — la clé n'était juste que
  // parce que le `CREATE TABLE` la déclare déjà en `SET NULL`. Ici, les deux
  // chemins (base neuve, base peuplée) passent par la même vérification.
  //
  // Chaque instruction porte son `try`, comme le reste du fichier : une
  // migration qui **lève** casse `getDatabase()`, donc toutes les routes de
  // l'application — un filet qui casse le schéma est pire que le trou qu'il
  // bouche. Retirer une clé déjà retirée ou reposer une clé déjà posée n'est
  // alors qu'un pas sans effet, pas une panne.
  try {
    const [invitationCreatorRows] = await db.execute(
      `SELECT DELETE_RULE AS deleteRule
       FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE()
         AND TABLE_NAME = 'bg_team_invitations'
         AND CONSTRAINT_NAME = 'fk_bg_team_inv_creator'`
    );
    const invitationCreatorRule =
      (invitationCreatorRows as { deleteRule?: string }[])[0]?.deleteRule ?? null;
    if (invitationCreatorRule !== "SET NULL") {
      // La clé part d'abord : une colonne référencée ne change pas de
      // nullabilité tant qu'une contrainte s'appuie dessus.
      try {
        await db.execute(`ALTER TABLE bg_team_invitations DROP FOREIGN KEY fk_bg_team_inv_creator`);
      } catch {
        // Déjà retirée — passage précédent interrompu, ou base neuve.
      }
      try {
        await db.execute(`ALTER TABLE bg_team_invitations MODIFY COLUMN created_by BIGINT NULL`);
      } catch {
        // Déjà nullable.
      }
      try {
        await db.execute(`
          ALTER TABLE bg_team_invitations
          ADD CONSTRAINT fk_bg_team_inv_creator FOREIGN KEY (created_by)
            REFERENCES bg_users(id) ON DELETE SET NULL
        `);
      } catch (error) {
        // Reposée au prochain démarrage : la condition la redemandera tant
        // qu'elle n'est pas en `SET NULL`. Mais « se retente » est une
        // promesse, pas un constat : avalée sans un mot, une clé qui ne se
        // repose **jamais** (droits manquants) laisse la règle d'avant, et
        // effacer le compte d'une manageuse emporte alors en cascade les
        // invitations encore en attente qu'elle avait adressées à des tiers.
        // Une ligne au journal est le seul moyen de distinguer « c'est passé
        // au démarrage suivant » de « ça ne passera plus ».
        console.warn(
          "[db] fk_bg_team_inv_creator non reposée en SET NULL — nouvel essai au prochain démarrage",
          error,
        );
      }
    }
  } catch (error) {
    // `information_schema` inaccessible : rien de tenté, rien de cassé — mais
    // rien de vérifié non plus, et la clé peut être restée en `CASCADE`.
    console.warn(
      "[db] règle de fk_bg_team_inv_creator non vérifiable (information_schema)",
      error,
    );
  }
}
