import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Index du bandeau de l'accueil (EF-07) : les trois derniers matchs terminés se
 * lisent sans trier l'historique. Deux endroits (CLAUDE.md) : le `CREATE TABLE`
 * des bases neuves et l'`ALTER TABLE` des bases existantes.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("index (status, updated_at) de bg_matches", () => {
  it("figure dans le CREATE TABLE des bases neuves", () => {
    expect(read("lib/server/database/schema/tournaments.ts")).toMatch(/INDEX idx_bg_matches_status_updated \(status, updated_at\)/);
  });

  it("est posé sur les bases existantes", () => {
    expect(read("lib/server/database/recent-schema-changes.ts")).toMatch(
      /`ALTER TABLE bg_matches ADD INDEX idx_bg_matches_status_updated \(status, updated_at\)`/,
    );
  });

  it("sert la requête du bandeau, qui filtre par statut et trie par date de mise à jour", () => {
    const service = read("lib/server/landing-service.ts");
    expect(service).toMatch(/WHERE m\.status = 'COMPLETED'[\s\S]*ORDER BY m\.updated_at DESC\s+LIMIT 3/);
  });
});

// EF-24 : l'index simple, préfixe strict du composé, est retiré ; le compteur
// « Équipes actives » (`solo_user_id IS NULL AND deleted_at IS NULL`) a le sien.
describe("index retiré et index du compteur d'équipes", () => {
  it("schema_newDatabase_noLongerCreatesStatusOnlyIndex", () => {
    expect(read("lib/server/database/schema/tournaments.ts")).not.toMatch(/INDEX idx_bg_matches_status \(status\)/);
  });

  it("recentSchemaChanges_existingDatabase_dropsStatusOnlyIndexAfterComposite", () => {
    const changes = read("lib/server/database/recent-schema-changes.ts");
    const composite = changes.indexOf("ADD INDEX idx_bg_matches_status_updated");
    const drop = changes.indexOf("`ALTER TABLE bg_matches DROP INDEX idx_bg_matches_status`");
    expect(composite).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(composite);
  });

  it("schema_teams_carriesSoloDeletedIndexInBothPlaces", () => {
    expect(read("lib/server/database/schema/teams.ts")).toMatch(/INDEX idx_bg_teams_solo_deleted \(solo_user_id, deleted_at\)/);
    expect(read("lib/server/database/recent-schema-changes.ts")).toContain(
      "`ALTER TABLE bg_teams ADD INDEX idx_bg_teams_solo_deleted (solo_user_id, deleted_at)`",
    );
  });
});
