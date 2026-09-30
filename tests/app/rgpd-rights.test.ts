import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `/rgpd` et les mentions légales ne se montent pas hors de Next : leurs
 * affirmations juridiques se contrôlent sur la source, comme `rgpd-backups.test.ts`.
 */
const ROOT = join(__dirname, "..", "..");
const RGPD = readFileSync(join(ROOT, "app", "rgpd", "page.tsx"), "utf8");
const MENTIONS = readFileSync(join(ROOT, "app", "mentions-legales", "page.tsx"), "utf8");

describe("/rgpd — droits des personnes", () => {
  it("ouvre la réclamation auprès de la CNIL à tout moment (art. 77), sans démarche préalable", () => {
    expect(RGPD).not.toMatch(/réponse insatisfaisante/);
    expect(RGPD).toMatch(/à tout moment introduire une réclamation, sans démarche\s+préalable/);
  });

  it("n'annonce plus l'art. 22, qu'aucun droit de la liste ne décrit", () => {
    expect(RGPD).not.toContain("ART. 15–22");
    expect(RGPD).toContain("RGPD ART. 7.3, 15–21 · LOI I&amp;L ART. 85");
  });

  it("dit quelles données sont obligatoires et ce qu'un refus coûte (art. 13.2.e)", () => {
    expect(RGPD).toContain("Données obligatoires et facultatives.");
    expect(RGPD).toMatch(/Sans moyen de\s+connexion, aucun compte ne peut être créé/);
  });
});

describe("/rgpd — palmarès et intérêt légitime", () => {
  it("ne se déclare plus « conforme au RGPD »", () => {
    expect(RGPD).not.toMatch(/conforme au RGPD/);
    expect(RGPD).not.toContain("CONFORMITÉ RGPD");
  });

  it("parle de pseudonymisation, pas d'anonymisation, et d'identifiants en ligne", () => {
    expect(RGPD).toContain("Pseudonymisation, pas anonymisation :");
    expect(RGPD).toMatch(/données personnelles \(des identifiants en ligne\)/);
    expect(RGPD).not.toMatch(/directement identifiable au sens strict/);
  });

  it("dit qu'aucune durée n'est fixée plutôt que de la taire", () => {
    expect(RGPD).toMatch(/aucune durée ni aucun critère de fin n&apos;est encore fixé/);
  });
});

describe("mentions légales — droits", () => {
  it("nomment la limitation et les directives post-mortem", () => {
    expect(MENTIONS).toMatch(/de limitation et de portabilité/);
    expect(MENTIONS).toMatch(/art\. 85 de la loi Informatique et Libertés/);
  });
});
