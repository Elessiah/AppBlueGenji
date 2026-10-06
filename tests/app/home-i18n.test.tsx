import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 2 : l'accueil rendu **en entier** dans les deux langues, services
 * simulés. L'anglais ne doit laisser passer aucun mot français (« garde » du
 * plan : une page anglaise n'ouvre qu'une fois tout son contenu traduit) ; le
 * français garde ses textes de toujours.
 */
let mockLocale: "fr" | "en" = "en";
let mockUser: { id: number; isAdmin: boolean; roles: string[] } | null = null;
let mockStored = new Map<string, string>();

jest.mock("next/navigation", () => ({
  usePathname: () => (mockLocale === "en" ? "/en" : "/"),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/components/cyber/landing/PublicPageShell", () => ({
  PublicPageShell: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => mockUser) }));
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));
jest.mock("@/lib/server/sponsors-service", () => ({
  listSponsors: jest.fn(async () => [
    {
      id: 1,
      name: "Acme Gear",
      slug: "acme-gear",
      tier: "GOLD",
      logoUrl: null,
      bannerUrl: null,
      websiteUrl: "https://acme.example",
      description: "Un partenaire fidèle de la scène",
    },
  ]),
}));
jest.mock("@/lib/server/about-stats-service", () => ({
  listAboutStats: jest.fn(async () => [{ id: 1, value: "100%", label: "Bénévole", displayOrder: 1 }]),
}));
jest.mock("@/lib/server/about-pillars-service", () => ({
  listAboutPillars: jest.fn(async () => [{ id: 1, title: "Accessible", text: "Inscription gratuite pour tous", displayOrder: 1 }]),
}));
jest.mock("@/lib/server/tournaments/bracket-loader", () => ({
  loadMiniBracket: jest.fn(async () => [{ a: "Alpha", b: "Beta", sa: 2, sb: 1 }]),
}));
jest.mock("@/lib/server/site-copy-service", () => {
  const { resolveSiteCopy } = jest.requireActual<typeof import("@/lib/shared/site-copy")>("@/lib/shared/site-copy");
  return { getSiteCopyBundle: jest.fn(async () => resolveSiteCopy(mockStored)) };
});
jest.mock("@/lib/server/tournaments-service", () => ({
  listTournamentBuckets: jest.fn(async () => {
    const { tournamentCard } = jest.requireActual<typeof import("../helpers/tournament-card")>("../helpers/tournament-card");
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    return {
      upcoming: [],
      registration: [
        tournamentCard({ id: 1, name: "Alpha Cup", state: "REGISTRATION", maxTeams: 16, registeredTeams: 4, startAt: future, registrationOpenAt: new Date(Date.now() - 86_400_000).toISOString(), registrationCloseAt: future }),
        tournamentCard({ id: 2, name: "Beta Open", state: "REGISTRATION", format: "BG_SURVIE", maxTeams: 8, registeredTeams: 8, startAt: future, registrationOpenAt: new Date(Date.now() - 86_400_000).toISOString(), registrationCloseAt: future }),
      ],
      running: [tournamentCard({ id: 3, name: "Gamma League", state: "RUNNING", format: "DOUBLE", startAt: new Date(Date.now() - 3_600_000).toISOString() })],
      finished: [],
    };
  }),
}));
jest.mock("@/lib/server/landing-service", () => ({
  getLandingStats: jest.fn(async () => ({ players: 1234, teams: 56, tournaments: 7, discord: { memberCount: 1160, onlineCount: 367 } })),
  getLandingLive: jest.fn(async () => ({
    tournament: { id: 3, name: "Gamma League", format: "DOUBLE", participantType: "TEAM" },
    game: "Overwatch",
    viewers: 12,
    phase: "PHASE FINALE",
    stream: { url: "https://twitch.tv/bluegenji", tournamentName: "Gamma League" },
    currentMatch: {
      id: 9,
      team1Name: "Alpha",
      team2Name: null,
      team1Href: "/equipes/1",
      team2Href: null,
      team1LogoUrl: null,
      team2LogoUrl: null,
      team1Score: 1,
      team2Score: 0,
      team1Seed: 1,
      team2Seed: null,
      bracket: "UPPER",
      roundLabel: "Demi-finale",
      round: { kind: "semi", number: 2 },
      matchFormat: { type: "BO", value: 5 },
      liveState: "LIVE",
      liveUrl: "https://twitch.tv/bluegenji",
      launchPhase: "LAUNCHED",
      startAt: null,
    },
  })),
  getLandingLeaderboard: jest.fn(async () => [
    { rank: 1, teamId: 1, teamName: "Alpha", logoUrl: null, wins: 5, losses: 1, draws: 0, points: 600, trend: "up", trendValue: 4 },
  ]),
  getLandingCalendar: jest.fn(async () => [
    { tournamentId: 1, name: "Alpha Cup", game: "OW", state: "REGISTRATION", startAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), maxTeams: 16, registeredTeams: 4 },
  ]),
  getLandingTicker: jest.fn(async (locale: string) => ({
    items: locale === "en" ? ["RESULT · Alpha Cup · Alpha 2 — Beta 1"] : ["RÉSULTAT · Alpha Cup · Alpha 2 — Beta 1"],
  })),
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "@/app/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ToastProvider } from "@/components/ui/toast";

async function renderHome(locale: "fr" | "en"): Promise<string> {
  mockLocale = locale;
  const page = (await HomePage()) as ReactElement;
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <ToastProvider>{page}</ToastProvider>
    </AppLocaleProvider>,
  );
}

/** Texte lu : contenu visible **et** attributs que lit un lecteur d'écran ou une infobulle. */
function readableText(markup: string): string {
  const withoutScripts = markup.replace(/<script[\s\S]*?<\/script>/g, " ");
  const attributes = [...withoutScripts.matchAll(/(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  const text = withoutScripts.replace(/<[^>]+>/g, " ");
  return `${text} ${attributes.join(" ")}`
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

/** Le texte d'un élément `lang="fr"` (contrôles du staff, D4) n'est pas un oubli de traduction. */
function stripFrenchMarked(markup: string): string {
  return markup.replace(/<(\w+)[^>]*\slang="fr"[^>]*>[\s\S]*?<\/\1>/g, " ");
}

const FRENCH_LETTERS = /[àâçéèêëîïôûùœ«»]/i;
const FRENCH_WORDS =
  /\b(le|la|les|des|du|une|et|pour|sur|dans|aucun|aucune|tournois?|équipes?|voir|rejoindre|inscri\w*|prochain|classement|partenaires?|regarder|direct|manche|finale)\b/i;

beforeEach(() => {
  mockUser = null;
  mockStored = new Map();
});

describe("accueil — anglais", () => {
  it("ne laisse passer aucun mot français", async () => {
    const text = readableText(await renderHome("en"));
    const offending = text
      .split(/\s{2,}|\n/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk && (FRENCH_LETTERS.test(chunk) || FRENCH_WORDS.test(chunk)));
    expect(offending).toEqual([]);
  });

  it("rend les sections dans les mots du glossaire", async () => {
    const markup = await renderHome("en");
    expect(markup).toContain("Current and upcoming tournaments");
    expect(markup).toContain("Registration open");
    expect(markup).toContain("Organize,");
    expect(markup).toContain("Watch live");
    expect(markup).toContain("Semifinal");
    expect(markup).toContain("Single elimination");
    expect(markup).toContain("Partners and supporters");
    // Le JSON-LD du site annonce sa langue.
    expect(markup).toContain('"inLanguage":"en-US"');
  });

  it("ne rend pas le contenu de staff encore français (chiffres, cartes, description d'un partenaire)", async () => {
    const markup = await renderHome("en");
    expect(markup).not.toContain("Bénévole");
    expect(markup).not.toContain("Inscription gratuite");
    expect(markup).not.toContain("partenaire fidèle");
    // Le nom d'un partenaire, lui, est un nom propre.
    expect(markup).toContain("Acme Gear");
  });

  it("un texte français édité sans anglais ne passe jamais sous /en (rattrapage)", async () => {
    mockStored = new Map([["copy_home.hero.lede", "Une accroche réécrite par le staff."]]);
    const markup = await renderHome("en");
    expect(markup).not.toContain("réécrite");
    expect(markup).toContain("BlueGenji brings together");
  });

  it("sert l'anglais saisi dans l'éditeur", async () => {
    mockStored = new Map([
      ["copy_home.hero.lede", "Une accroche réécrite."],
      ["copy_home.hero.lede__en", "A rewritten tagline."],
    ]);
    expect(await renderHome("en")).toContain("A rewritten tagline.");
  });

  it("contrôles du staff : restés français, ils le déclarent (lang=\"fr\")", async () => {
    mockUser = { id: 1, isAdmin: true, roles: [] };
    const markup = await renderHome("en");
    expect(markup).toMatch(/<button[^>]*lang="fr"[^>]*aria-label="Modifier : Hero — titre"/);
    const text = readableText(stripFrenchMarked(markup));
    expect(text).not.toMatch(/Modifier|Supprimer|Ajouter/);
  });
});

describe("accueil — français inchangé", () => {
  it("garde ses textes, ses nombres et ses dates à la française", async () => {
    const markup = await renderHome("fr");
    for (const expected of [
      "Tournois en cours et à venir",
      "3 TOURNOIS OUVERTS",
      "Inscriptions ouvertes",
      "Complet",
      "Classement et calendrier",
      "1 ÉQUIPE CLASSÉE",
      "PROCHAINS ÉVÉNEMENTS",
      "Organiser,",
      "Regarder le live",
      "Demi-finale",
      "PHASE FINALE",
      "Joueurs inscrits",
      "Membres Discord",
      "367 en ligne",
      "Partenaires et soutiens",
      "1 PARTENAIRE",
      "LOI 1901 · JANVILLIERS",
      "Bénévole",
      "Un partenaire fidèle de la scène",
      "Simple élimination",
      "Rejoindre le Discord",
      "Créer un compte",
      '"inLanguage":"fr-FR"',
    ]) {
      expect(markup).toContain(expected);
    }
    expect(markup).not.toContain('lang="fr"');
  });
});
