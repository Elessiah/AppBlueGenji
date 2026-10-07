import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_REDIRECT,
  loginDestination,
  safeRedirectPath,
  sealedReturnLocale,
  sealedReturnPath,
  signedInLoginRedirect,
} from "@/lib/shared/safe-redirect";

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
    const page = source(join("app", "connexion", "_components", "LoginForm.tsx"));
    // Filtrée, puis rendue dans la langue de la page (lot 6).
    expect(page).toMatch(/setRedirect\(loginDestination\(params\.get\("redirect"\), text\.locale\)\)/);
    expect(page).not.toMatch(/params\.get\("redirect"\) \|\|/);
  });

  // Les deux portes OAuth vivent désormais dans un module unique, partagé par
  // les trois fournisseurs (`lib/server/oauth-flow.ts`) : c'est lui qu'on lit,
  // et non six routes de cinq lignes qui ne font que le nommer. Une copie par
  // fournisseur aurait justement pu oublier l'un des deux filtrages.
  it("l'aller OAuth filtre avant d'écrire le cookie d'état", () => {
    const flow = source(join("lib", "server", "oauth-flow.ts"));
    // `sealedReturnPath` passe par `safeRedirectPath` (testé plus bas).
    expect(flow).toMatch(/sealedReturnPath\(req\.nextUrl\.searchParams\.get\("redirect"\), locale\)/);
  });

  it("le retour OAuth filtre de nouveau ce qu'il lit du cookie", () => {
    const flow = source(join("lib", "server", "oauth-flow.ts"));
    expect(flow).toMatch(/loginDestination\(saved\.redirectTo/);
    expect(flow).not.toMatch(/new URL\(saved\.redirectTo/);
  });
});

/**
 * Un visiteur déjà connecté qui ouvre `/connexion` voyait le formulaire et la
 * modale d'entrée d'un nouveau compte. Il est envoyé là où il allait — par le
 * même filtre qu'au retour d'une connexion, et jamais vers `/connexion`
 * elle-même, que la page redirigerait vers elle-même à l'infini.
 */
describe("signedInLoginRedirect", () => {
  it("rend la destination demandée quand elle est un chemin du site", () => {
    expect(signedInLoginRedirect("/equipes/12?tab=roster#membres")).toBe("/equipes/12?tab=roster#membres");
  });

  it.each<[unknown]>([[undefined], [""], [["/profil"]], ["https://exemple.invalid"], ["//exemple.invalid"]])(
    "retombe sur la destination par défaut pour %p",
    (value) => {
      expect(signedInLoginRedirect(value)).toBe(DEFAULT_REDIRECT);
    },
  );

  it.each<[string]>([
    ["/connexion"],
    ["/connexion/"],
    ["/connexion?redirect=/profil"],
    ["/connexion#x"],
    ["/connexion/autre"],
    ["/tournois/../connexion?redirect=/tournois/../connexion"],
    ["/./connexion"],
    ["/%63onnexion"],
    ["/%E0%A4%A"],
  ])(
    "n'envoie jamais vers la page de connexion (%s)",
    (value) => {
      expect(signedInLoginRedirect(value)).toBe(DEFAULT_REDIRECT);
    },
  );

  it("ne confond pas une page dont le nom commence par « connexion »", () => {
    expect(signedInLoginRedirect("/connexions")).toBe("/connexions");
  });

  it("est appliquée par la page avant tout rendu du formulaire", () => {
    const page = readFileSync(join(__dirname, "..", "..", "..", "app", "connexion", "page.tsx"), "utf8");
    expect(page).toMatch(
      /if \(user && params\.error === undefined\) redirect\(localeHref\(signedInLoginRedirect\(params\.redirect\), locale\)\)/,
    );
  });
});

/**
 * Lot 6 : la page de connexion existe aussi sous `/en/connexion`, et ses
 * destinations portent un préfixe de langue. Le préfixe ne doit ouvrir aucune
 * porte nouvelle : retiré puis reposé, il ne démasque jamais un autre hôte.
 */
describe("préfixe de langue — la garde reste aussi stricte", () => {
  it.each([
    "/en//exemple.invalid",
    "/en//exemple.invalid/connexion",
    "/en/\\exemple.invalid",
    "/en\\/exemple.invalid",
    "/fr//exemple.invalid",
    "/regles//exemple.invalid",
    "/en/%2F%2Fexemple.invalid",
    "/en/%2fexemple.invalid",
    "/en/%5Cexemple.invalid",
    "/%2F%2Fexemple.invalid",
    "/en/\t/exemple.invalid",
  ])("refuse %j", (value) => {
    expect(safeRedirectPath(value)).toBe(DEFAULT_REDIRECT);
    expect(loginDestination(value, "en")).toBe(`/en${DEFAULT_REDIRECT}`);
    expect(sealedReturnPath(value, "en")).toBe(`/en${DEFAULT_REDIRECT}`);
  });

  it("laisse passer une requête ou une ancre qui contient une adresse : seul le chemin compte", () => {
    expect(safeRedirectPath("/tournois?retour=https://exemple.invalid//x")).toBe("/tournois?retour=https://exemple.invalid//x");
    expect(safeRedirectPath("/regles#a//b")).toBe("/regles#a//b");
  });

  it("garde une destination anglaise du site", () => {
    expect(safeRedirectPath("/en/regles/simple?x=1")).toBe("/en/regles/simple?x=1");
  });
});

describe("loginDestination — la langue de la page de connexion", () => {
  it("ramène un visiteur anglais sur la page anglaise", () => {
    expect(loginDestination("/regles", "en")).toBe("/en/regles");
    expect(loginDestination("/en/regles?x=1#y", "en")).toBe("/en/regles?x=1#y");
    expect(loginDestination("/", "en")).toBe("/en");
  });

  it("laisse française une route pas encore traduite", () => {
    expect(loginDestination("/tournois/12", "en")).toBe("/tournois/12");
    expect(loginDestination(null, "en")).toBe(`/en${DEFAULT_REDIRECT}`);
  });

  it("garde un visiteur français en français", () => {
    expect(loginDestination("/regles", "fr")).toBe("/regles");
    expect(loginDestination("/en/regles", "fr")).toBe("/regles");
  });
});

describe("sealedReturnPath / sealedReturnLocale — la langue scellée dans le cookie d'état", () => {
  it("préfixe la destination, même d'une route pas encore traduite", () => {
    expect(sealedReturnPath("/tournois/12?onglet=1", "en")).toBe("/en/tournois/12?onglet=1");
    expect(sealedReturnPath("/en/regles", "en")).toBe("/en/regles");
    expect(sealedReturnPath("/", "en")).toBe("/en");
    expect(sealedReturnPath(undefined, "en")).toBe("/en/tournois");
  });

  it("n'écrit rien de plus en français, et retire un préfixe qui ne correspond pas", () => {
    expect(sealedReturnPath("/tournois", "fr")).toBe("/tournois");
    expect(sealedReturnPath("/en/regles", "fr")).toBe("/regles");
  });

  it("relit la langue au retour, le français pour tout le reste", () => {
    expect(sealedReturnLocale("/en/tournois")).toBe("en");
    expect(sealedReturnLocale("/en")).toBe("en");
    expect(sealedReturnLocale("/tournois")).toBe("fr");
    expect(sealedReturnLocale("/enquete")).toBe("fr");
    expect(sealedReturnLocale("/en//exemple.invalid")).toBe("fr");
    expect(sealedReturnLocale(undefined)).toBe("fr");
    expect(sealedReturnLocale(42)).toBe("fr");
  });

  it("aller-retour : la destination scellée ressort dans la langue du départ", () => {
    for (const value of ["/regles", "/tournois/3", "/en/classement?jeu=ow", "/"]) {
      const sealed = sealedReturnPath(value, "en");
      expect(loginDestination(sealed, sealedReturnLocale(sealed))).toBe(loginDestination(value, "en"));
      const french = sealedReturnPath(value, "fr");
      expect(loginDestination(french, sealedReturnLocale(french))).toBe(loginDestination(value, "fr"));
    }
  });
});

describe("signedInLoginRedirect — /en/connexion est la même page", () => {
  it.each(["/en/connexion", "/en/connexion/", "/en/connexion?redirect=/x", "/en/%63onnexion"])("écarte %j", (value) => {
    expect(signedInLoginRedirect(value)).toBe(DEFAULT_REDIRECT);
  });

  it("garde une autre page anglaise", () => {
    expect(signedInLoginRedirect("/en/regles")).toBe("/en/regles");
  });
});
