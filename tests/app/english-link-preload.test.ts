/**
 * Préchargement de l'anglais au survol d'un lien `/en/…` de l'espace connecté
 * (revue de performance du lot 9-2) : chaque page visée lance ses espaces, et
 * rien d'autre.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readSource } from "../helpers/read-source";
import { englishReports } from "@/components/i18n/english-loaders";
import { englishPlayers, englishProfile, englishPush, englishStatsPanel, englishTeam, englishTeamErrors } from "@/components/i18n/english-loaders-account";
import { preloadEnglishFor } from "@/components/i18n/english-link-targets";

type Name = "englishReports" | "englishPlayers" | "englishProfile" | "englishPush" | "englishStatsPanel" | "englishTeam" | "englishTeamErrors";
const LOADERS: Record<Name, { load: () => Promise<unknown> }> = {
  englishReports,
  englishPlayers,
  englishProfile,
  englishPush,
  englishStatsPanel,
  englishTeam,
  englishTeamErrors,
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
    expect(preloaded("/signalements/3#detail")).toEqual(["englishReports"]);
    expect(preloaded("/profil#notifications")).toEqual(["englishProfile", "englishPush", "englishTeamErrors"]);
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
    expect(listener).toContain('targets ??= import("./english-link-targets");');
    expect(listener).toContain('if (!href.startsWith("/en/")) return;');
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
    expect(gates).toContain("useNestedEnglish(locale, TEAM_PAGE_PATH, TEAM_PAGE_LOADERS);");
    expect(gates).toContain("useNestedEnglish(locale, PLAYER_PAGE_PATH, PLAYER_PAGE_LOADERS);");
    expect(gates).toContain("const TEAM_PAGE_LOADERS = [englishTeam, englishStatsPanel];");
  });
});
