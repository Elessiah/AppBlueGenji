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
