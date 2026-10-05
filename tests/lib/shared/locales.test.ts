import { describe, expect, it, jest } from "@jest/globals";

// Liste blanche simulée : au lot 0 elle est vide, et ces règles ne se
// vérifient que sur des routes traduites.
jest.mock("@/lib/shared/i18n-routes", () => ({
  MIGRATED_ROUTES: ["/", "/regles", "/regles/[slug]", "/equipes/[id]"],
}));

import {
  crossesLocale,
  isApiPath,
  isLocale,
  isMigratedRoute,
  localeAlternates,
  localeFromHeader,
  localeHref,
  splitLocalePrefix,
} from "@/lib/shared/locales";

describe("splitLocalePrefix — langue lue dans le chemin", () => {
  it("reconnaît /en et /en/… comme anglais, chemin sans préfixe", () => {
    expect(splitLocalePrefix("/en")).toEqual({ locale: "en", path: "/", prefixed: "en" });
    expect(splitLocalePrefix("/en/")).toEqual({ locale: "en", path: "/", prefixed: "en" });
    expect(splitLocalePrefix("/en/regles/swiss")).toEqual({ locale: "en", path: "/regles/swiss", prefixed: "en" });
  });

  it("ne prend qu'un segment entier : /enquete et /english restent français", () => {
    expect(splitLocalePrefix("/enquete")).toEqual({ locale: "fr", path: "/enquete", prefixed: null });
    expect(splitLocalePrefix("/english/x")).toEqual({ locale: "fr", path: "/english/x", prefixed: null });
  });

  it("signale /fr/… comme préfixé (à rediriger), la langue étant le français", () => {
    expect(splitLocalePrefix("/fr/regles")).toEqual({ locale: "fr", path: "/regles", prefixed: "fr" });
  });

  it("laisse un chemin sans préfixe intact", () => {
    expect(splitLocalePrefix("/")).toEqual({ locale: "fr", path: "/", prefixed: null });
  });
});

describe("isMigratedRoute — liste blanche", () => {
  it("accepte les routes listées, segments dynamiques compris, barre finale tolérée", () => {
    expect(isMigratedRoute("/")).toBe(true);
    expect(isMigratedRoute("/regles")).toBe(true);
    expect(isMigratedRoute("/regles/")).toBe(true);
    expect(isMigratedRoute("/regles/swiss")).toBe(true);
    expect(isMigratedRoute("/equipes/12")).toBe(true);
  });

  it("refuse le reste, et un segment dynamique vide ou en trop", () => {
    expect(isMigratedRoute("/classement")).toBe(false);
    expect(isMigratedRoute("/regles/swiss/x")).toBe(false);
    expect(isMigratedRoute("/equipes/")).toBe(false);
    expect(isMigratedRoute("/equipes")).toBe(false);
  });
});

describe("localeHref — adresse d'un lien dans une langue", () => {
  it("préfixe une route traduite en anglais, requête et ancre conservées", () => {
    expect(localeHref("/regles", "en")).toBe("/en/regles");
    expect(localeHref("/", "en")).toBe("/en");
    expect(localeHref("/regles/swiss?x=1#bo5", "en")).toBe("/en/regles/swiss?x=1#bo5");
  });

  it("laisse en français une route pas encore traduite", () => {
    expect(localeHref("/classement", "en")).toBe("/classement");
  });

  it("ne double jamais le préfixe, et le retire en français", () => {
    expect(localeHref("/en/regles", "en")).toBe("/en/regles");
    expect(localeHref("/en/regles", "fr")).toBe("/regles");
    expect(localeHref("/fr/regles", "fr")).toBe("/regles");
  });

  it("ne préfixe jamais /api", () => {
    expect(localeHref("/api/uploads/a.png", "en")).toBe("/api/uploads/a.png");
  });

  it("rend telle quelle une adresse qui n'est pas un chemin du site", () => {
    for (const href of ["https://discord.gg/x", "//evil.test/x", "/\\evil.test", "mailto:a@b.c", "#top", "regles"]) {
      expect(localeHref(href, "en")).toBe(href);
    }
  });
});

describe("crossesLocale — un lien qui change de langue", () => {
  it("vaut vrai d'une page anglaise vers une route restée française", () => {
    expect(crossesLocale("/classement", "en")).toBe(true);
  });

  it("vaut faux dans la même langue, et pour une adresse externe", () => {
    expect(crossesLocale("/regles", "en")).toBe(false);
    expect(crossesLocale("/classement", "fr")).toBe(false);
    expect(crossesLocale("https://discord.gg/x", "en")).toBe(false);
  });
});

describe("localeAlternates — hreflang réciproques", () => {
  it("donne les deux langues et x-default (français) d'une route traduite", () => {
    expect(localeAlternates("/regles")).toEqual({ fr: "/regles", en: "/en/regles", "x-default": "/regles" });
  });

  it("ne donne rien pour une route pas encore traduite", () => {
    expect(localeAlternates("/classement")).toBeNull();
  });
});

describe("validation de la langue", () => {
  it("n'accepte que fr et en, et retombe sur fr", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(localeFromHeader("en")).toBe("en");
    expect(localeFromHeader("EN")).toBe("fr");
    expect(localeFromHeader(null)).toBe("fr");
  });

  it("reconnaît /api et ses sous-chemins seulement", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/x")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
  });
});
