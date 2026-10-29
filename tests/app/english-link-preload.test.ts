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
import { barePath, englishPageOf, ENGLISH_PAGES } from "@/components/i18n/english-pages";
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
  it("posé par la mise en page racine (compte connecté, /en), écouteur chargé après l'hydratation", () => {
    expect(readSource("app/layout.tsx")).toContain('{user && locale === "en" && <EnglishLinkPreload />}');
    expect(readSource("components/i18n/english-link-preload.tsx")).toContain('import("./english-link-preload-install")');
    const listener = readSource("components/i18n/english-link-preload-install.ts");
    const route = readSource("components/i18n/english-route-preload.ts");
    expect(route).toContain('const targets = onceLoader(() => import("./english-link-targets"));');
    // Une page sans anglais à précharger ne télécharge pas la table ; un préchargement par page,
    // requête de la table partagée en vol, silence après échec : rien de retenu d'un essai à l'autre.
    expect(route).toContain("if (!page) return;");
    expect(route).toContain(".then((module) => module.preloadEnglishPage(page))");
    // Une seule attente par page tant que la table arrive.
    expect(route).toContain("if (pending.has(page)) return;");
    expect(route).not.toMatch(/wanted|warming/);
    expect(readSource("components/i18n/use-english-messages.ts")).toMatch(
      /export function useEnglishMessagesUntilRemount<T>\([^)]*\): EnglishMessagesState<T> \{\s*return useEnglishMessagesAt\(locale, loader, undefined, ""\);/,
    );
    expect(listener).toContain("preloadEnglishRoute(href.slice(3));");
    // Un même lien une fois par seconde au plus (enfants traversés), nouvel essai possible ensuite.
    expect(listener).toContain("if (href === last && now - lastAt < 1000) return;");
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
    // Seulement tant que la porte extérieure attend ; un échec se tait (`quietPreload`).
    // Seulement tant que la porte extérieure attend ; chargeurs de la fiche, hors celui de la porte.
    // La table des pages, module pur : les portes n'emportent pas la mécanique du préchargement.
    expect(gates).toContain('import { englishPageOf } from "./english-pages";');
    expect(readSource("components/i18n/english-pages.ts")).not.toMatch(/import\("/);
    expect(gates).toContain("if (loader !== own) loader.load().catch(() => undefined);");
    // Les préchargements par page vivent dans le morceau à la demande.
    expect(readSource("components/i18n/english-link-targets.ts")).toContain("...PAGE_PRELOADS,");
    expect(readSource("components/i18n/english-page-loaders.ts")).not.toContain("quietPreload");
    expect(gates).toContain('if (locale !== "en" || !waiting) return;');
    // Une seule table des pages (`ENGLISH_PAGES`), lue aussi par les portes.
    expect(gates).toContain('const TEAM_ROUTES = ["teamPage", "teams"] as const;');
    // Une seule correspondance page → espaces, lue par le survol et par les portes.
    expect(readSource("components/i18n/english-link-targets.ts")).toContain('import { PAGE_LOADERS } from "./english-page-loaders";');
    expect(gates).toContain("const page = englishPageOf(splitLocalePrefix(path).path);");
    // Le chemin suivi : une navigation par le code sous une porte montée relance.
    expect(gates).toContain("}, [locale, waiting, path, pages, own]);");
    // Survol continu du même élément : rien à remonter.
    expect(readSource("components/i18n/english-link-preload-install.ts")).not.toContain("lastTarget");
  });

  it("annuaire des équipes et création : anglais de `teams` au chargement complet seulement", () => {
    for (const page of ["app/(secured)/equipes/page.tsx", "app/(secured)/equipes/creer/page.tsx"]) {
      expect(readSource(page)).toContain("const messages = await englishOnDocumentLoad(locale, (all) => all.teams);");
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

describe("revue performance, quinzième passe", () => {
  it("push et replace préchargent l'anglais ; prefetch, sans appelant, non", () => {
    expect(readSource("components/i18n/locale-navigation.tsx").match(/if \(locale === "en"\) preloadRoute\(href\);/g)).toHaveLength(2);
  });

  it("annuaire des équipes : compteurs mémorisés", () => {
    expect(readSource("app/(secured)/equipes/TeamsList.tsx")).toMatch(/const \{ totalMembers, countOw, countMr \} = useMemo\(/);
  });

  it("bloc de statistiques : un seul morceau ; date de quarantaine par le cache commun", () => {
    expect(readSource("components/i18n/english-loaders-account.ts")).toContain('import("./stats-panel-en")');
    expect(readSource("lib/shared/logo-quarantine.ts")).toContain("return cached(QUARANTINE_DATE_FORMATS, intlLocale, (locale) =>");
  });
});

describe("revue performance, vingt et unième passe", () => {
  it("annuaires : clé de recherche calculée une fois par liste, pas de copie redondante", () => {
    for (const path of ["app/(secured)/joueurs/PlayersList.tsx", "app/(secured)/equipes/TeamsList.tsx"]) {
      const list = directorySource(path);
      expect(list).toContain("const [searchKeys] = useState(");
      expect(list).toMatch(/if \((q|query) && !searchKeyOf\(/);
      expect(list).not.toContain("r = [...r];");
    }
  });

  it("une porte à plusieurs espaces lit le chemin une fois", () => {
    expect(readSource("components/i18n/profile-text-providers.tsx").match(/usePathname\(\)/g)).toHaveLength(1);
    expect(readSource("components/i18n/english-gates.tsx")).toContain("const team = useEnglishMessagesAt(locale, englishTeam, messages, pathname);");
  });
});

describe("revue performance, vingt-deuxième passe", () => {
  it("les portes extérieures lisent le chemin une fois, pour leur anglais et celui de la fiche", () => {
    const gates = readSource("components/i18n/english-gates.tsx");
    expect(gates).toContain("useNestedEnglish(locale, TEAM_ROUTES, englishTeamErrors, waiting, pathname);");
    expect(gates).toContain("useNestedEnglish(locale, PLAYER_ROUTES, englishPlayers, waiting, pathname);");
    expect(gates).not.toContain("useLocalePathname");
  });

  it("le formulaire importé par la page d'un signalement n'amorce le chargeur que dans le navigateur", () => {
    expect(readSource("components/reports/report-form-loader.ts")).toContain('if (typeof window !== "undefined") dialogLoader.prime(dialog);');
  });
});

describe("revue performance, vingt-troisième passe", () => {
  it("le bouton du pied de page lit la page à l'ouverture, sans s'abonner au chemin", () => {
    const button = readSource("components/reports/ReportProblemButton.tsx");
    expect(button).not.toContain("useLocalePathname");
    expect(button).toContain("setPathname(splitLocalePrefix(window.location.pathname).path);");
  });
});

describe("revue performance, vingt-cinquième passe", () => {
  it("le formulaire et la page d'un signalement n'emportent pas les phrases françaises des catégories", () => {
    for (const path of ["components/reports/ReportProblemDialog.tsx", "app/(secured)/signalements/[id]/_components/ConcernedReport.tsx"]) {
      const source = readSource(path);
      expect(source).not.toContain("REPORT_CATEGORY_DEFINITIONS");
      expect(source).not.toContain("content-report-categories");
    }
    const shared = readSource("lib/shared/content-reports.ts");
    expect(shared).toContain("export const REPORT_CATEGORY_RULES");
    expect(shared).not.toContain("Un logo, un avatar ou une image utilisé sans autorisation.");
    expect(readSource("lib/shared/content-report-categories.ts")).toContain("...REPORT_CATEGORY_RULES.COPYRIGHT,");
  });
});

describe("revue performance, vingt-sixième passe", () => {
  it("l'entrée « Comportement d'un joueur » : le formulaire n'emporte que son pictogramme", () => {
    expect(readSource("components/reports/ReportProblemDialog.tsx")).toContain("{OFF_SITE_CONDUCT_ICON}");
    expect(readSource("lib/shared/content-reports.ts")).not.toContain('label: "Comportement d\'un joueur"');
  });
});

describe("revue performance, vingt-huitième passe", () => {
  it("un tap précharge aussi (clic en capture) ; le réglage push lit son état pendant que l'anglais arrive", () => {
    expect(readSource("components/i18n/english-link-preload-install.ts")).toContain('document.addEventListener("click", onIntent, { capture: true });');
    const launch = readSource("components/match-launch/MatchLaunchCenter.tsx");
    expect(launch).toContain("<div className={styles.pushSlot} data-waiting={hidden || undefined}>");
    // Échec : rien de monté ; sans boîte, aucun écart dans la colonne.
    expect(launch).toContain('if (locale === "en" && failed) return null;');
    expect(readSource("components/match-launch/MatchLaunchCenter.module.css")).toMatch(/\.pushSlot \{\s*display: contents;/);
    expect(readSource("components/i18n/scoped-text-context.tsx")).toContain(
      "if (state.locale !== locale || (state.value === undefined && messages !== undefined)) setState(read());",
    );
  });

  it("recadrage : un seul effet de démontage, pas de toast après le départ", () => {
    const hook = readSource("components/ui/image-crop-dialog.tsx");
    expect(hook).toContain("if (mountedRef.current) showError(");
    expect(hook.match(/mountedRef\.current = false;/g)).toHaveLength(1);
  });
});

describe("revue performance, vingt-neuvième passe", () => {
  it("bouton du pied et bouton flottant : le survol au toucher ne précharge rien", () => {
    expect(readSource("components/reports/ReportProblemButton.tsx")).toContain('if (event.pointerType !== "touch") preloadReportForm(locale);');
    expect(readSource("components/match-launch/MatchLaunchCenter.tsx")).toContain('if (event.pointerType !== "touch") preload();');
  });
});

describe("revue performance, trentième passe", () => {
  it("profil : la lecture ne repart pas sur un changement de texte", () => {
    const page = readSource("app/(secured)/profil/page.tsx");
    expect(page).toContain("}, [showError, router]);");
    expect(page).toContain("showError(profileLoadErrorMessage((e as Error).message, textRef.current))");
  });

  it("annuaires : clés de recherche calculées à la demande", () => {
    for (const path of ["app/(secured)/joueurs/PlayersList.tsx", "app/(secured)/equipes/TeamsList.tsx"]) {
      const list = directorySource(path);
      expect(list).toMatch(/const \[searchKeys\] = useState\(\(\) => new WeakMap</);
      expect(list).toContain("searchKeyOf(");
    }
  });

  it("clic : rien pour un nouvel onglet ou un téléchargement", () => {
    const install = readSource("components/i18n/english-link-preload-install.ts");
    expect(install).toContain("if (click.button !== 0 || click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return;");
    expect(install).toContain('if (link.hasAttribute("download") || !opensHere(link)) return;');
  });
});

/**
 * Le tri et les filtres de l'annuaire des joueurs vivent dans une fonction pure
 * (`lib/shared/player-directory.ts`, testée par comportement) : la source à
 * contrôler est celle du composant **et** de ce module.
 */
function directorySource(path: string): string {
  const list = readSource(path);
  return path.includes("joueurs") ? `${list}
${readSource("lib/shared/player-directory.ts")}` : list;
}

describe("revue performance, trente et unième passe", () => {
  it("annuaire des joueurs : la lecture ne repart pas sur un changement de texte", () => {
    const list = readSource("app/(secured)/joueurs/PlayersList.tsx");
    expect(list).toContain("  }, [showError]);");
    expect(list).toContain("playerErrorMessage(textRef.current,");
  });

  it("écouteur : adresse résolue (même origine), cibles « cet onglet » normalisées", () => {
    const install = readSource("components/i18n/english-link-preload-install.ts");
    expect(install).toContain("if (link.origin !== window.location.origin) return;");
    expect(install).toContain("const href = link.pathname;");
    expect(install).toContain('const target = (link.getAttribute("target") ?? "").trim().toLowerCase();');
  });
});

describe("revue performance, trente-deuxième passe", () => {
  it("annuaires : tri mémorisé à part, la recherche ne fait qu'un filtre", () => {
    for (const path of ["app/(secured)/joueurs/PlayersList.tsx", "app/(secured)/equipes/TeamsList.tsx"]) {
      const list = readSource(path);
      expect(list).toMatch(/const sorted = useMemo\(\s*\(\) => (\{|sortPlayers\()/);
      expect(directorySource(path)).toContain("return sorted.filter(");
    }
  });

  it("références de texte écrites après validation, jamais pendant le rendu ; TeamsList ne se relit pas sur un texte", () => {
    for (const path of ["app/(secured)/joueurs/PlayersList.tsx", "app/(secured)/profil/page.tsx"]) {
      expect(readSource(path)).not.toMatch(/^ {2}textRef\.current = text;$/m);
    }
    const teams = readSource("app/(secured)/equipes/TeamsList.tsx");
    expect(teams).toContain("teamErrorMessageRef.current((e as Error).message,");
    expect(teams).toContain("  }, [showError]);\n\n  useEffect(() => {\n    loadTeams();");
  });
});

describe("SonarCloud S8786 — barePath sans expression rationnelle", () => {
  it("ôte requête, ancre et barres finales, garde la racine", () => {
    expect(barePath("/equipes///")).toBe("/equipes");
    expect(barePath("/")).toBe("/");
    expect(barePath("//")).toBe("/");
    expect(barePath("/joueurs/3/?a=1#b")).toBe("/joueurs/3");
    expect(barePath("/profil#x/")).toBe("/profil");
    expect(barePath("")).toBe("");
  });
});
