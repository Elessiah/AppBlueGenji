import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Pool, PoolOptions } from "mysql2/promise";
import type { OnceGate } from "@/lib/server/migration-lock";
import { createHash, randomUUID } from "node:crypto";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { CONTACT_DISCORD_URL_KEY, CONTACT_EMAIL_KEY, SUPERSEDED_CONTACT_EMAILS } from "@/lib/shared/contact";
import { DISCORD_INVITE_URL, SUPERSEDED_DISCORD_INVITE_URLS } from "@/lib/shared/discord";

/**
 * La passe de migrations **exécutée**, et non plus lue dans la source.
 *
 * `database-schema.test.ts` vérifie ce que le fichier *écrit* ; ici on rejoue
 * `runMigrations` contre un double de pool qui répond comme le ferait une base
 * dans un état donné (neuve, à jour, en retard, en panne), et l'on regarde ce
 * qui est émis, dans quel ordre, et ce qui est dit au journal. Les deux
 * garanties tenues par le module y sont mises à l'épreuve : une migration qui
 * échoue est **dite** sans faire tomber le démarrage, et le cas nominal — base
 * déjà à jour — ne dit **rien**.
 */

const createPool = jest.fn<(options: PoolOptions) => Pool>();

jest.mock("mysql2/promise", () => ({
  __esModule: true,
  default: { createPool: (options: PoolOptions) => createPool(options) },
}));
// La porte ne mémorise rien ici : chaque `getDatabase()` rejoue la passe
// entière, ce qui permet un scénario de base par cas sur le même pool.
jest.mock("@/lib/server/migration-lock", () => ({
  createOnceGate: (): OnceGate => ({ run: (task) => task() }),
  withMigrationLock: (_pool: Pool, run: () => Promise<unknown>) => run(),
}));

import { getDatabase, withConnection } from "@/lib/server/database";
import { declaredColumns } from "@/lib/server/database/declared-tables";

/** Erreur mysql2 minimale : seul `code` est lu par les prédicats. */
function mysqlError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

const OK = [{ affectedRows: 0 }, undefined];

/** Instruction réduite à une ligne, pour la lire et la comparer. */
function flat(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

type Rule = { match: RegExp; reply: (sql: string, params: unknown) => unknown };

/**
 * Base simulée : chaque règle répond aux instructions qu'elle reconnaît, la
 * première qui correspond l'emporte ; le reste passe (`OK`). Les sondes
 * d'`information_schema` d'une base **à jour** sont fournies par défaut, à
 * remplacer par une règle placée avant.
 */
let rules: Rule[] = [];
const issued: string[] = [];
/** `CREATE TABLE` tels qu'émis : aplatis, un commentaire `--` avalerait la suite. */
const createdDdl: string[] = [];
/** Instructions telles qu'émises, octet pour octet. */
const rawIssued: string[] = [];
const execute = jest.fn<SqlQuery>(async (sql, params) => {
  const line = flat(sql);
  issued.push(line);
  if (line.startsWith("CREATE TABLE")) createdDdl.push(sql);
  rawIssued.push(sql);
  for (const rule of [...rules, ...healthyRules()]) {
    if (rule.match.test(line)) return rule.reply(line, params);
  }
  return OK;
});
const release = jest.fn<() => void>();
const getConnection = jest.fn(async () => ({ release }));

function on(match: RegExp, reply: Rule["reply"]): void {
  rules.push({ match, reply });
}
function fail(match: RegExp, code: string): void {
  on(match, () => {
    throw mysqlError(code);
  });
}

/** Colonnes de toutes les tables déclarées pendant la passe en cours. */
function declaredRows(): { t: string; c: string }[] {
  return createdDdl
    .map((ddl) => declaredColumns(ddl))
    .filter((d) => d !== null)
    .flatMap(({ table, columns }) => columns.map((c) => ({ t: table, c })));
}

/** Ce que répond une base à jour, sans erreur nulle part qui compte. */
function healthyRules(): Rule[] {
  return [
    { match: /^SELECT DELETE_RULE/, reply: () => [[{ deleteRule: "SET NULL" }], undefined] },
    { match: /^ALTER TABLE bg_matches ADD COLUMN launched_at/, reply: () => { throw mysqlError("ER_DUP_FIELDNAME"); } },
    { match: /^SELECT COLUMN_DEFAULT/, reply: () => [[{ columnDefault: "0" }], undefined] },
    { match: /DROP COLUMN/, reply: () => { throw mysqlError("ER_CANT_DROP_FIELD_OR_KEY"); } },
    { match: /^UPDATE bg_site_visits SET authenticated/, reply: () => { throw mysqlError("ER_BAD_FIELD_ERROR"); } },
    { match: /^SELECT 1 FROM bg_site_visitors/, reply: () => [[{ 1: 1 }], undefined] },
    { match: /^UPDATE bg_recruitment_ads SET priority/, reply: () => { throw mysqlError("ER_BAD_FIELD_ERROR"); } },
    {
      match: /^SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE/,
      reply: () => [
        [
          { TABLE_NAME: "bg_tournaments", COLUMN_NAME: "game", COLUMN_TYPE: "enum('OW','MR')" },
          { TABLE_NAME: "bg_tournaments", COLUMN_NAME: "match_format_max_maps", COLUMN_TYPE: "int" },
          { TABLE_NAME: "bg_tournaments", COLUMN_NAME: "endurance_playoff_format_type", COLUMN_TYPE: "enum('BO','FT')" },
          { TABLE_NAME: "bg_matches", COLUMN_NAME: "phase_id", COLUMN_TYPE: "bigint" },
        ],
        undefined,
      ],
    },
    { match: /^SELECT TABLE_NAME t, COLUMN_NAME c/, reply: () => [declaredRows(), undefined] },
    {
      match: /^SELECT DISTINCT INDEX_NAME/,
      reply: () => [[{ INDEX_NAME: "uniq_bg_teams_tag" }, { INDEX_NAME: "uniq_bg_teams_solo_user" }], undefined],
    },
    {
      match: /^SELECT TABLE_NAME t, COUNT\(\*\) n/,
      reply: () => [[{ t: "bg_swiss_standings", n: 3 }, { t: "bg_survival_standings", n: 3 }], undefined],
    },
  ];
}

const ENV = { DB_HOST: "db.test", DB_USER: "app", DB_PASSWORD: randomUUID(), DB_DATABASE: "bluegenji" };
const savedEnv: Record<string, string | undefined> = {};
let errorSpy: jest.SpiedFunction<typeof console.error>;
let logSpy: jest.SpiedFunction<typeof console.log>;
let warnSpy: jest.SpiedFunction<typeof console.warn>;

beforeAll(() => {
  for (const [key, value] of Object.entries({ ...ENV, NEXT_RUNTIME: undefined })) {
    savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  createPool.mockReturnValue(fakePool({ execute, getConnection }));
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  rules = [];
  issued.length = 0;
  createdDdl.length = 0;
  rawIssued.length = 0;
  execute.mockClear();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

/** Rang de la première instruction qui correspond, -1 si aucune. */
function rank(match: RegExp): number {
  return issued.findIndex((sql) => match.test(sql));
}
function count(match: RegExp): number {
  return issued.filter((sql) => match.test(sql)).length;
}
/** Tous les messages d'erreur journalisés, en une chaîne. */
function errors(): string {
  return errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("runMigrations — une base déjà à jour", () => {
  it("joue toute la passe sans rien dire au journal", async () => {
    await expect(getDatabase()).resolves.toBeDefined();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("émet la passe à l'octet près (empreinte figée)", async () => {
    // Empreinte de la suite **brute** des instructions, ordre et blancs compris :
    // une réécriture du module (mise en commun des `CREATE TABLE` en listes,
    // par exemple) doit la laisser intacte. Un changement de schéma voulu la
    // déplace : mettre l'instantané à jour (`npx jest <ce fichier> -u`).
    await getDatabase();

    const digest = createHash("sha256").update(rawIssued.join("\u0000")).digest("hex");
    expect({ statements: rawIssued.length, sha256: digest }).toMatchSnapshot();
  });

  it("crée toutes les tables avant la première migration", async () => {
    await getDatabase();

    const creates = issued.filter((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS"));
    expect(creates.length).toBeGreaterThanOrEqual(38);
    const lastCreate = issued.findLastIndex((sql) => sql.startsWith("CREATE TABLE"));
    expect(lastCreate).toBeLessThan(rank(/^ALTER TABLE bg_discord_login_challenges ADD COLUMN handle/));
  });

  it("enchaîne les étapes dans l'ordre du fichier, le filet en dernier", async () => {
    await getDatabase();

    const steps = [
      /^ALTER TABLE bg_discord_login_challenges ADD COLUMN handle/, // changements récents
      /^ALTER TABLE bg_matches ADD COLUMN launched_at/,
      /^SELECT COLUMN_DEFAULT/,
      /^ALTER TABLE bg_recruitment_ads DROP COLUMN contact_email/,
      /^ALTER TABLE bg_users DROP COLUMN email/,
      /^ALTER TABLE bg_site_visits DROP COLUMN user_id/,
      /^SELECT 1 FROM bg_site_visitors/,
      /^UPDATE bg_recruitment_ads SET priority/,
      /^UPDATE bg_settings SET setting_value = \?/, // rattrapages permanents
      /^UPDATE bg_teams t JOIN bg_users u/,
      /^SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE/, // filet
      /^SELECT TABLE_NAME t, COUNT\(\*\) n/,
    ];
    const ranks = steps.map(rank);
    expect(ranks.every((r) => r >= 0)).toBe(true);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("ne remplit pas launched_at quand la colonne était déjà là", async () => {
    await getDatabase();
    expect(count(/^UPDATE bg_matches SET launched_at/)).toBe(0);
  });

  it("ne touche pas au défaut de open_to_recruitment déjà basculé", async () => {
    await getDatabase();
    expect(count(/ALTER COLUMN open_to_recruitment/)).toBe(0);
  });

  it("ne reprend pas les empreintes quand bg_site_visitors est déjà remplie", async () => {
    await getDatabase();
    expect(count(/^INSERT INTO bg_site_visitors/)).toBe(0);
  });
});

describe("runMigrations — une base neuve", () => {
  it("prend la reprise des empreintes et le retrait de highlight sans bruit", async () => {
    on(/^SELECT 1 FROM bg_site_visitors/, () => [[], undefined]);
    // Une base neuve n'a jamais eu `highlight` : le report bute, `priority` se lit.
    on(/^SELECT priority FROM bg_recruitment_ads/, () => [[], undefined]);

    await getDatabase();

    expect(count(/^INSERT INTO bg_site_visitors \(visitor_key, authenticated, last_seen_at\)/)).toBe(1);
    expect(count(/^ALTER TABLE bg_recruitment_ads DROP COLUMN highlight/)).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("runMigrations — tolérance d'un ALTER récent", () => {
  it("dit l'échec qui compte, en une ligne, et poursuit la liste", async () => {
    fail(/^ALTER TABLE bg_users ADD COLUMN discord_verified_at/, "ER_LOCK_WAIT_TIMEOUT");

    await expect(getDatabase()).resolves.toBeDefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errors()).toContain("« ALTER TABLE bg_users ADD COLUMN discord_verified_at DATETIME NULL » a échoué");
    // L'instruction suivante de la liste est bien partie.
    expect(rank(/ADD COLUMN registration_discord_requirement/)).toBeGreaterThan(
      rank(/ADD COLUMN discord_verified_at/),
    );
  });

  it("rapporte l'instruction sur une seule ligne, même écrite sur plusieurs", async () => {
    fail(/ADD COLUMN registration_discord_requirement/, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(errors()).toContain(
      "ALTER TABLE bg_tournaments ADD COLUMN registration_discord_requirement ENUM('NONE', 'ANY_PLAYER', 'ALL_PLAYERS')",
    );
  });

  it("tait une colonne déjà posée, un index déjà là, une clé déjà retirée", async () => {
    fail(/ADD COLUMN/, "ER_DUP_FIELDNAME");
    fail(/^ALTER TABLE \S+ ADD INDEX/, "ER_DUP_KEYNAME");

    await getDatabase();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("dit un index dupliqué sur un ADD COLUMN, qui n'a pas posé la colonne", async () => {
    fail(/ADD COLUMN lookup_hash/, "ER_DUP_KEYNAME");

    await getDatabase();

    expect(errors()).toContain("ADD COLUMN lookup_hash");
  });

  it("ne fait pas tomber le démarrage sur une table accessoire refusée", async () => {
    fail(/^CREATE TABLE IF NOT EXISTS bg_match_reminders/, "ER_TABLEACCESS_DENIED_ERROR");
    fail(/^CREATE TABLE IF NOT EXISTS bg_endurance_penalties/, "ER_TABLEACCESS_DENIED_ERROR");

    await expect(getDatabase()).resolves.toBeDefined();
    // La table suivante est créée malgré tout.
    expect(rank(/^CREATE TABLE IF NOT EXISTS bg_referee_alerts/)).toBeGreaterThan(-1);
  });

  it("tolère chacune des six tables accessoires, et elles seules", async () => {
    const TOLERATED =
      /^CREATE TABLE IF NOT EXISTS (bg_endurance_penalties|bg_match_reminders|bg_referee_alerts|bg_push_subscriptions|bg_push_topic_optouts|bg_match_start_notices)\b/;
    fail(TOLERATED, "ER_TABLEACCESS_DENIED_ERROR");

    await expect(getDatabase()).resolves.toBeDefined();

    expect(count(TOLERATED)).toBe(6);
    expect(rank(/^SELECT TABLE_NAME t, COUNT\(\*\) n/)).toBeGreaterThan(-1);
  });

  it("fait en revanche tomber le démarrage sur une table principale refusée", async () => {
    fail(/^CREATE TABLE IF NOT EXISTS bg_users\b/, "ER_TABLEACCESS_DENIED_ERROR");

    await expect(getDatabase()).rejects.toThrow("ER_TABLEACCESS_DENIED_ERROR");
  });
});

describe("bg_team_invitations.created_by — passage en SET NULL", () => {
  const RULE = /^SELECT DELETE_RULE/;
  const DROP_FK = /^ALTER TABLE bg_team_invitations DROP FOREIGN KEY fk_bg_team_inv_creator/;
  const MODIFY = /^ALTER TABLE bg_team_invitations MODIFY COLUMN created_by BIGINT NULL/;
  const ADD_FK = /^ALTER TABLE bg_team_invitations ADD CONSTRAINT fk_bg_team_inv_creator/;

  it("ne touche à rien quand la clé est déjà en SET NULL", async () => {
    await getDatabase();
    expect(count(DROP_FK) + count(MODIFY) + count(ADD_FK)).toBe(0);
  });

  it("retire la clé, élargit la colonne puis la repose, dans cet ordre", async () => {
    on(RULE, () => [[{ deleteRule: "CASCADE" }], undefined]);

    await getDatabase();

    expect(rank(DROP_FK)).toBeGreaterThan(rank(RULE));
    expect(rank(MODIFY)).toBeGreaterThan(rank(DROP_FK));
    expect(rank(ADD_FK)).toBeGreaterThan(rank(MODIFY));
    expect(issued[rank(ADD_FK)]).toContain("ON DELETE SET NULL");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("rejoue la manœuvre sur une clé absente, et passe ses étapes déjà faites", async () => {
    on(RULE, () => [[], undefined]);
    fail(DROP_FK, "ER_CANT_DROP_FIELD_OR_KEY");
    fail(MODIFY, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(rank(ADD_FK)).toBeGreaterThan(rank(MODIFY));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("dit une clé qui ne se repose pas, sans faire tomber le démarrage", async () => {
    on(RULE, () => [[{ deleteRule: "CASCADE" }], undefined]);
    fail(ADD_FK, "ER_TABLEACCESS_DENIED_ERROR");

    await expect(getDatabase()).resolves.toBeDefined();

    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("non reposée en SET NULL");
  });

  it("dit une règle invérifiable, sans rien tenter", async () => {
    fail(RULE, "ER_TABLEACCESS_DENIED_ERROR");

    await getDatabase();

    expect(count(DROP_FK)).toBe(0);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("non vérifiable (information_schema)");
  });
});

describe("backfillLaunchedAt", () => {
  it("lance les matchs déjà jouables, une fois, quand la colonne vient d'être ajoutée", async () => {
    on(/^ALTER TABLE bg_matches ADD COLUMN launched_at/, () => OK);

    await getDatabase();

    const update = issued[rank(/^UPDATE bg_matches SET launched_at = NOW\(\)/)];
    expect(update).toContain("launch_pairing = CONCAT(team1_id, ':', team2_id)");
    expect(update).toContain("WHERE launched_at IS NULL");
    expect(update).toContain("start_at <= NOW()");
  });

  it("dit l'échec du remplissage sous le nom de l'ALTER", async () => {
    on(/^ALTER TABLE bg_matches ADD COLUMN launched_at/, () => OK);
    fail(/^UPDATE bg_matches SET launched_at/, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(errors()).toContain("ADD COLUMN launched_at DATETIME NULL AFTER lobby_opened_at");
  });
});

describe("switchOpenToRecruitmentDefault", () => {
  const SWITCH = /^ALTER TABLE bg_users ALTER COLUMN open_to_recruitment SET DEFAULT 0/;
  const BACKFILL = /^UPDATE bg_users u SET u.open_to_recruitment = 0/;
  const RESTORE = /^ALTER TABLE bg_users ALTER COLUMN open_to_recruitment SET DEFAULT 1/;

  it("bascule le défaut puis ferme les joueurs sans équipe, et le dit", async () => {
    on(/^SELECT COLUMN_DEFAULT/, () => [[{ columnDefault: "1" }], undefined]);
    on(BACKFILL, () => [{ affectedRows: 7 }, undefined]);

    await getDatabase();

    expect(rank(SWITCH)).toBeGreaterThan(-1);
    expect(rank(BACKFILL)).toBeGreaterThan(rank(SWITCH));
    expect(String(logSpy.mock.calls[0]?.[0])).toContain("7 joueur(s) sans équipe");
    expect(count(RESTORE)).toBe(0);
  });

  it("ne remplit rien quand la bascule est refusée", async () => {
    on(/^SELECT COLUMN_DEFAULT/, () => [[{ columnDefault: "1" }], undefined]);
    fail(SWITCH, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(count(BACKFILL)).toBe(0);
    expect(errors()).toContain("SET DEFAULT 0");
  });

  it("remet le défaut à 1 quand le remplissage échoue", async () => {
    on(/^SELECT COLUMN_DEFAULT/, () => [[{ columnDefault: "1" }], undefined]);
    fail(BACKFILL, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(rank(RESTORE)).toBeGreaterThan(rank(BACKFILL));
    expect(errors()).toContain("UPDATE bg_users SET open_to_recruitment = 0 (joueurs sans équipe)");
  });

  it("dit qu'il reste à jouer à la main quand le défaut ne revient pas", async () => {
    on(/^SELECT COLUMN_DEFAULT/, () => [[{ columnDefault: "1" }], undefined]);
    fail(BACKFILL, "ER_LOCK_WAIT_TIMEOUT");
    fail(RESTORE, "ER_LOCK_WAIT_TIMEOUT");

    await expect(getDatabase()).resolves.toBeDefined();

    expect(errors()).toContain("il est à jouer à la main");
  });

  it("ne fait rien quand le défaut ne se lit pas", async () => {
    fail(/^SELECT COLUMN_DEFAULT/, "ER_TABLEACCESS_DENIED_ERROR");

    await getDatabase();

    expect(count(SWITCH)).toBe(0);
    expect(errors()).toContain("lecture du défaut de bg_users.open_to_recruitment");
  });

  it("ne fait rien quand la colonne n'a pas de défaut lisible", async () => {
    on(/^SELECT COLUMN_DEFAULT/, () => [[], undefined]);

    await getDatabase();

    expect(count(SWITCH)).toBe(0);
  });
});

describe("dropUserEmail — l'effacement, même sans DDL", () => {
  const DROP = /^ALTER TABLE bg_users DROP COLUMN email/;
  const ERASE = /^UPDATE bg_users SET email = NULL WHERE email IS NOT NULL/;

  it("vide les adresses quand le DROP est refusé, et dit combien", async () => {
    fail(DROP, "ER_LOCK_WAIT_TIMEOUT");
    on(ERASE, () => [{ affectedRows: 4 }, undefined]);

    await getDatabase();

    expect(rank(ERASE)).toBeGreaterThan(rank(DROP));
    expect(errors()).toContain("4 adresse(s) ont été vidées à la place");
  });

  it("ne dit rien de plus quand il n'y avait plus d'adresse", async () => {
    fail(DROP, "ER_LOCK_WAIT_TIMEOUT");
    on(ERASE, () => [{ affectedRows: 0 }, undefined]);

    await getDatabase();

    expect(errors()).not.toContain("vidées à la place");
  });

  it("dit quand les adresses n'ont pu être ni retirées ni vidées", async () => {
    fail(DROP, "ER_LOCK_WAIT_TIMEOUT");
    fail(ERASE, "ER_LOCK_WAIT_TIMEOUT");

    await expect(getDatabase()).resolves.toBeDefined();

    expect(errors()).toContain("n'ont pu être ni retirées ni vidées");
  });

  it("ne vide rien quand la colonne est déjà partie", async () => {
    await getDatabase();
    expect(count(ERASE)).toBe(0);
  });
});

describe("dropSiteVisitUserId", () => {
  const CARRY = /^UPDATE bg_site_visits SET authenticated = 1/;
  const DROP = /^ALTER TABLE bg_site_visits DROP COLUMN user_id/;
  const ERASE = /^UPDATE bg_site_visits SET user_id = NULL/;

  it("reporte authenticated avant de retirer la colonne", async () => {
    on(CARRY, () => [{ affectedRows: 3 }, undefined]);
    on(DROP, () => OK);

    await getDatabase();

    expect(rank(DROP)).toBeGreaterThan(rank(CARRY));
    expect(count(ERASE)).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("dit un report qui échoue pour une autre raison qu'une colonne absente", async () => {
    fail(CARRY, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(errors()).toContain("report depuis user_id");
  });

  it("vide la colonne quand le DROP est refusé", async () => {
    fail(DROP, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(rank(ERASE)).toBeGreaterThan(rank(DROP));
    expect(errors()).toContain("la colonne a été vidée à la place");
  });

  it("dit quand la colonne n'a pu être ni retirée ni vidée", async () => {
    fail(DROP, "ER_LOCK_WAIT_TIMEOUT");
    fail(ERASE, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(errors()).toContain("bg_site_visits.user_id n'a pu être ni retirée ni vidée");
  });
});

describe("seedSiteVisitors", () => {
  it("dit un échec de reprise sans faire tomber la passe", async () => {
    on(/^SELECT 1 FROM bg_site_visitors/, () => [[], undefined]);
    fail(/^INSERT INTO bg_site_visitors/, "ER_LOCK_WAIT_TIMEOUT");

    await expect(getDatabase()).resolves.toBeDefined();

    expect(errors()).toContain("reprise des empreintes");
    // Les étapes suivantes sont jouées.
    expect(rank(/^UPDATE bg_recruitment_ads SET priority/)).toBeGreaterThan(-1);
  });
});

describe("migrateRecruitmentPriority", () => {
  const CARRY = /^UPDATE bg_recruitment_ads SET priority/;
  const DROP = /^ALTER TABLE bg_recruitment_ads DROP COLUMN highlight/;

  it("reporte la mise en avant puis retire la source", async () => {
    on(CARRY, () => [{ affectedRows: 2 }, undefined]);

    await getDatabase();

    const update = issued[rank(CARRY)];
    expect(update).toContain("WHEN 'MODAL' THEN 'PRIORITY' WHEN 'BANNER' THEN 'IMPORTANT'");
    expect(update).toContain("highlight = 'NONE'");
    expect(rank(DROP)).toBeGreaterThan(rank(CARRY));
  });

  it("garde la source quand priority manque elle aussi", async () => {
    fail(/^SELECT priority FROM bg_recruitment_ads/, "ER_BAD_FIELD_ERROR");

    await getDatabase();

    expect(count(DROP)).toBe(0);
    expect(errors()).toContain("report depuis highlight");
  });

  it("garde la source quand le report échoue pour une autre raison", async () => {
    fail(CARRY, "ER_LOCK_WAIT_TIMEOUT");

    await getDatabase();

    expect(count(DROP)).toBe(0);
    // Le départage par `priority` n'a lieu que sur une colonne inconnue.
    expect(count(/^SELECT priority FROM/)).toBe(0);
  });
});

describe("applyPermanentCatchUps", () => {
  it("ne remplace que les invitations Discord périmées connues", async () => {
    await getDatabase();

    const call = execute.mock.calls.find(([sql]) => flat(sql).startsWith("UPDATE bg_settings SET setting_value = ?"));
    expect(call?.[1]).toEqual([DISCORD_INVITE_URL, CONTACT_DISCORD_URL_KEY, ...SUPERSEDED_DISCORD_INVITE_URLS]);
    expect(flat(call?.[0] ?? "")).toContain(
      `IN (${SUPERSEDED_DISCORD_INVITE_URLS.map(() => "?").join(", ")})`,
    );
  });

  it("vide les courriels de contact faux connus, et eux seuls", async () => {
    await getDatabase();

    const call = execute.mock.calls.find(([sql]) => flat(sql).startsWith("UPDATE bg_settings SET setting_value = ''"));
    expect(call?.[1]).toEqual([CONTACT_EMAIL_KEY, ...SUPERSEDED_CONTACT_EMAILS]);
  });

  it("retire le logo d'une entrée solo dont l'avatar est masqué", async () => {
    await getDatabase();

    const update = issued[rank(/^UPDATE bg_teams t JOIN bg_users u/)];
    expect(update).toContain("SET t.logo_url = NULL");
    expect(update).toContain("u.visible_avatar = 0");
  });

  it("avale chaque échec sans emporter le rattrapage suivant ni le filet", async () => {
    fail(/^UPDATE bg_settings/, "ER_LOCK_WAIT_TIMEOUT");
    fail(/^UPDATE bg_teams t JOIN bg_users u/, "ER_LOCK_WAIT_TIMEOUT");

    await expect(getDatabase()).resolves.toBeDefined();

    expect(count(/^UPDATE bg_settings/)).toBe(2);
    expect(rank(/^SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE/)).toBeGreaterThan(
      rank(/^UPDATE bg_teams t JOIN bg_users u/),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("warnIfSchemaIsBehind — le filet", () => {
  function witnesses(rows: { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string }[]): void {
    on(/^SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE/, () => [rows, undefined]);
  }
  const ALL_WITNESSES = [
    { TABLE_NAME: "bg_tournaments", COLUMN_NAME: "game", COLUMN_TYPE: "enum('OW','MR')" },
    { TABLE_NAME: "bg_tournaments", COLUMN_NAME: "match_format_max_maps", COLUMN_TYPE: "int" },
    { TABLE_NAME: "bg_tournaments", COLUMN_NAME: "endurance_playoff_format_type", COLUMN_TYPE: "enum('BO')" },
    { TABLE_NAME: "bg_matches", COLUMN_NAME: "phase_id", COLUMN_TYPE: "bigint" },
  ];

  it("interroge les cinq témoins par couples (table, colonne)", async () => {
    await getDatabase();

    const call = execute.mock.calls.find(([sql]) => flat(sql).startsWith("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE"));
    expect(call?.[1]).toEqual([
      "bg_users", "email",
      "bg_tournaments", "game",
      "bg_tournaments", "match_format_max_maps",
      "bg_tournaments", "endurance_playoff_format_type",
      "bg_matches", "phase_id",
    ]);
  });

  it("dit une colonne qui devait partir et qui est encore là", async () => {
    witnesses([...ALL_WITNESSES, { TABLE_NAME: "bg_users", COLUMN_NAME: "email", COLUMN_TYPE: "varchar(255)" }]);

    await getDatabase();

    expect(errors()).toContain("bg_users.email devrait avoir disparu");
    expect(errors()).toContain("migrer à la main (docs/DATABASE_SCHEMA.md)");
  });

  it("dit un témoin absent", async () => {
    witnesses(ALL_WITNESSES.filter((w) => w.COLUMN_NAME !== "phase_id"));

    await getDatabase();

    expect(errors()).toContain("bg_matches.phase_id manque");
  });

  it("dit un ENUM resté avant sa conversion", async () => {
    witnesses(ALL_WITNESSES.map((w) => (w.COLUMN_NAME === "game" ? { ...w, COLUMN_TYPE: "enum('OW2','MR')" } : w)));

    await getDatabase();

    expect(errors()).toContain("bg_tournaments.game est resté « enum('OW2','MR') », sans 'OW'");
  });

  it("dit un ENUM à demi converti, qui porte encore l'ancienne valeur", async () => {
    witnesses(
      ALL_WITNESSES.map((w) => (w.COLUMN_NAME === "game" ? { ...w, COLUMN_TYPE: "enum('OW2','MR','OW')" } : w)),
    );

    await getDatabase();

    expect(errors()).toContain("bg_tournaments.game porte encore 'OW2'");
  });

  it("dit les colonnes déclarées manquantes d'une table présente, pas celles d'une table absente", async () => {
    on(/^SELECT TABLE_NAME t, COLUMN_NAME c/, () => [
      declaredRows().filter(
        (r) => !(r.t === "bg_users" && r.c === "discord_verified_at") && r.t !== "bg_match_reminders",
      ),
      undefined,
    ]);

    await getDatabase();

    expect(errors()).toContain("1 colonne(s) déclarée(s) manquante(s) : bg_users.discord_verified_at");
    expect(errors()).not.toContain("bg_match_reminders");
  });

  it("ne compte qu'une fois chaque table, même quand la passe est rejouée", async () => {
    on(/^SELECT TABLE_NAME t, COLUMN_NAME c/, () => [
      declaredRows().filter((r) => !(r.t === "bg_users" && r.c === "discord_verified_at")),
      undefined,
    ]);

    await getDatabase();
    await getDatabase();

    const reports = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report).toContain("1 colonne(s) déclarée(s) manquante(s)");
    }
  });

  it("dit un index unique manquant", async () => {
    on(/^SELECT DISTINCT INDEX_NAME/, () => [[{ INDEX_NAME: "uniq_bg_teams_tag" }], undefined]);

    await getDatabase();

    expect(errors()).toContain("l'index uniq_bg_teams_solo_user manque sur bg_teams");
    expect(errors()).not.toContain("uniq_bg_teams_tag manque");
  });

  it("dit une clé primaire restée sans phase", async () => {
    on(/^SELECT TABLE_NAME t, COUNT\(\*\) n/, () => [
      [{ t: "bg_swiss_standings", n: 2 }, { t: "bg_survival_standings", n: 3 }],
      undefined,
    ]);

    await getDatabase();

    expect(errors()).toContain("la clé primaire de bg_swiss_standings n'a que 2 colonne(s) au lieu de 3");
    expect(errors()).not.toContain("bg_survival_standings");
  });

  it("garde les constats de la première sonde quand la seconde échoue", async () => {
    witnesses(ALL_WITNESSES.filter((w) => w.COLUMN_NAME !== "phase_id"));
    fail(/^SELECT TABLE_NAME t, COLUMN_NAME c/, "ER_TABLEACCESS_DENIED_ERROR");

    await getDatabase();

    expect(errors()).toContain("bg_matches.phase_id manque");
  });

  it("garde les constats de la seconde sonde quand la première échoue", async () => {
    fail(/^SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE/, "ER_TABLEACCESS_DENIED_ERROR");
    on(/^SELECT DISTINCT INDEX_NAME/, () => [[], undefined]);

    await getDatabase();

    expect(errors()).toContain("l'index uniq_bg_teams_tag manque");
  });

  it("ne devient jamais la panne qu'il signale", async () => {
    fail(/^SELECT (TABLE_NAME|DISTINCT INDEX_NAME)/, "ER_TABLEACCESS_DENIED_ERROR");

    await expect(getDatabase()).resolves.toBeDefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("withConnection", () => {
  it("rend la connexion au pool après une lecture réussie", async () => {
    release.mockClear();
    await expect(withConnection(async () => 42)).resolves.toBe(42);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rend la connexion au pool même quand la lecture lève", async () => {
    release.mockClear();
    await expect(
      withConnection(async () => {
        throw new Error("BOOM");
      }),
    ).rejects.toThrow("BOOM");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("getDatabase — configuration", () => {
  it("refuse de créer un pool sans hôte configuré", async () => {
    await jest.isolateModulesAsync(async () => {
      const saved = process.env.DB_HOST;
      // Vide plutôt qu'absente : `dotenv/config` rechargerait sinon le `.env` local.
      process.env.DB_HOST = "";
      try {
        const fresh = await import("@/lib/server/database");
        await expect(fresh.getDatabase()).rejects.toThrow("Missing required environment variable DB_HOST");
      } finally {
        process.env.DB_HOST = saved;
      }
    });
  });

  it("crée un pool borné, en utf8mb4, aux dates rendues en chaînes", () => {
    expect(createPool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        connectionLimit: 25,
        charset: "utf8mb4",
        dateStrings: true,
        namedPlaceholders: true,
        waitForConnections: true,
      }),
    );
  });
});

describe("getDatabase — rattrapage des comptes supprimés", () => {
  type ReconcileResult = { erased: number; renamed: number; failed: number };
  const state = globalThis as typeof globalThis & { __bgDeletedAccountsReconciliation?: Promise<void> };

  async function runOnServer(reconcile: () => Promise<ReconcileResult>): Promise<jest.Mock<() => Promise<ReconcileResult>>> {
    const mock = jest.fn(reconcile);
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/users-service", () => ({ reconcileDeletedAccounts: mock }));
      process.env.NEXT_RUNTIME = "nodejs";
      try {
        const fresh = await import("@/lib/server/database");
        await fresh.getDatabase();
        await fresh.getDatabase();
        await state.__bgDeletedAccountsReconciliation;
      } finally {
        delete process.env.NEXT_RUNTIME;
      }
    });
    return mock;
  }

  afterEach(() => {
    delete state.__bgDeletedAccountsReconciliation;
  });

  it("ne le lance pas hors du serveur du site (scripts, seed)", async () => {
    await getDatabase();
    expect(state.__bgDeletedAccountsReconciliation).toBeUndefined();
  });

  it("le lance une seule fois par processus, et dit ce qu'il a fait", async () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const reconcile = await runOnServer(async () => ({ erased: 1, renamed: 2, failed: 0 }));

      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(String(infoSpy.mock.calls[0]?.[0])).toContain("1 effacé(s), 2 renommé(s), 0 reporté(s)");
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("se tait quand il n'y avait rien à rattraper", async () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await runOnServer(async () => ({ erased: 0, renamed: 0, failed: 0 }));
      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("dit son échec sans faire tomber getDatabase", async () => {
    await runOnServer(async () => {
      throw new Error("DB_DOWN");
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "[deleted-accounts] Rattrapage des comptes supprimés impossible :",
      "DB_DOWN",
    );
  });
});
