import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  canReturnInSite,
  isPlainLeftClick,
  previousSitePathname,
  recordSitePathname,
  resetSiteNavigation,
  sitePathFromReferrer,
  type SiteBackInput,
} from "@/lib/shared/site-back";

const ORIGIN = "https://bluegenji.test";

function input(overrides: Partial<SiteBackInput> = {}): SiteBackInput {
  return {
    previousPath: null,
    referrer: "",
    origin: ORIGIN,
    currentPath: "/tournois/12",
    historyLength: 3,
    ...overrides,
  };
}

describe("recordSitePathname / previousSitePathname", () => {
  beforeEach(() => resetSiteNavigation());

  it("ne connaît aucune page précédente à l'arrivée sur le site", () => {
    recordSitePathname("/tournois/12");
    expect(previousSitePathname()).toBeNull();
  });

  it("retient la page quittée à chaque navigation interne", () => {
    recordSitePathname("/");
    recordSitePathname("/tournois");
    recordSitePathname("/tournois/12");
    expect(previousSitePathname()).toBe("/tournois");
  });

  it("ne compte pas un chemin relevé deux fois comme une navigation", () => {
    // Nouveau rendu du composant de suivi, ou simple changement de fragment.
    recordSitePathname("/tournois");
    recordSitePathname("/tournois/12");
    recordSitePathname("/tournois/12");
    expect(previousSitePathname()).toBe("/tournois");
  });
});

describe("sitePathFromReferrer", () => {
  it("rend le chemin d'un référent de notre origine", () => {
    expect(sitePathFromReferrer(`${ORIGIN}/equipes/4?x=1#y`, ORIGIN)).toBe("/equipes/4");
  });

  it("refuse un autre site, même sous-domaine ou autre schéma", () => {
    expect(sitePathFromReferrer("https://discord.com/channels/1/2", ORIGIN)).toBeNull();
    expect(sitePathFromReferrer("https://www.bluegenji.test/tournois", ORIGIN)).toBeNull();
    expect(sitePathFromReferrer("http://bluegenji.test/tournois", ORIGIN)).toBeNull();
  });

  it("refuse un référent vide ou illisible", () => {
    expect(sitePathFromReferrer("", ORIGIN)).toBeNull();
    expect(sitePathFromReferrer("pas une url", ORIGIN)).toBeNull();
  });
});

describe("canReturnInSite", () => {
  it("revient après une navigation interne", () => {
    expect(canReturnInSite(input({ previousPath: "/tournois" }))).toBe(true);
    expect(canReturnInSite(input({ previousPath: "/" }))).toBe(true);
  });

  it("revient sur un référent du site quand rien n'a été relevé", () => {
    // Nouvel onglet ouvert depuis la liste, ou page rechargée.
    expect(canReturnInSite(input({ referrer: `${ORIGIN}/tournois` }))).toBe(true);
  });

  it("préfère la navigation relevée au référent d'arrivée", () => {
    // Arrivé depuis Discord puis passé par la liste : le référent reste Discord.
    expect(
      canReturnInSite(input({ previousPath: "/tournois", referrer: "https://discord.com/x" })),
    ).toBe(true);
    // Et une navigation interne vers la connexion l'emporte sur un bon référent.
    expect(
      canReturnInSite(input({ previousPath: "/connexion", referrer: `${ORIGIN}/tournois` })),
    ).toBe(false);
  });

  it("ne revient pas sur un lien partagé ou un onglet vide", () => {
    expect(canReturnInSite(input({ referrer: "https://discord.com/channels/1/2" }))).toBe(false);
    expect(canReturnInSite(input())).toBe(false);
  });

  it("ne revient pas sans entrée d'historique précédente", () => {
    expect(canReturnInSite(input({ previousPath: "/tournois", historyLength: 1 }))).toBe(false);
    expect(canReturnInSite(input({ referrer: `${ORIGIN}/tournois`, historyLength: 1 }))).toBe(false);
  });

  it("ne rejoue jamais la connexion", () => {
    expect(canReturnInSite(input({ previousPath: "/connexion" }))).toBe(false);
    expect(canReturnInSite(input({ referrer: `${ORIGIN}/connexion` }))).toBe(false);
    expect(canReturnInSite(input({ previousPath: "/connexion/autre" }))).toBe(false);
    // Un préfixe de mot n'est pas un segment : `/connexions` reste une page.
    expect(canReturnInSite(input({ previousPath: "/connexions" }))).toBe(true);
  });

  it("ne revient pas sur la page elle-même", () => {
    expect(canReturnInSite(input({ referrer: `${ORIGIN}/tournois/12` }))).toBe(false);
    expect(canReturnInSite(input({ previousPath: "/tournois/12" }))).toBe(false);
  });
});

describe("isPlainLeftClick", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it("accepte le clic principal sans modificateur", () => {
    expect(isPlainLeftClick(click)).toBe(true);
  });

  it.each<[string, Partial<typeof click>]>([
    ["du bouton du milieu", { button: 1 }],
    ["avec ⌘", { metaKey: true }],
    ["avec Ctrl", { ctrlKey: true }],
    ["avec Maj", { shiftKey: true }],
    ["avec Alt", { altKey: true }],
  ])("laisse au lien un clic %s", (_label, override) => {
    expect(isPlainLeftClick({ ...click, ...override })).toBe(false);
  });
});
