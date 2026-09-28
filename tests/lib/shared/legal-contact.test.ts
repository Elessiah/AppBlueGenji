import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { LEGAL_CONTACT_DISCORD, REPORT_FORM_NAME, RGPD_CONTACT_LINE } from "@/lib/shared/legal-contact";
import { readSource } from "../../helpers/read-source";

/**
 * Le site ne publie plus aucune adresse électronique de contact.
 *
 * Une adresse écrite dans une page — ou seulement dans ce dépôt, qui est
 * public — est moissonnée par les robots. Les pages qui disent « nous
 * contacter » renvoient donc au tag Discord du responsable et au formulaire
 * « Signaler un problème » (catégories « RGPD » et « Hébergeur »).
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCANNED = ["app", "components", "lib", "docs", "README.md", "CLAUDE.md", ".env.production.example", ".env.example"];
const TEXT_EXT = /\.(ts|tsx|md|css|json|example)$/;
// Composée plutôt qu'écrite : ce fichier ne doit pas être celui qui la publie.
const RETIRED_ADDRESS = ["keryan.h", "outlook.fr"].join("@");
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function* textFiles(entry: string): Generator<string> {
  const absolute = join(ROOT, entry);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return;
  }
  if (stats.isFile()) {
    if (TEXT_EXT.test(absolute) || entry.startsWith(".env")) yield absolute;
    return;
  }
  for (const child of readdirSync(absolute)) {
    if (child === "node_modules" || child.startsWith(".")) continue;
    yield* textFiles(join(entry, child));
  }
}

describe("adresse électronique personnelle retirée", () => {
  it("n'apparaît plus nulle part dans les sources ni la documentation", () => {
    const offenders: string[] = [];
    for (const entry of SCANNED) {
      for (const file of textFiles(entry)) {
        if (readSource(file).toLowerCase().includes(RETIRED_ADDRESS)) offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("aucune variable d'environnement ne peut la remettre en page", () => {
    for (const entry of ["app", "components", "lib"]) {
      for (const file of textFiles(entry)) {
        expect([relative(ROOT, file), readSource(file).includes("RGPD_CONTACT_EMAIL")]).toEqual([
          relative(ROOT, file),
          false,
        ]);
      }
    }
  });

  it.each([
    "app/rgpd/page.tsx",
    "app/rgpd/registre/page.tsx",
    "app/rgpd/registre.csv/route.ts",
    "app/accessibilite/page.tsx",
    "app/mentions-legales/page.tsx",
    "lib/shared/bot-legal-content.ts",
    "lib/shared/processing-register.ts",
  ])("%s n'écrit aucune adresse électronique", (path) => {
    const source = readSource(path);
    expect(source).not.toMatch(EMAIL);
    expect(source).not.toContain("mailto:");
  });
});

describe("contact de remplacement", () => {
  it("nomme le tag Discord du responsable", () => {
    expect(LEGAL_CONTACT_DISCORD).toBe("elessiah");
  });

  it("nomme le bouton tel qu'il s'affiche au pied de chaque page", () => {
    expect(REPORT_FORM_NAME).toBe("Signaler un problème");
    const button = readSource("components/reports/ReportProblemButton.tsx");
    expect(button).toContain("label = REPORT_FORM_NAME");
  });

  it("ligne du registre : Discord puis le formulaire, catégorie RGPD, sans adresse", () => {
    expect(RGPD_CONTACT_LINE).toContain(LEGAL_CONTACT_DISCORD);
    expect(RGPD_CONTACT_LINE).toContain(REPORT_FORM_NAME);
    expect(RGPD_CONTACT_LINE).toContain("« RGPD »");
    expect(RGPD_CONTACT_LINE).not.toMatch(EMAIL);
  });

  it("/rgpd ouvre le formulaire directement sur la catégorie RGPD", () => {
    const page = readSource("app/rgpd/page.tsx");
    expect(page).toContain('initialCategory="RGPD"');
    expect(page).toContain("LEGAL_CONTACT_DISCORD");
  });

  it("le formulaire s'ouvre sur la catégorie demandée, focus dans la description, et reste modifiable", () => {
    const dialog = readSource("components/reports/ReportProblemDialog.tsx");
    expect(dialog).toContain('contestOf ? "CONTEST" : (initialCategory ?? null)');
    expect(dialog).toContain("contestOf !== undefined || initialCategory !== undefined");
    // Le retour au choix de catégorie n'est retiré qu'à une contestation.
    expect(dialog).toContain("{contestOf === undefined && (");
    const button = readSource("components/reports/ReportProblemButton.tsx");
    expect(button).toContain("initialCategory={initialCategory}");
  });

  it("les mentions légales renvoient l'hébergeur et les droits au formulaire", () => {
    const page = readSource("app/mentions-legales/page.tsx");
    expect(page).toContain("catégorie « Hébergeur »");
    expect(page).toContain("catégorie « RGPD »");
  });

  it("la déclaration d'accessibilité donne Discord et le formulaire", () => {
    const page = readSource("app/accessibilite/page.tsx");
    expect(page).toContain("LEGAL_CONTACT_DISCORD");
    expect(page).toContain("REPORT_FORM_NAME");
  });
});
