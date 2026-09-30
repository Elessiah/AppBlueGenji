import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE_MINIMUM_AGE, TERMS_PATH, TERMS_SECTIONS } from "@/lib/shared/terms-of-use";
import { ORGANIZATION_FOUNDING_YEAR, organizationJsonLd } from "@/lib/shared/structured-data";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function section(id: string): string {
  const found = TERMS_SECTIONS.find((entry) => entry.id === id);
  if (!found) throw new Error(`section absente : ${id}`);
  return found.paragraphs.join("\n");
}

const ALL_TEXT = TERMS_SECTIONS.flatMap((entry) => [entry.title, ...entry.paragraphs]).join("\n");

describe("conditions d'utilisation — âge minimum", () => {
  it("fixe l'âge minimum d'un compte à 15 ans", () => {
    expect(SITE_MINIMUM_AGE).toBe(15);
  });

  it("l'écrit dans la section « Compte », comme une déclaration", () => {
    const compte = section("compte");
    expect(compte).toContain(`**au moins ${SITE_MINIMUM_AGE} ans** pour créer un compte`);
    expect(compte).toContain("déclare avoir atteint cet âge");
  });

  it("distingue le compte de l'adhésion, sans recopier l'âge des statuts", () => {
    const compte = section("compte");
    expect(compte).toContain("ne fait pas de son titulaire un **membre de l'association**");
    expect(compte).not.toContain("16 ans");
  });

  it("n'appelle plus « membre » un titulaire de compte", () => {
    // Deux emplois restent justes : l'adhérent de l'association et le joueur d'une équipe.
    const rest = ALL_TEXT.replace(/membre de l'association/g, "").replace(/membres des équipes/g, "");
    expect(rest).not.toMatch(/\bmembres?\b/i);
  });

  it("est repris par la politique de confidentialité, avec un lien vers la clause", () => {
    const rgpd = read("app/rgpd/page.tsx");
    expect(rgpd).toContain('id="age-minimum"');
    expect(rgpd).toContain("au moins {SITE_MINIMUM_AGE} ans");
    expect(rgpd).toContain("`${TERMS_PATH}#compte`");
    expect(TERMS_PATH).toBe("/conditions-utilisation");
  });
});

describe("conditions d'utilisation — licence sur les contenus", () => {
  const contenus = section("contenus");

  it("nomme l'étendue, la destination, le lieu et la durée (CPI L131-3)", () => {
    expect(contenus).toContain("**reproduire et de représenter**");
    expect(contenus).toContain("d'en adapter le format");
    expect(contenus).toContain("**sur le site et dans ses communications liées aux tournois**");
    expect(contenus).toContain("**pour le monde entier**");
    expect(contenus).toContain("**pour la durée de sa publication sur le site**");
  });

  it("dit que le retrait ne vaut que pour l'avenir", () => {
    expect(contenus).toContain("Le retrait vaut pour l'avenir");
    expect(contenus).toContain("**déjà faites** avant le retrait ne sont pas concernées");
  });

  it("répartit la responsabilité comme les droits d'édition de l'équipe", () => {
    expect(contenus).toContain("le **propriétaire** répond du nom, du sigle et de la description");
    expect(contenus).toContain("les **gérants** répondent de son logo");
    expect(contenus).not.toContain("qu'ils sont seuls à pouvoir modifier");
  });
});

describe("conditions d'utilisation — droit applicable", () => {
  it("réserve le for et la loi impérative du consommateur", () => {
    const droit = section("droit-applicable");
    expect(droit).toContain("tribunaux français sont compétents, sans préjudice");
    expect(droit).toContain("saisir la juridiction de son domicile");
  });
});

describe("année de fondation", () => {
  it("vaut 2022, et le JSON-LD la reprend", () => {
    expect(ORGANIZATION_FOUNDING_YEAR).toBe("2022");
    expect(organizationJsonLd("https://example.test", "desc").foundingDate).toBe("2022");
  });

  it.each<[string]>([["app/association/page.tsx"], ["components/cyber/landing/AboutSection.tsx"]])(
    "%s lit la constante plutôt qu'une année écrite à la main",
    (file) => {
      const source = read(file);
      expect(source).toContain("{ORGANIZATION_FOUNDING_YEAR}");
      expect(source).not.toMatch(/\b2020\b/);
    },
  );
});
