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
