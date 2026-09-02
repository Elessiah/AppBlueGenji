import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bulkTeamTag } from "@/lib/server/seed-cases";
import { checkTeamTag } from "@/lib/shared/team-tag";

/**
 * La migration du sigle et les sigles que produit le jeu de test.
 *
 * Les migrations tournent contre un vrai MySQL et ne sont pas exécutables ici :
 * ce qui est vérifié est ce qui se lit dans la source — l'**ordre** des trois
 * étapes, qui est toute la correction de la manœuvre sur une base peuplée. Créer
 * l'index avant d'avoir libéré les doublons le ferait échouer, et comme chaque
 * étape est enveloppée dans un `try` (le schéma se rejoue à chaque démarrage),
 * l'échec serait **silencieux** : l'unicité ne serait jamais posée et rien ne le
 * dirait.
 *
 * Les sigles du seed sont vérifiés ici pour la même raison : une collision ne se
 * découvrirait qu'en base, au premier `npm run seed`, sous la forme d'une équipe
 * manquante dans la matrice de cas.
 */

const ROOT = join(__dirname, "..", "..", "..");

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

describe("migration du sigle (lib/server/database.ts)", () => {
  const sql = source(join("lib", "server", "database.ts"));

  it("ajoute la colonne, la libère de ses doublons, puis pose l'index — dans cet ordre", () => {
    const addColumn = sql.indexOf("ADD COLUMN tag VARCHAR(4) NULL");
    const upperCase = sql.indexOf("SET tag = UPPER(tag)");
    const dedupe = sql.indexOf("HAVING COUNT(*) > 1");
    const index = sql.indexOf("ADD UNIQUE INDEX uniq_bg_teams_tag");

    expect(addColumn).toBeGreaterThan(-1);
    expect(upperCase).toBeGreaterThan(addColumn);
    expect(dedupe).toBeGreaterThan(upperCase);
    expect(index).toBeGreaterThan(dedupe);
  });

  it("déclare la colonne nullable — c'est ce qui laisse les entrées solo hors de l'espace de noms", () => {
    expect(sql).toMatch(/ADD COLUMN tag VARCHAR\(4\) NULL/);
    expect(sql).not.toMatch(/ADD COLUMN tag VARCHAR\(4\) NOT NULL/);
  });

  it("conserve le sigle à la plus ancienne des équipes en conflit", () => {
    // `MIN(id)` plutôt qu'un choix arbitraire : la première à l'avoir pris le
    // garde, les autres le perdent et retombent sur leurs initiales.
    expect(sql).toMatch(/MIN\(id\) AS keep_id/);
    expect(sql).toMatch(/SET t\.tag = NULL/);
  });

  it("compare les doublons sans égard à la casse", () => {
    expect(sql).toMatch(/GROUP BY UPPER\(tag\)/);
    expect(sql).toMatch(/UPPER\(t\.tag\) = dupes\.normalized/);
  });

  it("compare octet à octet pour décider ce qui reste à mettre en majuscules", () => {
    // `tag <> UPPER(tag)` est toujours faux en collation insensible à la casse :
    // écrite ainsi, la mise en forme ne s'appliquait à aucune ligne.
    expect(sql).toMatch(/CAST\(tag AS BINARY\) <> CAST\(UPPER\(tag\) AS BINARY\)/);
    expect(sql).not.toMatch(/WHERE tag IS NOT NULL AND tag <> UPPER\(tag\)/);
  });

  it("n'invente aucun sigle de remplacement", () => {
    // Effacer, jamais suffixer : un sigle est un nom, il se choisit.
    expect(sql).not.toMatch(/CONCAT\(tag/);
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
