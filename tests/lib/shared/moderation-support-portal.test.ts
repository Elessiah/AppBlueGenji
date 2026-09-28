import { describe, expect, it } from "@jest/globals";
import {
  MODERATION_SUPPORT_PORTAL_URL,
  OFF_SITE_CONDUCT_ENTRY,
  OFF_SITE_CONDUCT_NOTICE,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_DEFINITIONS,
} from "@/lib/shared/content-reports";
import { readSource } from "../../helpers/read-source";

describe("renvoi de la modération hors site vers le portail de support", () => {
  it("vise le portail Spiceworks de l'association, en https", () => {
    const url = new URL(MODERATION_SUPPORT_PORTAL_URL);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("bluegenjiesport.on.spiceworks.com");
    expect(url.pathname).toBe("/portal");
  });

  it("ne crée pas de catégorie : rien n'est enregistré pour un comportement en jeu", () => {
    expect(REPORT_CATEGORIES).toEqual(["COPYRIGHT", "MODERATION", "BUG", "OTHER", "CONTEST"]);
  });

  it("restreint la catégorie Modération aux contenus du site", () => {
    const hint = REPORT_CATEGORY_DEFINITIONS.MODERATION.hint;
    expect(hint).toContain("contenu du site");
    expect(hint).not.toMatch(/comportement/i);
  });

  it("nomme ce qui part ailleurs, sur la carte comme dans le rappel", () => {
    expect(OFF_SITE_CONDUCT_ENTRY.hint).toMatch(/insulte/);
    expect(OFF_SITE_CONDUCT_ENTRY.hint).toMatch(/portail de support/);
    for (const word of ["comportement en match", "insulte", "triche", "Discord"]) {
      expect(OFF_SITE_CONDUCT_NOTICE).toContain(word);
    }
  });
});

describe("ReportProblemDialog — lien vers le portail", () => {
  const source = readSource("components/reports/ReportProblemDialog.tsx");

  it("ouvre le portail dans un nouvel onglet, sans ouvreur ni référent", () => {
    const links = source.match(/href=\{MODERATION_SUPPORT_PORTAL_URL\}[\s\S]*?>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
    }
  });

  it("annonce le nouvel onglet aux technologies d'assistance", () => {
    expect(source.match(/nouvel onglet\)<\/span>/g) ?? []).toHaveLength(2);
  });

  it("place la carte juste après la catégorie Modération, et le rappel dans son étape", () => {
    expect(source).toContain('if (key !== "MODERATION") return [card];');
    expect(source).toContain('category === "MODERATION" && (');
  });
});
