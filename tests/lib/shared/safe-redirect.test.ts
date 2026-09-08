import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_REDIRECT, safeRedirectPath } from "@/lib/shared/safe-redirect";

/**
 * La destination d'après connexion, et pourquoi elle ne peut pas venir de l'URL
 * telle quelle.
 *
 * `/connexion?redirect=https://exemple.invalid` déposait l'utilisateur **hors du
 * site** une fois authentifié : une redirection ouverte, l'appât classique du
 * hameçonnage — le lien porte le vrai domaine, la vraie page de connexion, et
 * n'emmène ailleurs qu'une fois la confiance acquise. La voie Google la
 * reproduisait à l'identique, la valeur traversant le cookie d'état OAuth pour
 * ressortir par `new URL(redirectTo, base)`, qui **ignore sa base** dès que la
 * valeur est absolue.
 */

const ROOT = join(__dirname, "..", "..", "..");

describe("safeRedirectPath — ce qui passe", () => {
  it("laisse passer un chemin du site", () => {
    expect(safeRedirectPath("/tournois")).toBe("/tournois");
    expect(safeRedirectPath("/tournois/12")).toBe("/tournois/12");
  });

  it("conserve la requête et le fragment — c'est tout le contexte du lien partagé", () => {
    expect(safeRedirectPath("/tournois/12?phase=2")).toBe("/tournois/12?phase=2");
    expect(safeRedirectPath("/tournois/12#match-42")).toBe("/tournois/12#match-42");
  });

  it("accepte la racine", () => {
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("tolère les espaces autour — un copier-coller en laisse", () => {
    expect(safeRedirectPath("  /profil  ")).toBe("/profil");
  });
});

describe("safeRedirectPath — ce qui est refusé", () => {
  it("refuse une URL absolue, le cas d'origine", () => {
    expect(safeRedirectPath("https://exemple.invalid")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("http://exemple.invalid/tournois")).toBe(DEFAULT_REDIRECT);
  });

  it("refuse une URL protocole-relative, qui change de domaine sans nommer de schéma", () => {
    expect(safeRedirectPath("//exemple.invalid")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("//exemple.invalid/tournois")).toBe(DEFAULT_REDIRECT);
  });

  it("refuse sa variante à contre-barre, que les navigateurs lisent pareil", () => {
    expect(safeRedirectPath("/\\exemple.invalid")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("/\\/exemple.invalid")).toBe(DEFAULT_REDIRECT);
  });

  it("refuse un schéma exécutable", () => {
    expect(safeRedirectPath("javascript:alert(1)")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("data:text/html,<script>")).toBe(DEFAULT_REDIRECT);
  });

  it("refuse un chemin relatif — il se résout contre la page courante, pas contre la racine", () => {
    expect(safeRedirectPath("tournois")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("../admin")).toBe(DEFAULT_REDIRECT);
  });

  it("refuse ce qui porte un caractère que le navigateur retire avant résolution", () => {
    // `/\n/exemple.invalid` passerait « commence par une seule barre » puis
    // serait résolu en `//exemple.invalid`.
    expect(safeRedirectPath("/\n/exemple.invalid")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("/\t/exemple.invalid")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("/\r/exemple.invalid")).toBe(DEFAULT_REDIRECT);
    // Y compris au milieu d'un chemin par ailleurs valide : on refuse plutôt
    // que de nettoyer, une destination légitime n'en contient jamais.
    expect(safeRedirectPath(`/prof${String.fromCharCode(0)}il`)).toBe(DEFAULT_REDIRECT);
  });

  it("refuse ce qui n'est pas une chaîne — le paramètre peut être absent", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath(["/tournois"])).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath({ toString: () => "/tournois" })).toBe(DEFAULT_REDIRECT);
  });

  it("refuse la chaîne vide, et ce qui n'est que des espaces", () => {
    expect(safeRedirectPath("")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("   ")).toBe(DEFAULT_REDIRECT);
  });

  it("accepte un repli explicite, pour les appelants qui en ont un autre", () => {
    expect(safeRedirectPath("https://exemple.invalid", "/")).toBe("/");
  });
});

describe("safeRedirectPath — ce que le résultat garantit", () => {
  // La propriété qui compte : quelle que soit l'entrée, la destination reste sur
  // l'origine du site une fois résolue.
  const base = "https://bluegenji.example";
  const hostile = [
    "https://exemple.invalid",
    "//exemple.invalid",
    "/\\exemple.invalid",
    "/\n/exemple.invalid",
    "javascript:alert(1)",
    "https://bluegenji.example.exemple.invalid",
    "/tournois",
    "/",
  ];

  it.each(hostile)("« %s » reste sur l'origine du site", (candidate) => {
    // C'est exactement ce que fait le retour OAuth : `new URL(valeur, base)`.
    expect(new URL(safeRedirectPath(candidate), base).origin).toBe(base);
  });
});

describe("câblage des trois portes", () => {
  // La valeur franchit trois portes : la page de connexion, l'aller OAuth (qui
  // la range dans le cookie) et le retour OAuth (qui l'en ressort). Le cookie
  // d'état n'étant pas signé, filtrer à l'aller ne suffit pas.
  const source = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

  it("la page de connexion filtre le paramètre d'URL", () => {
    const page = source(join("app", "connexion", "page.tsx"));
    expect(page).toMatch(/setRedirect\(safeRedirectPath\(params\.get\("redirect"\)\)\)/);
    expect(page).not.toMatch(/params\.get\("redirect"\) \|\|/);
  });

  it("l'aller OAuth filtre avant d'écrire le cookie d'état", () => {
    const start = source(join("app", "api", "auth", "google", "start", "route.ts"));
    expect(start).toMatch(/safeRedirectPath\(req\.nextUrl\.searchParams\.get\("redirect"\)\)/);
  });

  it("le retour OAuth filtre de nouveau ce qu'il lit du cookie", () => {
    const callback = source(join("app", "api", "auth", "google", "callback", "route.ts"));
    expect(callback).toMatch(/safeRedirectPath\(cookieState\.redirectTo\)/);
    expect(callback).not.toMatch(/cookieState\.redirectTo \|\|/);
  });
});
