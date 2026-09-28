import { describe, expect, it } from "@jest/globals";
import { isSchemaNoOpError } from "@/lib/server/mysql-errors";

/**
 * Ce qu'un `catch` de migration a le droit d'avaler — **au regard de
 * l'instruction qu'il jouait**.
 *
 * Le même code MySQL ne dit pas la même chose selon l'`ALTER` : c'est toute la
 * raison d'être du second paramètre, et les deux erreurs qu'il évite sont
 * symétriques. Traiter `ER_DUP_KEYNAME` en no-op sur un `ADD COLUMN … UNIQUE`
 * tait une colonne qui n'a **pas** été ajoutée ; le traiter en anomalie sur un
 * `ADD UNIQUE INDEX` pose une fausse ligne d'échec à chaque démarrage — et une
 * alerte permanente cesse d'être lue, ce qui érode le signal posé pour protéger
 * le retrait des adresses.
 */
const err = (code: string) => Object.assign(new Error(code), { code });

const ADD_COLUMN = "ALTER TABLE bg_users ADD COLUMN blizzard_sub VARCHAR(191) NULL UNIQUE";
const ADD_INDEX = "ALTER TABLE bg_teams ADD UNIQUE INDEX uniq_bg_teams_tag (tag)";
const ADD_PK = "ALTER TABLE bg_swiss_standings ADD PRIMARY KEY (tournament_id, phase_id, team_id)";
const DROP_COLUMN = "ALTER TABLE bg_users DROP COLUMN email";

describe("isSchemaNoOpError — vrai quelle que soit l'instruction", () => {
  it("la colonne à ajouter existe déjà", () => {
    for (const statement of [ADD_COLUMN, ADD_INDEX, DROP_COLUMN]) {
      expect(isSchemaNoOpError(err("ER_DUP_FIELDNAME"), statement)).toBe(true);
    }
  });

  it("la colonne à retirer n'existe pas", () => {
    expect(isSchemaNoOpError(err("ER_CANT_DROP_FIELD_OR_KEY"), DROP_COLUMN)).toBe(true);
  });
});

describe("isSchemaNoOpError — ER_DUP_KEYNAME, les deux lectures", () => {
  it("est une **anomalie** sur un ADD COLUMN … UNIQUE", () => {
    // MySQL voit la colonne avant l'index : il aurait rendu `ER_DUP_FIELDNAME`
    // si elle était là. Recevoir celui-ci dit donc que la colonne n'a pas été
    // ajoutée, et qu'un index porte déjà son nom.
    expect(isSchemaNoOpError(err("ER_DUP_KEYNAME"), ADD_COLUMN)).toBe(false);
  });

  it("est le **cas nominal** sur un ADD UNIQUE INDEX", () => {
    expect(isSchemaNoOpError(err("ER_DUP_KEYNAME"), ADD_INDEX)).toBe(true);
    expect(
      isSchemaNoOpError(err("ER_DUP_KEYNAME"), "ALTER TABLE bg_matches ADD INDEX idx_live (x)"),
    ).toBe(true);
  });
});

describe("isSchemaNoOpError — clé primaire recomposée", () => {
  it("« la table a déjà une clé primaire » est le cas nominal", () => {
    expect(isSchemaNoOpError(err("ER_MULTIPLE_PRI_KEY"), ADD_PK)).toBe(true);
  });

  it("mais pas sur une instruction qui ne pose aucune clé primaire", () => {
    expect(isSchemaNoOpError(err("ER_MULTIPLE_PRI_KEY"), ADD_COLUMN)).toBe(false);
  });
});

describe("isSchemaNoOpError — ce qui n'est jamais avalé", () => {
  it.each([
    ["un droit ALTER manquant", "ER_TABLEACCESS_DENIED_ERROR"],
    ["un verrou de métadonnées", "ER_LOCK_WAIT_TIMEOUT"],
    ["un interblocage", "ER_LOCK_DEADLOCK"],
    ["une table absente", "ER_NO_SUCH_TABLE"],
  ])("%s", (_label, code) => {
    for (const statement of [ADD_COLUMN, ADD_INDEX, ADD_PK, DROP_COLUMN]) {
      expect(isSchemaNoOpError(err(code), statement)).toBe(false);
    }
  });

  it("un objet sans code d'erreur", () => {
    expect(isSchemaNoOpError(new Error("boom"), ADD_COLUMN)).toBe(false);
    expect(isSchemaNoOpError(null, ADD_COLUMN)).toBe(false);
  });
});

describe("isSchemaNoOpError — sans instruction, le défaut est prudent", () => {
  it("ne tolère que les deux codes inconditionnels", () => {
    expect(isSchemaNoOpError(err("ER_DUP_FIELDNAME"))).toBe(true);
    expect(isSchemaNoOpError(err("ER_CANT_DROP_FIELD_OR_KEY"))).toBe(true);
    expect(isSchemaNoOpError(err("ER_DUP_KEYNAME"))).toBe(false);
    expect(isSchemaNoOpError(err("ER_MULTIPLE_PRI_KEY"))).toBe(false);
  });
});

describe("isSchemaNoOpError — clé étrangère déjà posée", () => {
  const ADD_FK = `ALTER TABLE bg_logo_quarantines
       ADD CONSTRAINT fk_bg_logo_quarantines_quarantined_user FOREIGN KEY (user_id)
         REFERENCES bg_users(id) ON DELETE CASCADE`;
  const ADD_FK_UNNAMED = "ALTER TABLE t ADD FOREIGN KEY (user_id) REFERENCES bg_users(id)";
  const withMessage = (code: string, message: string) =>
    Object.assign(new Error(message), { code });

  it("tolère le doublon de nom sous MySQL (ER_FK_DUP_NAME) et MariaDB (ER_DUP_CONSTRAINT_NAME)", () => {
    for (const statement of [ADD_FK, ADD_FK_UNNAMED]) {
      expect(isSchemaNoOpError(err("ER_FK_DUP_NAME"), statement)).toBe(true);
      expect(isSchemaNoOpError(err("ER_DUP_CONSTRAINT_NAME"), statement)).toBe(true);
    }
  });

  it("tolère le 1005 d'InnoDB portant errno 121", () => {
    const error = withMessage(
      "ER_CANT_CREATE_TABLE",
      "Can't create table `bg`.`bg_logo_quarantines` (errno: 121 \"Duplicate key on write or update\")",
    );
    expect(isSchemaNoOpError(error, ADD_FK)).toBe(true);
  });

  it("signale un 1005 d'une autre cause — type incompatible, table absente", () => {
    const error = withMessage(
      "ER_CANT_CREATE_TABLE",
      "Can't create table `bg`.`bg_logo_quarantines` (errno: 150 \"Foreign key constraint is incorrectly formed\")",
    );
    expect(isSchemaNoOpError(error, ADD_FK)).toBe(false);
  });

  it("ne tolère le doublon de clé étrangère que sur une instruction qui en pose une", () => {
    expect(isSchemaNoOpError(err("ER_FK_DUP_NAME"), ADD_INDEX)).toBe(false);
    expect(isSchemaNoOpError(err("ER_FK_DUP_NAME"), ADD_COLUMN)).toBe(false);
    expect(isSchemaNoOpError(err("ER_FK_DUP_NAME"))).toBe(false);
  });
});
