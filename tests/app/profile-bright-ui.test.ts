import { describe, expect, it } from "@jest/globals";
import { join } from "node:path";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { REPORT_STATUSES, REPORT_STATUS_PILL } from "@/lib/shared/content-reports";
import { PROFILE_SECTIONS, type ProfileSection } from "@/app/(secured)/profil/_lib/profile-sections";
import { globals, ROOT, stripComments } from "./_lib/style-sweep";
import { blend, COLD_TONE_TOKENS as TONE_TOKENS, tokenHex as hex, tokenTriplet as triplet } from "./_lib/tone-contrast";
import { readSource } from "../helpers/read-source";

/**
 * Lot « Profil » de LANDING_ANIMATIONS.md : sections teintées par le registre,
 * statistiques colorées, signalement en pastille, barre de navigation sans
 * orange — et chaque texte coloré lisible (4,5:1) sur son fond teinté.
 */

const SURFACE = hex("--cyber-bg-3");
const SECTIONS: readonly ProfileSection[] = PROFILE_SECTIONS;
const PROFILE_CSS = stripComments(readSource(join(ROOT, "app", "(secured)", "profil", "profil.module.css")));
const COLD_TONES = ["blue", "violet", "cyan", "teal", "pink"];

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
