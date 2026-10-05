import { describe, expect, it } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { UrgentPill } from "@/components/recruitment/UrgentPill";
import { pillVariantClass } from "@/components/cyber/Pill";
import { blend, tokenHex as hex, tokenTriplet as triplet } from "./_lib/tone-contrast";
import { blockFor, globals, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/** Lot « Nettoyage » de LANDING_ANIMATIONS.md (dernier lot du plan). */

const sheet = stripComments(globals);
const AMBER = /--amber\b|--amber-rgb|245,\s*165,\s*36|\bAMBER\b/;
const WARM = /255,\s*170,\s*60|245,\s*185,\s*80|#ffb45c|#f5b950|#ffb347|#f5a524/i;
const SURFACE = "--cyber-bg-3"; // le fond le plus clair : pire cas

describe("pastille « Urgente »", () => {
  it("prend l'ambre d'avertissement, plus le rouge du direct", () => {
    const markup = renderToStaticMarkup(createElement(UrgentPill));
    expect(markup).toContain("pill-warning");
    expect(markup).toContain("pill-urgent");
    expect(markup).not.toContain("pill-live");
    expect(markup).toContain("Urgente");
  });

  it("la variante warning existe et lit le jeton ambre", () => {
    expect(pillVariantClass("warning")).toBe("pill-warning");
    const rule = blockFor(/\.pill-warning\s*\{/, sheet);
    expect(rule).toContain("var(--amber)");
    expect(rule).not.toMatch(/red-live|255,\s*77,\s*94/);
  });

  it("garde une classe supplémentaire sans perdre le clignotement", () => {
    const markup = renderToStaticMarkup(createElement(UrgentPill, { className: "extra" }));
    expect(markup).toMatch(/class="pill pill-warning pill-urgent extra"/);
  });
});

describe("pages publiques — l'ambre trié", () => {
  it.each([
    ["app/bot/docs/docs.css"],
    ["app/rgpd/page.module.css"],
    ["app/regles/[slug]/page.module.css"],
    ["components/cyber/landing/PublicFooter.module.css"],
    ["components/legal/SiteFooterBar.module.css"],
  ])("%s ne prend plus ni ambre ni orange", (file) => {
    const css = readSource(file);
    expect(css).not.toMatch(AMBER);
    expect(css).not.toMatch(WARM);
  });

  it("les avertissements gardés passent par le jeton, sans repli codé en dur", () => {
    expect(readSource("app/recrutement/page.module.css")).not.toMatch(WARM);
  });

  it("le graphe de /bot nomme ses scrims sans ambre", () => {
    const chart = readSource("components/bot/BotActivityChart.tsx");
    expect(chart).toContain('className="bar scrims"');
    expect(chart).toContain('className="lg scrims"');
    expect(chart).not.toMatch(/\bamber\b|bar relais/);
    const css = stripComments(readSource("app/bot/bot.css"));
    expect(blockFor(/\.bar\.scrims\s*\{/, css)).not.toMatch(AMBER);
    expect(css).toMatch(/\.feed-row \.tag\.scrim \{ color: var\(--pink-400\)/);
    // Le retard d'un relais reste un avertissement.
    expect(css).toMatch(/\.srv-status\.lag \{ color: var\(--amber\)/);
  });

  it("la base légale des données de tournoi est une pastille complète", () => {
    const page = readSource("app/rgpd/page.tsx");
    expect(page).not.toContain("badgeAmber");
    expect(page.match(/\$\{styles\.badge\} \$\{styles\.badgeAccent\}/g)).toHaveLength(3);
  });

  it("chaque texte recoloré reste lisible (AA)", () => {
    const pairs: Array<[ink: string, tint: string, alpha: number]> = [
      ["--amber", "--amber-rgb", 0.08], // .pill-warning
      ["--blue-300", "--blue-500-rgb", 0.12], // « Signaler un problème » au survol
      ["--violet-300", "--violet-400-rgb", 0.08], // bandeau « Bientôt disponible », bases légales
      ["--pink-400", "--pink-400-rgb", 0.05], // étiquette « scrim » du fil de /bot
      ["--violet-300", "--blue-500-rgb", 0.1], // titre de la page ouverte de /bot/docs
    ];
    for (const [ink, tint, alpha] of pairs) {
      expect(contrastRatio(hex(ink), blend(hex(SURFACE), triplet(tint), alpha))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("globals.css — jetons et classes sans lecteur retirés", () => {
  it("l'orange hérité et le violet à part ont disparu", () => {
    expect(sheet).not.toMatch(/--accent-orange|--orange-rgb|--purple-rgb|255,\s*157,\s*46|#ff9d2e/i);
  });

  it("aucune variante orange, rouge ou verte orpheline des en-têtes", () => {
    expect(sheet).not.toMatch(/\.ds-(header|section-title|title|stat)\.(orange|red)\b/);
    expect(sheet).not.toMatch(/\.ds-(header|title)\.green\b/);
    // La variante verte des titres de section sert encore (fiche de tournoi).
    expect(sheet).toMatch(/\.ds-section-title\.green\s*\{/);
  });

  it("les classes purple des équipes prennent le violet de la palette", () => {
    for (const selector of [/\.ds-header\.purple\s*\{/, /\.ds-section-title\.purple\s*\{/, /\.ds-title\.purple\s*\{/, /\.ds-stat\.purple\s*\{/]) {
      expect(blockFor(selector, sheet)).toContain("var(--violet-400-rgb)");
    }
  });

  it("le second ton par défaut des titres n'est plus orange", () => {
    expect(blockFor(/\.ds-section-title\s*\{/, sheet)).toContain("--title-rgb-b: var(--violet-400-rgb)");
    expect(blockFor(/\.ds-title\s*\{/, sheet)).toContain("--title-rgb-b: var(--violet-400-rgb)");
  });
});
