import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bulkTeamTag } from "@/lib/server/seed-cases";
import { checkTeamTag } from "@/lib/shared/team-tag";

/**
 * Le sigle **dans le schéma**, et les sigles que produit le jeu de test.
 *
 * Le schéma tourne contre un vrai MySQL et n'est pas exécutable ici : ce qui est
 * vérifié est ce qui se lit dans la source. Depuis la consolidation, le sigle
 * n'a plus de migration en trois temps — la colonne et son index unique naissent
 * avec la table —, mais deux propriétés restent décisives et se perdraient sans
 * bruit : la colonne est **nullable** (c'est ce qui laisse les entrées solo hors
 * de l'espace de noms sans une règle de plus, l'unicité MySQL ignorant les
 * `NULL`), et l'index porte un **nom**, que `mapTeamTagConflict` lit dans
 * `ER_DUP_ENTRY` pour distinguer « sigle pris » de « nom pris ».
 *
 * Les sigles du seed sont vérifiés pour une raison voisine : une collision ne se
 * découvrirait qu'en base, au premier `npm run seed`, sous la forme d'une équipe
 * manquante dans la matrice de cas.
 */

const ROOT = join(__dirname, "..", "..", "..");

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

describe("sigle d'équipe dans le schéma (lib/server/database.ts)", () => {
  const sql = source(join("lib", "server", "database.ts"));
  const teamsTable = sql.slice(
    sql.indexOf("CREATE TABLE IF NOT EXISTS bg_teams"),
    sql.indexOf("CREATE TABLE IF NOT EXISTS bg_team_members"),
  );

  it("déclare la colonne dans la table plutôt que par un ALTER de rattrapage", () => {
    expect(teamsTable).toMatch(/tag VARCHAR\(4\) NULL/);
    expect(sql).not.toMatch(/ALTER TABLE bg_teams\s+ADD COLUMN tag/);
  });

  it("la garde nullable — c'est ce qui laisse les entrées solo hors de l'espace de noms", () => {
    expect(teamsTable).not.toMatch(/tag VARCHAR\(4\) NOT NULL/);
  });

  it("nomme l'index unique — le refus lisible se décide sur ce nom", () => {
    expect(teamsTable).toMatch(/UNIQUE KEY uniq_bg_teams_tag \(tag\)/);
  });

  it("garde l'unique de l'entrée solo distinct de celui du sigle", () => {
    // `bg_teams` porte deux uniques : une collision de sigle annoncée « nom déjà
    // pris » enverrait corriger le mauvais champ.
    expect(teamsTable).toMatch(/UNIQUE KEY uniq_bg_teams_solo_user \(solo_user_id\)/);
  });
});

describe("sigles du jeu de test", () => {
  const seed = source(join("lib", "server", "seed.ts"));

  /** Sigles écrits à la main dans `seed.ts` (`tag: "XXXX"`). */
  const literals = [...seed.matchAll(/\btag:\s*"([^"]*)"/g)].map((match) => match[1]);

  it("en déclare autant que d'équipes nommées", () => {
    expect(literals.length).toBeGreaterThanOrEqual(18);
  });

  it("n'écrit que des sigles valides", () => {
    for (const tag of literals) {
      expect({ tag, check: checkTeamTag(tag) }).toEqual({
        tag,
        check: { ok: true, tag: tag.toUpperCase() },
      });
    }
  });

  it("couvre le cas de l'équipe sans sigle", () => {
    expect(seed).toMatch(/\btag:\s*null/);
  });

  it("ne déclare pas deux fois le même sigle", () => {
    expect(new Set(literals).size).toBe(literals.length);
  });

  it("produit des sigles de remplissage valides et tous distincts", () => {
    const generated = Array.from({ length: 200 }, (_, i) => bulkTeamTag(i + 1));
    for (const tag of generated) {
      expect(checkTeamTag(tag)).toEqual({ ok: true, tag });
    }
    expect(new Set(generated).size).toBe(generated.length);
  });

  it("tient le rang sur quatre caractères jusqu'au bout de la base 36", () => {
    expect(bulkTeamTag(1)).toBe("B001");
    expect(bulkTeamTag(140)).toBe("B03W");
    expect(bulkTeamTag(46655)).toBe("BZZZ");
  });

  it("refuse de produire un sigle trop long plutôt que de le laisser passer", () => {
    expect(() => bulkTeamTag(46656)).toThrow("BULK_TEAM_TAG_OVERFLOW");
  });

  it("ne fait jamais collision avec un sigle écrit à la main", () => {
    const generated = new Set(Array.from({ length: 200 }, (_, i) => bulkTeamTag(i + 1)));
    for (const tag of literals) {
      expect(generated.has(tag.toUpperCase())).toBe(false);
    }
  });
});
