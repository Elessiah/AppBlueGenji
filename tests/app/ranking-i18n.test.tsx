import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";

/**
 * Lot 4 : `/classement` en français et en anglais (`docs/features/I18N.md`
 * § Classement). La langue vient de `x-bg-locale` (`requestLocale()`), simulée
 * ici ; le gabarit (`SessionPageShell`) a ses propres tests.
 */
let mockLocale: "fr" | "en" = "en";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/classement",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/site-copy-service", () => ({ getSiteCopy: jest.fn(), getSiteCopyEditor: jest.fn() }));
jest.mock("@/lib/server/landing-service", () => ({ loadLeaderboardRows: jest.fn() }));
jest.mock("@/lib/server/teams/directory", () => ({ loadCachedTeamForms: jest.fn() }));
jest.mock("@/components/cyber/landing/SessionPageShell", () => ({
  SessionPageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

import { renderToStaticMarkup } from "react-dom/server";
import ClassementPage, { generateMetadata } from "@/app/classement/page";
import { RankingBoard, podiumGapText } from "@/app/classement/RankingBoard";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { loadLeaderboardRows } from "@/lib/server/landing-service";
import { getSiteCopy } from "@/lib/server/site-copy-service";
import { loadCachedTeamForms } from "@/lib/server/teams/directory";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";
import { isMigratedRoute, localeHref, type Locale } from "@/lib/shared/locales";
import { rankingText } from "@/lib/shared/ranking-text";
import { defaultSiteCopy } from "@/lib/shared/site-copy";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";

function row(rank: number, overrides: Partial<LandingLeaderboardRow> = {}): LandingLeaderboardRow {
  return {
    rank,
    teamId: rank * 10,
    teamName: `Team ${rank}`,
    logoUrl: null,
    wins: 4,
    losses: rank % 2,
    draws: rank === 5 ? 1 : 0,
    points: 700 - rank * 20,
    trend: rank === 2 ? "up" : rank === 4 ? "down" : "flat",
    trendValue: rank,
    ...overrides,
  };
}

const ROWS = [1, 2, 3, 4, 5].map((rank) => row(rank));
const FORMS = new Map<number, ("w" | "l" | "d")[]>([[10, ["w", "l", "d"]], [40, ["w"]]]);

async function renderPage(locale: Locale): Promise<string> {
  mockLocale = locale;
  const tree = await ClassementPage({ searchParams: Promise.resolve({ n: "4" }) });
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <ToastProvider>{tree}</ToastProvider>
    </AppLocaleProvider>,
  );
}

function renderBoard(locale: Locale, props: Partial<Parameters<typeof RankingBoard>[0]> = {}): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <RankingBoard rows={ROWS} filter="all" forms={FORMS} hasMore locale={locale} {...props} />
    </AppLocaleProvider>,
  );
}

/** Le texte lu par le visiteur (et les attributs lus par un lecteur d'écran), sans balisage. */
function visibleText(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title|alt|data-label)="([^"]*)"/g)].map((m) => m[1]);
  return [html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "), ...attributes]
    .join(" ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

type Tree = { [key: string]: string | Tree };
function leaves(tree: unknown): string[] {
  return typeof tree === "string" ? [tree] : Object.values(tree as Tree).flatMap(leaves);
}

/** Phrases françaises du classement que l'anglais a réécrites (sans arguments ni balises). */
const FRENCH_ONLY = (() => {
  const en = new Set(leaves(messagesFor("en").ranking));
  return leaves(messagesFor("fr").ranking)
    .filter((text) => !en.has(text))
    .map((text) => text.replace(/<\/?b>/g, ""))
    .filter((text) => !/[{}]/.test(text) && text.length >= 6);
})();

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = "en";
  jest.mocked(getSiteCopy).mockImplementation(async (locale) => defaultSiteCopy(locale));
  jest.mocked(loadLeaderboardRows).mockResolvedValue(ROWS);
  jest.mocked(loadCachedTeamForms).mockResolvedValue(FORMS);
});

describe("liste blanche — le classement est traduit", () => {
  it("ouvre /en/classement", () => {
    expect(MIGRATED_ROUTES).toContain("/classement");
    expect(isMigratedRoute("/classement")).toBe(true);
    expect(localeHref("/classement?jeu=ow", "en")).toBe("/en/classement?jeu=ow");
  });

  it("donne au classement son entrée anglaise au sitemap, avec ses hreflang", () => {
    const entries = localizedSitemapEntries(publicSitemapRoutes());
    const languages = { fr: "/classement", en: "/en/classement", "x-default": "/classement" };
    expect(entries).toContainEqual(expect.objectContaining({ path: "/classement", languages }));
    expect(entries).toContainEqual(expect.objectContaining({ path: "/en/classement", languages }));
  });
});

describe("métadonnées par langue", () => {
  it("anglais : titre, description, canonique et hreflang", async () => {
    mockLocale = "en";
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Team ranking");
    expect(String(metadata.description)).toContain("Marvel Rivals");
    expect(String(metadata.description)).not.toMatch(/[éèêàçùôœ]/);
    expect(metadata.alternates).toEqual({
      canonical: "/en/classement",
      languages: { fr: "/classement", en: "/en/classement", "x-default": "/classement" },
    });
    expect(metadata.openGraph).toMatchObject({ locale: "en_US", url: "/en/classement" });
  });

  it("français : titre et canonique inchangés, mêmes hreflang", async () => {
    mockLocale = "fr";
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Classement des équipes");
    expect(String(metadata.description)).toBe(
      "Le classement des équipes BlueGenji Esport : cote de chaque équipe, podium, bilan et forme récente, en général ou par jeu (Overwatch, Marvel Rivals).",
    );
    expect(metadata.alternates?.canonical).toBe("/classement");
    expect(metadata.alternates?.languages).toEqual({ fr: "/classement", en: "/en/classement", "x-default": "/classement" });
    expect(metadata.openGraph).toMatchObject({ locale: "fr_FR" });
  });
});

describe("rendu anglais — aucune phrase française sous /en/classement", () => {
  it("la page entière", async () => {
    const html = await renderPage("en");
    const text = visibleText(html);
    expect(FRENCH_ONLY.length).toBeGreaterThan(25);
    for (const french of FRENCH_ONLY) expect(text).not.toContain(french);
    expect(text).not.toMatch(/[éèêàçùôœ]/);
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(text).toContain("COMPETITION · RANKING");
    expect(text).toContain("How the rating works");
    // Titre éditable : l'anglais d'origine du lot 2.
    expect(html).toContain("Climb all the way<br/>");
    // Nombres de la langue : « 1.5 », jamais « 1,5 ».
    expect(text).toContain("up to 1.5 times");
    expect(html).toContain("<strong>Every match</strong>");
  });

  it("liens dans la langue de la page ; une route pas encore traduite reste française", async () => {
    jest.mocked(loadLeaderboardRows).mockResolvedValue(Array.from({ length: 60 }, (_, index) => row(index + 1)));
    const html = await renderPage("en");
    expect(html).toContain('href="/en/classement?jeu=ow"');
    expect(html).toContain('href="/en/classement"');
    expect(html).toContain('href="/en/regles"');
    // Les tournois sont traduits depuis le lot 8a-1.
    expect(html).toContain('href="/en/tournois"');
    // « Afficher plus » : page suivante, sous `/en`.
    expect(html).toContain('href="/en/classement?n=100#rang-51"');
  });

  it("fil d'Ariane JSON-LD : noms traduits, adresses anglaises", async () => {
    const html = await renderPage("en");
    const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const data = JSON.parse(script) as { itemListElement: { name: string; item: string }[] };
    expect(data.itemListElement.map((item) => item.name)).toEqual(["Home", "Ranking"]);
    expect(data.itemListElement[1].item).toMatch(/\/en\/classement$/);
  });

  it("tableau et podium : lettres W / L / D, colonnes, tendances, écarts", () => {
    const html = renderBoard("en");
    const text = visibleText(html);
    expect(text).toContain("Recent form, most recent first: W, L, D");
    expect(html).toContain('<span role="columnheader">Rating</span>');
    expect(html).toContain('data-label="L"');
    expect(html).toContain('data-label="D"');
    expect(text).toContain("Up 2 over 7 days");
    expect(text).toContain("Down 4 over 7 days");
    // Tendance « 7-day », jamais « 7d » : mis en capitales, « 7D » se lirait « 7 nuls » à côté de la colonne D.
    expect(html).toContain('data-label="7-day"');
    expect(html).not.toMatch(/>7d<|"7d"/);
    expect(text).toContain("Top of the ranking");
    expect(text).toContain("20 pts behind the leader");
    expect(text).toContain("1st place");
    expect(text).toContain("View Team 1's profile");
    expect(text).toContain("Team ranking table, from 4th place");
    expect(text).toContain("Show more");
    expect(html).toContain('aria-label="Filter by game"');
    expect(text).toContain("Overall");
    expect(text).not.toMatch(/[éèêàçùôœ]/);
  });

  it("garde les marches du podium (1re irisée, 2e, 3e) dans les deux langues", () => {
    for (const locale of ["fr", "en"] as const) {
      const html = renderBoard(locale);
      for (const tier of [1, 2, 3]) expect(html).toContain(`podium-tier-${tier}`);
    }
  });

  it("états vides et indisponibles en anglais", () => {
    expect(renderBoard("en", { rows: [] })).toContain("No ranked teams yet");
    expect(renderBoard("en", { rows: [], unavailable: true })).toContain("temporarily unavailable");
  });

  it("plafond : la note est traduite", () => {
    const capped = Array.from({ length: 1000 }, (_, index) => row(index + 1));
    const html = renderBoard("en", { rows: capped, forms: null, hasMore: true });
    expect(html).toContain("Showing the top 1000 teams only.");
    expect(html).not.toContain("Show more");
  });
});

describe("rendu français — inchangé", () => {
  it("garde les textes, les liens sans préfixe et les lettres V / D / N", async () => {
    const html = await renderPage("fr");
    const text = visibleText(html);
    expect(text).toContain("COMPÉTITION · CLASSEMENT");
    expect(text).toContain("jusqu'à 1,5 fois");
    expect(text).toContain("Forme récente, du plus récent au plus ancien : V, D, N");
    expect(html).toContain('href="/classement?jeu=ow"');
    expect(html).toContain('href="/regles"');
    expect(html).toContain("Grimpe jusqu&#x27;au<br/>");
    expect(text).not.toContain("Team ranking");
  });

  it("podiumGapText garde ses phrases françaises par défaut", () => {
    expect(podiumGapText([{ points: 600 }, { points: 560 }, { points: 540 }], 2)).toBe(
      "À 60 pts de la tête · 20 du rang au-dessus",
    );
    const en = rankingText("en", messagesFor("en").ranking);
    expect(podiumGapText([{ points: 600 }, { points: 580 }, { points: 580 }], 2, en)).toBe(
      "20 pts behind the leader · tied with the rank above",
    );
    expect(podiumGapText([{ points: 500 }, { points: 500 }], 1, en)).toBe("Tied with the leader");
  });
});

describe("clé manquante", () => {
  it("s'affiche telle quelle plutôt que de faire tomber la page", () => {
    const text = rankingText("en", messagesFor("en").ranking);
    expect(text.t("board.nope" as Parameters<typeof text.t>[0])).toBe("board.nope");
  });
});
