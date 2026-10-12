/**
 * Préchargement de l'anglais au survol d'un lien `/en/…` de l'espace connecté
 * (revue de performance du lot 9-2) : chaque page visée lance ses espaces, et
 * rien d'autre.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readSource } from "../helpers/read-source";
import { englishReports } from "@/components/i18n/english-loaders";
import { englishPlayers, englishProfile, englishPush, englishStatsPanel, englishTeam, englishTeamErrors, englishTeams } from "@/components/i18n/english-loaders-account";
import { preloadEnglishFor } from "@/components/i18n/english-link-targets";
import { barePath, englishPageOf, ENGLISH_PAGES } from "@/components/i18n/english-route-preload";
import { preloadRoute, setRoutePreload } from "@/components/i18n/route-preload";

type Name = "englishReports" | "englishPlayers" | "englishProfile" | "englishPush" | "englishStatsPanel" | "englishTeam" | "englishTeamErrors" | "englishTeams";
const LOADERS: Record<Name, { load: () => Promise<unknown> }> = {
  englishReports,
  englishPlayers,
  englishProfile,
  englishPush,
  englishStatsPanel,
  englishTeam,
  englishTeamErrors,
  englishTeams,
};

/** Les chargeurs lancés par un survol, sans rien télécharger. */
function preloaded(path: string): Name[] {
  const spies = Object.entries(LOADERS).map(([name, loader]) => [name, jest.spyOn(loader, "load").mockImplementation(() => new Promise<unknown>(() => undefined))] as const);
  preloadEnglishFor(path);
  const called = spies.filter(([, spy]) => spy.mock.calls.length > 0).map(([name]) => name as Name);
  for (const [, spy] of spies) spy.mockRestore();
  return called.sort();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("preloadEnglishFor", () => {
  it("chaque page visée lance ses espaces", () => {
    expect(preloaded("/equipes/12")).toEqual(["englishStatsPanel", "englishTeam", "englishTeamErrors"]);
    expect(preloaded("/joueurs/7?tab=stats")).toEqual(["englishPlayers", "englishStatsPanel"]);
    expect(preloaded("/joueurs")).toEqual(["englishPlayers"]);
    expect(preloaded("/equipes")).toEqual(["englishTeamErrors", "englishTeams"]);
    expect(preloaded("/equipes/creer")).toEqual(["englishTeamErrors", "englishTeams"]);
    expect(preloaded("/signalements/3#detail")).toEqual(["englishReports"]);
    expect(preloaded("/profil#notifications")).toEqual(["englishProfile", "englishPush", "englishTeamErrors"]);
  });

  it("barre finale, requête et ancre ôtées", () => {
    expect(barePath("/equipes/12/")).toBe("/equipes/12");
    expect(barePath("/joueurs/?q=a#x")).toBe("/joueurs");
    expect(barePath("/")).toBe("/");
    expect(preloaded("/equipes/12/")).toEqual(["englishStatsPanel", "englishTeam", "englishTeamErrors"]);
  });

  it("une page sans dictionnaire de ce lot ne lance rien", () => {
    expect(preloaded("/tournois/4")).toEqual([]);
    expect(preloaded("/classement")).toEqual([]);
  });
});

describe("écouteur délégué", () => {
  it("posé par la mise en page de l'espace connecté sous /en seulement, table chargée au premier survol", () => {
    expect(readSource("app/(secured)/layout.tsx")).toContain("{english && <EnglishLinkPreload />}");
    const listener = readSource("components/i18n/english-link-preload.tsx");
    const route = readSource("components/i18n/english-route-preload.ts");
    expect(route).toContain('const targets = onceLoader(() => import("./english-link-targets"));');
    // Une page sans anglais à précharger ne télécharge pas la table ; un échec se tait (`quietPreload`) ;
    // toutes les pages demandées pendant son arrivée sont servies.
    expect(route).toContain("if (!page) return;");
    expect(route).toContain("const warmTargets = quietPreload(");
    expect(route).toContain("for (const page of wanted) module.preloadEnglishPage(page);");
    expect(listener).toContain('if (href.startsWith("/en/")) preloadEnglishRoute(href.slice(3));');
    expect(listener).toContain("setRoutePreload(preloadEnglishRoute);");
    // Les navigations par le code passent par le registre, sans `import()` dans le module de chaque page.
    const navigation = readSource("components/i18n/locale-navigation.tsx");
    expect(navigation.match(/if \(locale === "en"\) preloadRoute\(href\);/g)).toHaveLength(2);
    expect(readSource("components/i18n/route-preload.ts")).not.toMatch(/import\("/);
    expect(listener).toContain('document.addEventListener("pointerover", onIntent, { passive: true });');
    expect(listener).toContain('document.addEventListener("focusin", onIntent);');
  });

  it("le menu du compte (aussi dans l'en-tête public) n'emporte aucun chargeur", () => {
    const menu = readSource("components/account-menu.tsx");
    expect(menu).not.toContain("profile-english");
    expect(menu).not.toContain("english-loaders");
  });

  it("une porte extérieure lance aussi l'anglais de la fiche visée", () => {
    const gates = readSource("components/i18n/english-gates.tsx");
    expect(gates).toContain("useNestedEnglish(locale, TEAM_ROUTES, messages !== undefined);");
    expect(gates).toContain("useNestedEnglish(locale, PLAYER_ROUTES, messages !== undefined);");
    // Chargement complet : rien de lancé pour la page d'arrivée, qui amorce le sien.
    expect(gates).toContain("if (locale !== \"en\" || path === arrival.current) return;");
    // Une seule table des pages (`ENGLISH_PAGES`), lue aussi par les portes.
    expect(gates).toContain("const TEAM_ROUTES = { teamPage: [englishTeam, englishStatsPanel], teams: [englishTeams] };");
    expect(gates).toContain("const page = englishPageOf(path);");
    // Le chemin suivi : une navigation par le code sous une porte montée relance.
    expect(gates).toContain("}, [locale, path, routes]);");
  });

  it("annuaire des équipes et création : anglais de `teams` au chargement complet seulement", () => {
    for (const page of ["app/(secured)/equipes/page.tsx", "app/(secured)/equipes/creer/page.tsx"]) {
      expect(readSource(page)).toContain('const messages = locale === "en" && (await isDocumentLoad()) ? all.teams : undefined;');
    }
    expect(readSource("components/i18n/teams-text.tsx")).toContain("primeEnglish(englishTeams, props.locale, props.messages);");
  });

  it("annuaire des joueurs : compteurs mémorisés", () => {
    const list = readSource("app/(secured)/joueurs/PlayersList.tsx");
    expect(list).toContain("const deletedCount = useMemo(() => players.filter((p) => p.isDeleted).length, [players]);");
    expect(list).toMatch(/const \{ freeAgents, owCount, mrCount \} = useMemo\(/);
  });
});

describe("registre des navigations par le code", () => {
  it("sans préchargement inscrit, rien ; inscrit, il reçoit le chemin ; désinscrit, plus rien", () => {
    const seen: string[] = [];
    preloadRoute("/equipes/1");
    setRoutePreload((path) => seen.push(path));
    preloadRoute("/equipes/2");
    setRoutePreload(null);
    preloadRoute("/equipes/3");
    expect(seen).toEqual(["/equipes/2"]);
  });
});

describe("une seule table des pages", () => {
  it("chaque page de la table a son préchargement ; le reste n'en a pas", () => {
    expect(Object.keys(ENGLISH_PAGES).sort()).toEqual(["playerPage", "players", "profile", "report", "teamPage", "teams"]);
    expect(englishPageOf("/equipes/12/")).toBe("teamPage");
    expect(englishPageOf("/equipes/creer?x=1")).toBe("teams");
    expect(englishPageOf("/joueurs#top")).toBe("players");
    expect(englishPageOf("/tournois/4")).toBeNull();
    const sample: Record<keyof typeof ENGLISH_PAGES, string> = {
      profile: "/profil",
      teamPage: "/equipes/1",
      teams: "/equipes",
      playerPage: "/joueurs/1",
      players: "/joueurs",
      report: "/signalements/1",
    };
    for (const path of Object.values(sample)) expect(preloaded(path).length).toBeGreaterThan(0);
  });
});
