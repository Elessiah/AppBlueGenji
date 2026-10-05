import { describe, expect, it } from "@jest/globals";
import { join } from "node:path";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { RECRUITMENT_DOMAINS, RECRUITMENT_DOMAIN_PILL } from "@/lib/shared/recruitment";
import { RULE_MODE_TONE, RULE_STATUS_PILL } from "@/lib/shared/rules-display";
import { TOURNAMENT_RULE_MODES } from "@/lib/shared/tournament-rules";
import { globals, ROOT, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Lot « Règles et vitrine » de LANDING_ANIMATIONS.md : modes de tournoi teintés
 * (carte, page, pastille), pastilles de domaine des annonces, titres en dégradé
 * de marque — et chaque texte coloré lisible (4,5:1) sur son fond teinté.
 */

const root = stripComments(globals).match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];
const hex = (name: string) => root.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))![1];
const triplet = (name: string) =>
  root
    .match(new RegExp(`${name}:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+);`))!
    .slice(1, 4)
    .map(Number);

function blend(baseHex: string, tint: number[], alpha: number): string {
  const base = [1, 3, 5].map((i) => Number.parseInt(baseHex.slice(i, i + 2), 16));
  const mixed = base.map((c, i) => Math.round(c * (1 - alpha) + tint[i] * alpha));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const TONE_TOKENS: Record<string, { ink: string; rgb: string }> = {
  blue: { ink: "--blue-300", rgb: "--blue-500-rgb" },
  violet: { ink: "--violet-300", rgb: "--violet-400-rgb" },
  cyan: { ink: "--cyan-400", rgb: "--cyan-400-rgb" },
  teal: { ink: "--teal-400", rgb: "--teal-400-rgb" },
  pink: { ink: "--pink-400", rgb: "--pink-400-rgb" },
};

const css = (...segments: string[]) => stripComments(readSource(join(ROOT, ...segments)));
const INDEX_CSS = css("app", "regles", "page.module.css");
const MODE_CSS = css("app", "regles", "[slug]", "page.module.css");

describe("teintes des modes de tournoi", () => {
  it("donne à chaque mode publié une teinte froide", () => {
    for (const mode of TOURNAMENT_RULE_MODES) {
      expect(Object.keys(TONE_TOKENS)).toContain(RULE_MODE_TONE[mode.diagram]);
    }
  });

  it("distingue les deux modes à élimination", () => {
    expect(RULE_MODE_TONE.SINGLE).not.toBe(RULE_MODE_TONE.DOUBLE);
  });

  it("définit chaque teinte, texte et fond, dans les deux feuilles des règles", () => {
    for (const [tone, { ink, rgb }] of Object.entries(TONE_TOKENS)) {
      for (const sheet of [INDEX_CSS, MODE_CSS]) {
        const block = sheet.match(new RegExp(`\\[data-tone="${tone}"\\]\\s*\\{([^}]*)\\}`))![1];
        expect(block).toContain(`var(${ink})`);
        expect(block).toContain(`var(${rgb})`);
      }
    }
  });

  it("garde chaque texte teinté lisible (AA) sur le voile le plus teinté", () => {
    for (const surface of [hex("--cyber-bg-3"), hex("--cyber-bg")]) {
      for (const { ink, rgb } of Object.values(TONE_TOKENS)) {
        expect(contrastRatio(hex(ink), blend(surface, triplet(rgb), 0.12))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("pose la teinte sur la carte d'index, la page du mode et ses voisins", () => {
    const index = readSource(join(ROOT, "app", "regles", "page.tsx"));
    const page = readSource(join(ROOT, "app", "regles", "[slug]", "page.tsx"));
    expect(index).toContain("tone={RULE_MODE_TONE[mode.diagram]}");
    expect(page).toContain("data-tone={RULE_MODE_TONE[mode.diagram]}");
    expect(page).toContain("data-tone={RULE_MODE_TONE[other.diagram]}");
  });

  it("n'ajoute aucune teinte chaude aux feuilles d'index", () => {
    expect(INDEX_CSS).not.toMatch(/orange|amber|245, 165, 36/);
  });
});

describe("pastilles des pages vitrine", () => {
  it("oppose « Disponible » et « Bientôt » par deux variantes de sens, jamais gris", () => {
    expect(RULE_STATUS_PILL.AVAILABLE).toBe("success");
    expect(RULE_STATUS_PILL.SOON).toBe("accent");
  });

  it("donne à chaque domaine d'annonce une variante froide, ni rouge ni gris", () => {
    for (const domain of RECRUITMENT_DOMAINS) {
      expect(["info", "accent", "success", "highlight"]).toContain(RECRUITMENT_DOMAIN_PILL[domain]);
    }
  });

  it("lit la pastille de domaine depuis la table, sur la carte et dans la modale", () => {
    for (const file of ["RecruitmentSection.tsx", "AdDetailModal.tsx"]) {
      expect(readSource(join(ROOT, "app", "recrutement", file))).toContain(
        "variant={RECRUITMENT_DOMAIN_PILL[ad.domain]}",
      );
    }
  });
});

describe("titres en dégradé de marque", () => {
  it("peint le titre (ou sa chute) des pages publiques avec `.text-gradient`", () => {
    const pages = [
      ["app", "regles", "page.tsx"],
      ["app", "regles", "[slug]", "page.tsx"],
      ["app", "association", "page.tsx"],
      ["app", "benevoles", "page.tsx"],
      ["app", "recrutement", "page.tsx"],
      ["app", "mentions-legales", "page.tsx"],
      ["app", "rgpd", "page.tsx"],
      ["app", "rgpd", "registre", "page.tsx"],
      ["app", "conditions-utilisation", "page.tsx"],
      ["app", "accessibilite", "page.tsx"],
      ["components", "legal", "BotLegalDoc.tsx"],
      ["app", "connexion", "_components", "LoginForm.tsx"],
    ];
    for (const segments of pages) {
      expect(readSource(join(ROOT, ...segments))).toContain("text-gradient");
    }
  });
});
