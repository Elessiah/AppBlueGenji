import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const SQL = readFileSync(join(ROOT, "lib", "server", "database.ts"), "utf8");

/**
 * L'auteur d'une invitation peut disparaître ; l'invitation, elle, reste.
 *
 * `bg_team_invitations.created_by` était `NOT NULL` en `ON DELETE CASCADE`.
 * Tant qu'aucun compte ne s'effaçait vraiment, la cascade ne partait jamais —
 * l'effacement introduit par cette suppression de compte l'a réveillée, et elle
 * emporte **les invitations encore en attente chez des tiers** : un gérant qui
 * n'a jamais joué supprime son compte, et trois joueurs perdent une invitation
 * que personne n'a retirée. Le projet tranche déjà ce cas ailleurs de la même
 * façon — `bg_endurance_penalties.created_by` passe à `NULL`, la sanction
 * restant due.
 *
 * Les migrations tournent contre un vrai MySQL et ne sont pas exécutables ici :
 * ce qui se vérifie est ce qui se lit dans la source, c'est-à-dire l'**ordre**
 * des trois instructions (une colonne référencée ne change pas de nullabilité
 * tant qu'une contrainte s'appuie dessus) et la **condition** qui les garde —
 * sans elle, chaque démarrage détruirait et reposerait la clé.
 */
describe("bg_team_invitations.created_by — l'auteur devient facultatif", () => {
  it("naît nullable, en SET NULL, sur une base neuve", () => {
    expect(SQL).toMatch(/created_by BIGINT NULL,/);
    expect(SQL).toMatch(
      /CONSTRAINT fk_bg_team_inv_creator FOREIGN KEY \(created_by\)\s*REFERENCES bg_users\(id\) ON DELETE SET NULL/,
    );
    // La cascade d'origine ne subsiste nulle part pour cette clé.
    expect(SQL).not.toMatch(
      /fk_bg_team_inv_creator FOREIGN KEY \(created_by\)\s*REFERENCES bg_users\(id\) ON DELETE CASCADE/,
    );
  });

  it("garde la cascade sur les deux autres clés de la table", () => {
    // `user_id` et `team_id` cascadent toujours : une invitation n'a aucun sens
    // sans son destinataire ni sans son équipe, alors qu'elle en garde un sans
    // l'auteur du geste — qui n'est lu nulle part.
    expect(SQL).toMatch(
      /fk_bg_team_inv_user FOREIGN KEY \(user_id\)\s*REFERENCES bg_users\(id\) ON DELETE CASCADE/,
    );
    expect(SQL).toMatch(
      /fk_bg_team_inv_team FOREIGN KEY \(team_id\)\s*REFERENCES bg_teams\(id\) ON DELETE CASCADE/,
    );
  });

  it("migre une base peuplée dans l'ordre : clé retirée, colonne élargie, clé reposée", () => {
    const drop = SQL.indexOf("DROP FOREIGN KEY fk_bg_team_inv_creator");
    const modify = SQL.indexOf("MODIFY COLUMN created_by BIGINT NULL");
    const add = SQL.indexOf("ADD CONSTRAINT fk_bg_team_inv_creator");

    expect(drop).toBeGreaterThan(-1);
    expect(modify).toBeGreaterThan(drop);
    expect(add).toBeGreaterThan(modify);
  });

  it("ne rejoue la manœuvre que tant que la clé ne dit pas SET NULL", () => {
    // La condition n'est pas une optimisation : sans elle, la clé serait
    // détruite et reposée à chaque démarrage.
    //
    // Elle porte sur la **règle de la clé**, et non sur la nullabilité de la
    // colonne — ce n'est pas la même question. La manœuvre est en trois temps
    // et rien ne garantit qu'elle aille au bout (processus tué, déploiement,
    // droits manquants) : lue sur `IS_NULLABLE`, elle disait « c'est fait » dès
    // la deuxième instruction, et la clé pouvait rester absente pour toujours
    // sans un signal. Lue sur `DELETE_RULE`, elle ne dit « c'est fait » que
    // lorsque la clé existe *et* dit ce qu'il faut.
    const guard = SQL.indexOf('invitationCreatorRule !== "SET NULL"');
    const drop = SQL.indexOf("DROP FOREIGN KEY fk_bg_team_inv_creator");
    expect(guard).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(guard);
    expect(SQL).toContain("FROM information_schema.REFERENTIAL_CONSTRAINTS");
    expect(SQL).toContain("CONSTRAINT_NAME = 'fk_bg_team_inv_creator'");
  });

  it("ne laisse aucune de ses trois instructions faire tomber le démarrage", () => {
    // Une migration qui **lève** casse `getDatabase()`, donc toutes les routes
    // de l'application : un filet qui casse le schéma est pire que le trou
    // qu'il bouche. Retirer une clé déjà retirée ou reposer une clé déjà posée
    // n'est alors qu'un pas sans effet.
    const block = SQL.slice(
      SQL.indexOf("REFERENTIAL_CONSTRAINTS"),
      SQL.indexOf("`information_schema` inaccessible"),
    );
    expect([...block.matchAll(/\} catch \{/g)].length).toBeGreaterThanOrEqual(4);
  });

  it("se joue après le `CREATE TABLE`, sinon la garde ne décide rien", () => {
    // Les migrations d'un fichier se jouent dans l'ordre où elles y sont
    // écrites. Placé parmi les migrations de colonnes de `bg_users` — trois
    // cents lignes plus haut —, le bloc s'exécutait sur une base neuve
    // **avant** que la table n'existe : les trois `ALTER` échouaient dans le
    // vide, chacun avalé par son `catch`, et la clé n'était juste que parce que
    // le `CREATE TABLE` d'en dessous la déclare déjà en `SET NULL`. La garde
    // sur `DELETE_RULE` ne décidait alors rien sur ce chemin-là, alors que
    // c'est précisément le chemin qu'elle est censée couvrir aussi.
    const createTable = SQL.indexOf("CREATE TABLE IF NOT EXISTS bg_team_invitations");
    const migration = SQL.indexOf("SELECT DELETE_RULE AS deleteRule");
    expect(createTable).toBeGreaterThan(-1);
    expect(migration).toBeGreaterThan(createTable);
  });
});
