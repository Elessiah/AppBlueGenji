import { describe, expect, it } from "@jest/globals";
import { readDatabaseSource, readSource } from "../../helpers/read-source";

const SQL = readDatabaseSource();
const RECENT = readSource("lib/server/database/recent-schema-changes.ts");

/** Instruction réduite à une ligne. */
function flat(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** Les trois instructions de la migration, dans l'ordre de la source. */
function migrationStatements(): string[] {
  const statements = [...RECENT.matchAll(/`([^`]*)`/g)].map((match) => flat(match[1]));
  return statements.filter(
    (statement) =>
      statement.startsWith("INSERT INTO bg_match_streams") ||
      statement.startsWith("INSERT IGNORE INTO bg_match_casters") ||
      statement.startsWith("UPDATE bg_matches m SET m.live_url = NULL"),
  );
}

/**
 * Co-casters et streams multiples (`docs/features/MATCH_LAUNCH.md` § Casters
 * et streams) : le caster unique et le lien de `bg_matches` passent dans
 * `bg_match_streams` / `bg_match_casters`.
 *
 * Les migrations tournent contre la vraie base et ne s'exécutent pas ici : ce
 * qui se vérifie est ce qui se lit dans la source — les tables d'une base
 * neuve, l'**ordre** des trois instructions et les **gardes** qui les rendent
 * rejouables à chaque démarrage sans rien dupliquer ni rien perdre.
 */
describe("bg_match_streams / bg_match_casters — migration du caster unique", () => {
  it("crée les deux tables sur une base neuve, la clé composée liant un caster à un stream de son match", () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS bg_match_streams \(/);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS bg_match_casters \(/);
    expect(SQL).toMatch(/UNIQUE KEY uq_bg_match_streams_match \(match_id, id\)/);
    expect(SQL).toMatch(
      /FOREIGN KEY \(match_id, stream_id\)\s*REFERENCES bg_match_streams\(match_id, id\) ON DELETE CASCADE/,
    );
    // Un compte effacé emporte ses inscriptions ; un match supprimé, ses streams.
    expect(SQL).toMatch(/fk_bg_match_casters_user FOREIGN KEY \(user_id\)\s*REFERENCES bg_users\(id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/fk_bg_match_streams_match FOREIGN KEY \(match_id\)\s*REFERENCES bg_matches\(id\) ON DELETE CASCADE/);
    // Aucun plafond : la clé primaire n'empêche qu'un doublon du même caster.
    expect(SQL).toMatch(/PRIMARY KEY \(match_id, user_id\)/);
  });

  it("joue ses trois instructions dans l'ordre : streams, casters, puis vidage", () => {
    const statements = migrationStatements();
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^INSERT INTO bg_match_streams/);
    expect(statements[1]).toMatch(/^INSERT IGNORE INTO bg_match_casters/);
    expect(statements[2]).toMatch(/^UPDATE bg_matches m SET m\.live_url = NULL, m\.caster_user_id = NULL, m\.caster_ready_at = NULL/);
  });

  it("marque le stream du staff : la colonne existe avant la copie, et un lien d'avant les co-casters est celui du staff", () => {
    expect(SQL).toMatch(/live_url VARCHAR\(255\) NULL,\s*staff_owned TINYINT\(1\) NOT NULL DEFAULT 0,/);
    const all = [...RECENT.matchAll(/`([^`]*)`/g)].map((match) => flat(match[1]));
    const alter = all.indexOf(
      "ALTER TABLE bg_match_streams ADD COLUMN staff_owned TINYINT(1) NOT NULL DEFAULT 0 AFTER live_url",
    );
    const copy = all.findIndex((statement) => statement.startsWith("INSERT INTO bg_match_streams"));
    expect(alter).toBeGreaterThanOrEqual(0);
    expect(alter).toBeLessThan(copy);
    expect(all[copy]).toContain(
      "INSERT INTO bg_match_streams (match_id, live_url, staff_owned) SELECT m.id, m.live_url, m.live_url IS NOT NULL FROM bg_matches m",
    );
  });

  it("rattache le lien d'un stream de caster à son fournisseur : colonne, index, rattrapage rejouable", () => {
    expect(SQL).toMatch(/staff_owned TINYINT\(1\) NOT NULL DEFAULT 0,\s*link_user_id BIGINT NULL,/);
    expect(SQL).toMatch(/INDEX idx_bg_match_streams_link_user \(link_user_id\)/);
    const all = [...RECENT.matchAll(/`([^`]*)`/g)].map((match) => flat(match[1]));
    const column = all.indexOf("ALTER TABLE bg_match_streams ADD COLUMN link_user_id BIGINT NULL AFTER staff_owned");
    const index = all.indexOf("ALTER TABLE bg_match_streams ADD INDEX idx_bg_match_streams_link_user (link_user_id)");
    const casters = all.findIndex((statement) => statement.startsWith("INSERT IGNORE INTO bg_match_casters"));
    const backfill = all.findIndex((statement) => statement.startsWith("UPDATE bg_match_streams s SET s.link_user_id"));
    expect(column).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(column);
    // Après la copie des casters : le rattrapage lit leurs lignes.
    expect(backfill).toBeGreaterThan(casters);
    const sql = all[backfill];
    // Jamais le lien du staff ; seulement un stream qu'un seul caster tient ;
    // jamais un lien déjà rattaché — un second passage ne change rien.
    expect(sql).toContain("WHERE s.staff_owned = 0 AND s.live_url IS NOT NULL AND s.link_user_id IS NULL");
    expect(sql).toContain("(SELECT COUNT(*) FROM bg_match_casters c WHERE c.match_id = s.match_id AND c.stream_id = s.id) = 1");
    expect(sql).toContain(
      "SET s.link_user_id = (SELECT MIN(c.user_id) FROM bg_match_casters c WHERE c.match_id = s.match_id AND c.stream_id = s.id)",
    );
    // MariaDB : la sous-requête lit une autre table que celle mise à jour.
    expect(sql).not.toMatch(/\(SELECT[^)]*FROM bg_match_streams/);
  });

  it("ne rattache le lien qu'au caster qui a ouvert le stream, jamais à un co-caster resté seul", () => {
    const all = [...RECENT.matchAll(/`([^`]*)`/g)].map((match) => flat(match[1]));
    const sql = all.find((statement) => statement.startsWith("UPDATE bg_match_streams s SET s.link_user_id")) ?? "";
    expect(sql).toContain(
      "(SELECT COUNT(*) FROM bg_match_casters c WHERE c.match_id = s.match_id AND c.stream_id = s.id AND c.created_at <= s.created_at + INTERVAL 1 SECOND) = 1",
    );
  });

  it("retire, après le rattrapage, le lien encore rattaché à un compte supprimé", () => {
    const all = [...RECENT.matchAll(/`([^`]*)`/g)].map((match) => flat(match[1]));
    const backfill = all.findIndex((statement) => statement.startsWith("UPDATE bg_match_streams s SET s.link_user_id"));
    const cleanup = all.indexOf(
      "UPDATE bg_match_streams s LEFT JOIN bg_users u ON u.id = s.link_user_id SET s.live_url = NULL, s.link_user_id = NULL WHERE s.link_user_id IS NOT NULL AND (u.id IS NULL OR u.is_deleted = 1)",
    );
    expect(cleanup).toBeGreaterThan(backfill);
  });

  it("n'ouvre jamais un second stream à un match qui en a déjà un", () => {
    const [streams] = migrationStatements();
    expect(streams).toContain("WHERE (m.live_url IS NOT NULL OR m.caster_user_id IS NOT NULL)");
    expect(streams).toContain("AND NOT EXISTS (SELECT 1 FROM bg_match_streams s WHERE s.match_id = m.id)");
  });

  it("pose le caster sur le premier stream, avec son « Prêt », sans jamais lever sur un doublon", () => {
    const [, casters] = migrationStatements();
    expect(casters).toContain("SELECT m.id, m.caster_user_id, (SELECT MIN(s.id) FROM bg_match_streams s WHERE s.match_id = m.id), m.caster_ready_at");
    expect(casters).toContain("WHERE m.caster_user_id IS NOT NULL");
    // Sans stream (instruction 1 en échec), rien n'est tenté : la clé étrangère
    // refuserait un `stream_id` NULL.
    expect(casters).toContain("AND EXISTS (SELECT 1 FROM bg_match_streams s WHERE s.match_id = m.id)");
  });

  it("ne vide les anciennes colonnes que pour ce qui est arrivé dans les nouvelles tables", () => {
    const [, , clear] = migrationStatements();
    expect(clear).toContain("AND (m.live_url IS NULL OR EXISTS (SELECT 1 FROM bg_match_streams s WHERE s.match_id = m.id))");
    expect(clear).toContain(
      "AND (m.caster_user_id IS NULL OR EXISTS (SELECT 1 FROM bg_match_casters c WHERE c.match_id = m.id AND c.user_id = m.caster_user_id))",
    );
  });

  it("reste compatible MariaDB : aucun verrou ni syntaxe propre à MySQL", () => {
    for (const statement of migrationStatements()) {
      expect(statement).not.toMatch(/FOR UPDATE OF|FOR SHARE|ON DUPLICATE KEY UPDATE .* AS new/);
    }
  });

  it("ne laisse plus rien écrire les anciennes colonnes hors de la migration", () => {
    const writers = readSource("lib/server/tournaments/match-launch.ts") + readSource("lib/server/tournaments/live-streams.ts");
    expect(writers).not.toMatch(/SET[^`]*\bcaster_user_id\s*=/);
    expect(writers).not.toMatch(/SET[^`]*\bcaster_ready_at\s*=/);
    expect(writers).not.toMatch(/UPDATE bg_matches SET[^`]*\blive_url\s*=/);
  });
});
