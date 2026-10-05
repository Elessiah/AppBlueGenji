import { describe, expect, it } from "@jest/globals";
import { join } from "node:path";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { REPORT_STATUSES, REPORT_STATUS_PILL } from "@/lib/shared/content-reports";
import { PROFILE_SECTIONS, type ProfileSection } from "@/app/(secured)/profil/_lib/profile-sections";
import { globals, ROOT, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Lot « Profil » de LANDING_ANIMATIONS.md : sections teintées par le registre,
 * statistiques colorées, signalement en pastille, barre de navigation sans
 * orange — et chaque texte coloré lisible (4,5:1) sur son fond teinté.
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

const SURFACE = hex("--cyber-bg-3");
const SECTIONS: readonly ProfileSection[] = PROFILE_SECTIONS;
const PROFILE_CSS = stripComments(readSource(join(ROOT, "app", "(secured)", "profil", "profil.module.css")));
const COLD_TONES = ["blue", "violet", "cyan", "teal", "pink"];

/** Teinte de texte (`--tone-ink`) et de fond (`--tone-rgb`) de chaque `data-tone` de profil.module.css. */
const TONE_TOKENS: Record<string, { ink: string; rgb: string }> = {
  blue: { ink: "--blue-300", rgb: "--blue-500-rgb" },
  violet: { ink: "--violet-300", rgb: "--violet-400-rgb" },
  cyan: { ink: "--cyan-400", rgb: "--cyan-400-rgb" },
  teal: { ink: "--teal-400", rgb: "--teal-400-rgb" },
  pink: { ink: "--pink-400", rgb: "--pink-400-rgb" },
};

describe("teintes des sections de /profil", () => {
  it("donne à chaque section une teinte froide, le rouge à la seule zone de danger", () => {
    for (const section of SECTIONS) {
      if (section.id === "compte") expect(section.tone).toBe("danger");
      else expect(COLD_TONES).toContain(section.tone);
    }
  });

  it("définit chaque teinte dans la feuille du profil, texte et fond", () => {
    for (const [tone, { ink, rgb }] of Object.entries(TONE_TOKENS)) {
      const block = PROFILE_CSS.match(new RegExp(`\\[data-tone="${tone}"\\]\\s*\\{([^}]*)\\}`))![1];
      expect(block).toContain(`var(${ink})`);
      expect(block).toContain(`var(${rgb})`);
    }
  });

  it("garde chaque texte teinté lisible (AA) sur le fond le plus teinté de la page", () => {
    for (const { ink, rgb } of Object.values(TONE_TOKENS)) {
      const background = blend(SURFACE, triplet(rgb), 0.12);
      expect(contrastRatio(hex(ink), background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("pose la teinte sur la section, son lien de navigation et chaque statistique", () => {
    const component = readSource(join(ROOT, "app", "(secured)", "profil", "_components", "ProfileSection.tsx"));
    const page = readSource(join(ROOT, "app", "(secured)", "profil", "page.tsx"));
    expect(component).toContain("data-tone={section.tone}");
    expect(page).toContain("data-tone={entry.tone}");
    expect(page).toContain("data-tone={stat.tone}");
  });

  it("écrit la sauvegarde en texte sombre lisible sur chaque arrêt du dégradé de marque", () => {
    for (const stop of ["--cyan-400", "--blue-500", "--violet-400"]) {
      expect(contrastRatio(hex("--cyber-bg"), hex(stop))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("n'ajoute aucune teinte chaude", () => {
    expect(PROFILE_CSS).not.toMatch(/orange|amber|245, 165, 36|255, 157, 46/);
  });
});

describe("état d'un signalement en pastille", () => {
  it("donne à chaque état une variante, jamais le rouge du direct ni le vert d'une victoire", () => {
    for (const status of REPORT_STATUSES) {
      expect(["info", "accent", "neutral"]).toContain(REPORT_STATUS_PILL[status]);
    }
    expect(REPORT_STATUS_PILL.OPEN).toBe("info");
    expect(REPORT_STATUS_PILL.IN_PROGRESS).toBe("accent");
    expect(REPORT_STATUS_PILL.RESOLVED).toBe("neutral");
  });

  it("chaque variante existe dans le style global", () => {
    for (const variant of new Set(Object.values(REPORT_STATUS_PILL))) {
      expect(globals).toContain(`.pill-${variant}`);
    }
  });
});

describe("barre de navigation", () => {
  const nav = readSource(join(ROOT, "components", "arena-nav.tsx"));

  it("passe « Équipes » au violet des pages d'équipe, sans aucune teinte chaude", () => {
    expect(nav).toMatch(/label: "Équipes", rgb: "var\(--violet-400-rgb\)"/);
    expect(nav).toMatch(/label: "Joueurs", rgb: "var\(--blue-500-rgb\)"/);
    expect(nav).toMatch(/label: "Tournois", rgb: "var\(--teal-400-rgb\)"/);
    expect(nav).not.toMatch(/255, 157, 46|orange/);
  });
});
