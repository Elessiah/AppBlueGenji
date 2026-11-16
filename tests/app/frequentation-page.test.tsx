import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Page `/frequentation` (`docs/features/STATS_PAGE.md`, D76) : non référencée,
 * lisible FR et EN, état vide si rien n'est replié ou si la base est
 * injoignable.
 */
let mockLocale: "fr" | "en" = "fr";

jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/audience-service");

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { evolutionLabels, nextHeatCell } from "@/app/frequentation/AudienceDashboard";
import FrequentationPage, { generateMetadata } from "@/app/frequentation/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { getAudienceStats } from "@/lib/server/audience-service";
import { emptyHeatmap, type AudienceRangeStats, type AudienceStats } from "@/lib/shared/audience";
import { publicSitemapRoutes } from "@/lib/shared/sitemap";
import enAudience from "@/messages/en/audience.json";
import frAudience from "@/messages/fr/audience.json";

function rangeStats(): AudienceRangeStats {
  return {
    pages: [{ key: "home", views: 40, visitors: 12, engagedMs: 400_000 }],
    heatmap: emptyHeatmap(),
    devices: [{ key: "mobile", views: 30, visitors: 9 }],
    sources: [{ key: "discord", views: 10, visitors: 5 }],
    locales: [{ key: "fr", views: 40, visitors: 12 }],
  };
}

const STATS: AudienceStats = {
  lastDay: "2026-11-15",
  firstDay: "2026-11-14",
  daily: [
    { day: "2026-11-14", views: 18, visitors: 5, visits: 6, bounces: 2, engagedMs: 180_000 },
    { day: "2026-11-15", views: 22, visitors: 7, visits: 8, bounces: 3, engagedMs: 220_000 },
  ],
  ranges: { "7d": rangeStats(), "30d": rangeStats(), "12m": rangeStats(), all: rangeStats() },
  community: { tournaments: 4, matches: 37, teams: 12, players: 90 },
};

async function render(locale: "fr" | "en"): Promise<string> {
  mockLocale = locale;
  const tree = await FrequentationPage();
  return renderToStaticMarkup(<AppLocaleProvider locale={locale}>{tree}</AppLocaleProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("generateMetadata", () => {
  it("interdit l'indexation et le suivi des liens, en français", async () => {
    mockLocale = "fr";

    const metadata = await generateMetadata();

    expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } });
    expect(metadata.title).toBe("Statistiques de fréquentation");
  });

  it("interdit l'indexation en anglais aussi", async () => {
    mockLocale = "en";

    const metadata = await generateMetadata();

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});

describe("FrequentationPage", () => {
  it("affiche indicateurs, communauté et lien vers /rgpd en français", async () => {
    jest.mocked(getAudienceStats).mockResolvedValue(STATS);

    const html = await render("fr");

    expect(html).toContain('<main id="contenu"');
    expect(html).toContain("La communauté");
    expect(html).toContain('href="/rgpd#audience-detaillee"');
    expect(html).not.toContain("Les premières mesures arrivent");
  });

  it("page_headerAndFooter_outsideMain", async () => {
    jest.mocked(getAudienceStats).mockResolvedValue(STATS);

    const html = await render("fr");
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));

    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html.indexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
    expect(main).not.toContain("<header");
    expect(main).not.toContain("<footer");
  });

  it.each<["fr" | "en", string, string, string]>([
    ["fr", "Visiteurs quotidiens cumulés", "Visiteurs quotidiens cumulés par semaine, mois et année", 'href="/rgpd#audience-detaillee"'],
    ["en", "Daily visitors, summed", "Daily visitors summed per week, month and year", 'href="/en/rgpd#audience-detaillee"'],
  ])("page_%s_labelsCumulativeVisitorsAsDailySumsAndLinksInLocale", async (locale, kpi, buckets, privacyLink) => {
    jest.mocked(getAudienceStats).mockResolvedValue(STATS);

    const html = await render(locale);

    expect(html).toContain(kpi);
    expect(html).toContain(buckets);
    expect(html).toContain(privacyLink);
  });

  it("page_explanations_behindInfoHint", async () => {
    jest.mocked(getAudienceStats).mockResolvedValue(STATS);

    const html = await render("fr");

    expect(html).toContain("Plus d&#x27;infos : Visiteurs quotidiens cumulés");
    expect(html).toMatch(/<div[^>]*hidden[^>]*><p>Somme des visiteurs uniques de chaque jour/);
  });

  it("montre l'état vide tant qu'aucun jour n'est replié", async () => {
    jest.mocked(getAudienceStats).mockResolvedValue({ ...STATS, lastDay: null, firstDay: null, daily: [] });

    expect(await render("fr")).toContain("Les premières mesures arrivent");
  });

  it.each<["fr" | "en", string, string]>([
    ["fr", "Statistiques momentanément indisponibles", "Les premières mesures arrivent"],
    ["en", "Statistics temporarily unavailable", "The first figures are on their way"],
  ])("page_%s_databaseDown_showsUnavailableNotEmptyState", async (locale, unavailable, empty) => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getAudienceStats).mockRejectedValue(new Error("down"));

    const html = await render(locale);

    expect(html).toContain(unavailable);
    expect(html).not.toContain(empty);
  });

  it("page_heatmap_hasOneButtonPerCellAndASingleTabStop", async () => {
    jest.mocked(getAudienceStats).mockResolvedValue(STATS);

    const html = await render("fr");

    expect(html.match(/data-heat=""/g)).toHaveLength(168);
    expect(html.match(/tabindex="0"[^>]*data-heat|data-heat[^>]*tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Lundi, 0 h : 0 pages vues"');
  });

  it.each<["fr" | "en", string, string]>([
    ["fr", "Visiteurs quotidiens cumulés : total 12", "Détail dans le tableau de données."],
    ["en", "Daily visitors, summed: total 12", "Details in the data table."],
  ])("page_%s_bucketsChart_isNamedWithSummedVisitorsAndSummary", async (locale, summary, seeTable) => {
    jest.mocked(getAudienceStats).mockResolvedValue(STATS);

    const html = await render(locale);

    expect(html).toContain(summary);
    expect(html).toContain(seeTable);
  });
});

describe("diffusion", () => {
  it("n'est pas listée dans le plan du site", () => {
    expect(publicSitemapRoutes().map((route) => route.path)).not.toContain("/frequentation");
  });
});

describe("evolutionLabels — visiteurs regroupés", () => {
  it("evolutionLabels_ninetyTwoDays_dailyVisitorsLabel", () => {
    const labels = evolutionLabels(92, frAudience);

    expect(labels).toEqual({ bucket: "day", visitorsLabel: frAudience.evolution.visitors, hint: frAudience.evolution.hint });
  });

  it("evolutionLabels_weekGrouping_saysDailyVisitorsSummed", () => {
    const labels = evolutionLabels(93, enAudience);

    expect(labels.bucket).toBe("week");
    expect(labels.visitorsLabel).toBe("Daily visitors, summed");
    expect(labels.hint).toBe(enAudience.evolution.hintWeekly);
  });

  it("evolutionLabels_monthGrouping_saysVisiteursQuotidiensCumules", () => {
    const labels = evolutionLabels(732, frAudience);

    expect(labels.bucket).toBe("month");
    expect(labels.visitorsLabel).toBe("Visiteurs quotidiens cumulés");
    expect(labels.hint).toBe(frAudience.evolution.hintMonthly);
  });
});

describe("nextHeatCell", () => {
  it("nextHeatCell_arrowsInside_movesOneCell", () => {
    expect(nextHeatCell({ day: 2, hour: 5 }, "ArrowRight", 7)).toEqual({ day: 2, hour: 6 });
    expect(nextHeatCell({ day: 2, hour: 5 }, "ArrowLeft", 7)).toEqual({ day: 2, hour: 4 });
    expect(nextHeatCell({ day: 2, hour: 5 }, "ArrowDown", 7)).toEqual({ day: 3, hour: 5 });
    expect(nextHeatCell({ day: 2, hour: 5 }, "ArrowUp", 7)).toEqual({ day: 1, hour: 5 });
  });

  it("nextHeatCell_arrowsAtEdges_staysInGrid", () => {
    expect(nextHeatCell({ day: 0, hour: 0 }, "ArrowLeft", 7)).toEqual({ day: 0, hour: 0 });
    expect(nextHeatCell({ day: 0, hour: 0 }, "ArrowUp", 7)).toEqual({ day: 0, hour: 0 });
    expect(nextHeatCell({ day: 6, hour: 23 }, "ArrowRight", 7)).toEqual({ day: 6, hour: 23 });
    expect(nextHeatCell({ day: 6, hour: 23 }, "ArrowDown", 7)).toEqual({ day: 6, hour: 23 });
  });

  it("nextHeatCell_homeAndEnd_firstAndLastHour", () => {
    expect(nextHeatCell({ day: 3, hour: 9 }, "Home", 7)).toEqual({ day: 3, hour: 0 });
    expect(nextHeatCell({ day: 3, hour: 9 }, "End", 7)).toEqual({ day: 3, hour: 23 });
  });

  it("nextHeatCell_otherKey_returnsNull", () => {
    expect(nextHeatCell({ day: 3, hour: 9 }, "a", 7)).toBeNull();
  });
});

describe("palette", () => {
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  it.each<[string]>([["--st-series-1"], ["--st-series-2"], ["--st-series-3"], ["--st-series-4"], ["--st-series-5"], ["--st-series-6"]])(
    "palette_%s_atLeastThreeToOneOnWhite",
    (token) => {
      const css = readFileSync(join(process.cwd(), "app/frequentation/frequentation.module.css"), "utf8");
      const hex = new RegExp(`${token}: (#[0-9a-f]{6});`).exec(css)?.[1] ?? "#ffffff";

      expect(1.05 / (luminance(hex) + 0.05)).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("feuille de style", () => {
  it("css_kpiChange_hasItsOwnRuleNotAGridSelector", () => {
    const css = readFileSync(join(process.cwd(), "app/frequentation/frequentation.module.css"), "utf8");

    expect(css).toMatch(/\.kpiChange \{[^}]*font-size: 12px/);
    expect(css).not.toMatch(/\.kpiChange,\s*(\/\*[^*]*\*\/\s*)?\.grid/);
  });
});
