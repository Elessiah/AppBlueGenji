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

  it("ne rejoue la manœuvre que sur une colonne encore NOT NULL", () => {
    // La condition n'est pas une optimisation : sans elle, la clé serait
    // détruite et reposée à chaque démarrage.
    const guard = SQL.indexOf("invitationCreatorNullable === \"NO\"");
    const drop = SQL.indexOf("DROP FOREIGN KEY fk_bg_team_inv_creator");
    expect(guard).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(guard);
    expect(SQL).toContain("TABLE_NAME = 'bg_team_invitations'");
    expect(SQL).toContain("COLUMN_NAME = 'created_by'");
  });
});
