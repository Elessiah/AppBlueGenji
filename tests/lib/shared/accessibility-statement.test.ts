import { describe, expect, it } from "@jest/globals";
import {
  ACCESSIBILITY_STATEMENT_DATE,
  AUDIT_CONFORMITY_RATE,
  CONFORMITY_LABELS,
  CONFORMITY_STATUS,
  KNOWN_ISSUES,
  accessibilityFeatures,
  accessibilityFooterLabel,
  accessibilityStatementDateLabel,
  conformityStatusFor,
} from "@/lib/shared/accessibility-statement";
import { A11Y_SETTINGS } from "@/lib/shared/accessibility-settings";
import { publicSitemapRoutes } from "@/lib/shared/sitemap";

describe("conformityStatusFor — méthode RGAA", () => {
  it("sans audit, le site est non conforme", () => {
    expect(conformityStatusFor(null)).toBe("NONE");
  });

  it.each<[number, "TOTAL" | "PARTIAL" | "NONE"]>([
    [100, "TOTAL"],
    [99.9, "PARTIAL"],
    [50, "PARTIAL"],
    [49.9, "NONE"],
    [0, "NONE"],
  ])("%d %% → %s", (rate, status) => {
    expect(conformityStatusFor(rate)).toBe(status);
  });

  it("une valeur qui n'est pas un taux ne vaut pas mieux qu'une absence d'audit", () => {
    for (const rate of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) expect(conformityStatusFor(rate)).toBe("NONE");
  });

  it("le statut publié se déduit du taux, jamais écrit à la main", () => {
    expect(CONFORMITY_STATUS).toBe(conformityStatusFor(AUDIT_CONFORMITY_RATE));
  });
});

describe("mentions de la déclaration", () => {
  it("le pied de page reprend la mention du référentiel", () => {
    expect(accessibilityFooterLabel("NONE")).toBe("Accessibilité : non conforme");
    expect(accessibilityFooterLabel("PARTIAL")).toBe("Accessibilité : partiellement conforme");
    expect(accessibilityFooterLabel("TOTAL")).toBe("Accessibilité : totalement conforme");
    expect(accessibilityFooterLabel()).toBe(`Accessibilité : ${CONFORMITY_LABELS[CONFORMITY_STATUS]}`);
  });

  it("la date s'écrit en toutes lettres, le même jour quel que soit le fuseau du serveur", () => {
    expect(accessibilityStatementDateLabel("2026-09-24")).toBe("24 septembre 2026");
    // Le premier du mois prend l'ordinal, que `Intl` n'écrit pas.
    expect(accessibilityStatementDateLabel("2026-01-01")).toBe("1er janvier 2026");
    expect(accessibilityStatementDateLabel("2026-10-11")).toBe("11 octobre 2026");
    expect(ACCESSIBILITY_STATEMENT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("contenus non accessibles", () => {
  it("chaque limite nomme son critère et se décrit", () => {
    expect(KNOWN_ISSUES.length).toBeGreaterThan(0);
    for (const issue of KNOWN_ISSUES) {
      expect(issue.title.trim()).not.toBe("");
      expect(issue.criterion.trim()).not.toBe("");
      expect(issue.detail.trim()).not.toBe("");
      if (issue.workaround !== null) expect(issue.workaround.trim()).not.toBe("");
    }
    expect(new Set(KNOWN_ISSUES.map((issue) => issue.title)).size).toBe(KNOWN_ISSUES.length);
  });

  it("le contraste par défaut est déclaré, avec le réglage qui le contourne", () => {
    // Choix d'apparence assumé (le contraste renforcé reste désactivé par
    // défaut) : il doit donc figurer ici, et renvoyer au réglage par son nom.
    const contrast = KNOWN_ISSUES.find((issue) => issue.criterion.includes("1.4.3"));
    const setting = A11Y_SETTINGS.find((s) => s.key === "contrast");
    expect(contrast?.workaround).toContain(`« ${setting?.label} »`);
  });
});

describe("aides proposées", () => {
  it("reprennent le registre du menu, un réglage par ligne", () => {
    const features = accessibilityFeatures();
    expect(features).toHaveLength(A11Y_SETTINGS.length);
    A11Y_SETTINGS.forEach((setting, index) => expect(features[index]).toContain(setting.label));
  });
});

describe("référencement", () => {
  it("la déclaration figure au sitemap", () => {
    expect(publicSitemapRoutes().map((route) => route.path)).toContain("/accessibilite");
  });
});
