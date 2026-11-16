import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Page `/frequentation` (`docs/features/STATS_PAGE.md`, D76) : non référencée,
 * lisible FR et EN, état vide si rien n'est replié ou si la base est
 * injoignable.
 */
let mockLocale: "fr" | "en" = "fr";

jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/audience-service");

import { renderToStaticMarkup } from "react-dom/server";
import FrequentationPage, { generateMetadata } from "@/app/frequentation/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { getAudienceStats } from "@/lib/server/audience-service";
import { emptyHeatmap, type AudienceRangeStats, type AudienceStats } from "@/lib/shared/audience";
import { publicSitemapRoutes } from "@/lib/shared/sitemap";

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

  it("montre l'état vide quand la base est injoignable", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getAudienceStats).mockRejectedValue(new Error("down"));

    expect(await render("fr")).toContain("Les premières mesures arrivent");
  });
});

describe("diffusion", () => {
  it("n'est pas listée dans le plan du site", () => {
    expect(publicSitemapRoutes().map((route) => route.path)).not.toContain("/frequentation");
  });
});
