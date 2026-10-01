/**
 * Caractérisation du rendu de `ReportProblemDialog` : chaque étape et chaque
 * variante de catégorie, rendues côté serveur (les effets ne s'exécutent pas).
 * Le portail est remplacé par son contenu, `document.body` par un objet vide.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});

import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ui/toast";
import { ReportProblemDialog } from "@/components/reports/ReportProblemDialog";
import { REPORT_CATEGORIES, REPORT_CATEGORY_DEFINITIONS, type ReportCategory } from "@/lib/shared/content-reports";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

function render(props: Partial<Parameters<typeof ReportProblemDialog>[0]> = {}): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <ReportProblemDialog pathname="/equipes/12" authenticated onClose={() => undefined} {...props} />
    </ToastProvider>,
  );
}

const DETAIL_CATEGORIES = REPORT_CATEGORIES.filter(
  (category): category is Exclude<ReportCategory, "CONTEST"> => category !== "CONTEST",
);

describe("ReportProblemDialog — choix de la catégorie", () => {
  it("liste chaque catégorie, plus le portail de modération hors site juste après la modération", () => {
    const html = render();
    for (const category of REPORT_CATEGORIES) {
      expect(html).toContain(`data-category="${category}"`);
    }
    const moderation = html.indexOf('data-category="MODERATION"');
    const external = html.indexOf("(portail de support, nouvel onglet)");
    expect(external).toBeGreaterThan(moderation);
    expect(html).toContain('aria-label="Choix de la catégorie"');
    expect(html).not.toContain("<form");
  });
});

describe("ReportProblemDialog — détail d'une catégorie", () => {
  it.each(DETAIL_CATEGORIES)("rend le formulaire de la catégorie %s, connecté", (category) => {
    const html = render({ initialCategory: category });
    const definition = REPORT_CATEGORY_DEFINITIONS[category];
    expect(html).toContain("<form");
    expect(html).toContain("← CHANGER DE CATÉGORIE");
    expect(html).toContain(definition.label.replaceAll("'", "&#x27;"));
    expect(html.includes("TES COORDONNÉES")).toBe(definition.requiresContact);
    expect(html.includes("Adresse pour te répondre")).toBe(!definition.requiresContact);
    expect(html).toContain("Tes données");
  });

  it.each(DETAIL_CATEGORIES)("rend le formulaire de la catégorie %s, sans compte", (category) => {
    const html = render({ initialCategory: category, authenticated: false });
    const definition = REPORT_CATEGORY_DEFINITIONS[category];
    expect(html.includes("désigner directement")).toBe(definition.targets.length > 0);
  });

  it("annonce le portail de support sous la catégorie modération", () => {
    expect(render({ initialCategory: "MODERATION" })).toContain("portail de support BlueGenji");
  });
});

describe("ReportProblemDialog — contestation", () => {
  it("désigne le signalement contesté, sans retour au choix de catégorie", () => {
    const html = render({ contestOf: 42 });
    expect(html).toContain("Tu contestes le signalement n° 42.");
    expect(html).not.toContain("← CHANGER DE CATÉGORIE");
  });

  it("demande la connexion à un visiteur anonyme", () => {
    const html = render({ contestOf: 42, authenticated: false });
    expect(html).toContain("pour contester un signalement");
    expect(html).toContain("/connexion?redirect=%2Fequipes%2F12");
  });
});
