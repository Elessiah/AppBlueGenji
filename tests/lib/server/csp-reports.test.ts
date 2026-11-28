import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  CSP_DEDUPE_WINDOW_MS,
  CSP_FIELD_MAX_LENGTH,
  CSP_INPUT_MAX_LENGTH,
  CSP_LOG_BUDGET_WINDOW_MS,
  CSP_MAX_LOG_LINES_PER_WINDOW,
  CSP_MAX_TRACKED_CAUSES,
  CSP_MAX_VIOLATIONS_PER_REPORT,
  CSP_ORIGIN_IP,
  CSP_ORIGIN_LOCAL,
  CSP_SOURCE_NONE,
  CSP_SOURCE_PAGE,
  admitLogLine,
  admitViolation,
  blockedOriginOf,
  documentPathOf,
  logCspViolations,
  logSafe,
  parseCspReport,
  resetCspLogState,
  sourceOriginOf,
  violationCause,
} from "@/lib/server/csp-reports";

describe("blockedOriginOf", () => {
  it("réduit une URL à son origine", () => {
    // Le chemin d'une ressource refusée n'apprend rien de plus que son hôte,
    // et il allonge la ligne de journal.
    expect(blockedOriginOf("https://lh3.googleusercontent.com/a/ACg8ocK=s96-c")).toBe(
      "https://lh3.googleusercontent.com",
    );
  });

  it("laisse passer les mots-clés, qui ne sont pas des adresses", () => {
    expect(blockedOriginOf("inline")).toBe("inline");
    expect(blockedOriginOf("eval")).toBe("eval");
    expect(blockedOriginOf("data")).toBe("data");
    expect(blockedOriginOf("blob:")).toBe("blob");
  });

  it("rend un repli lisible plutôt que de lever", () => {
    expect(blockedOriginOf(undefined)).toBe("inconnu");
    expect(blockedOriginOf("")).toBe("inconnu");
    expect(blockedOriginOf(42)).toBe("inconnu");
    expect(blockedOriginOf("://pas-une-url")).toBe("inconnu");
  });

  it("rejette un mot-clé qui porte un saut de ligne", () => {
    // Sans quoi `inline\n[auth] …` écrirait une fausse ligne dans pm2.
    expect(blockedOriginOf("inline\n[auth] connexion admin")).toBe("inconnu");
  });

  it("borne la longueur d'une origine fabriquée", () => {
    const origin = blockedOriginOf(`https://${"ab.".repeat(10_000)}invalid/x`);
    expect(origin).toHaveLength(CSP_FIELD_MAX_LENGTH);
  });

  it("garde le schéma d'une adresse non standard, qui n'a pas d'origine", () => {
    expect(blockedOriginOf("webkit-masked-url://hidden/")).toBe("webkit-masked-url");
  });

  it("met un mot-clé en minuscules, pour qu'une casse ne dédouble pas la cause", () => {
    expect(blockedOriginOf("Data:text/plain,x")).toBe("data");
    expect(blockedOriginOf("INLINE")).toBe("inline");
  });
});

describe("logSafe", () => {
  it("remplace sauts de ligne, marques bidirectionnelles et largeur nulle", () => {
    expect(logSafe("a\nb\u202ec\u200bd\u2028e")).toBe("a?b?c?d?e");
  });

  it("garde entier un texte à la longueur maximale", () => {
    const text = "x".repeat(CSP_FIELD_MAX_LENGTH);
    expect(logSafe(text)).toBe(text);
  });

  it("coupe un texte trop long et le marque d'une empreinte", () => {
    const result = logSafe("x".repeat(CSP_FIELD_MAX_LENGTH + 1));
    expect(result).toHaveLength(CSP_FIELD_MAX_LENGTH);
    expect(result).toMatch(/^x+\u2026#[0-9a-f]{10}$/);
  });

  it("remplace aussi les autres caractères invisibles ou bidirectionnels", () => {
    expect(logSafe("a\u061cb\u180ec\u2060d\u2064e\ufefff")).toBe("a?b?c?d?e?f");
  });

  it("remplace une moitié de paire orpheline et garde une paire entière", () => {
    expect(logSafe("a\ud83db\ude00c\ud83d\ude00")).toBe("a?b?c\ud83d\ude00");
  });

  it("distingue deux textes trop longs au même début", () => {
    const start = "x".repeat(CSP_FIELD_MAX_LENGTH);
    expect(logSafe(`${start}b`)).not.toBe(logSafe(`${start}c`));
  });

  it("ne coupe jamais entre les deux moitiés d'une paire", () => {
    // La coupure tombe sur le 188e codet : l'émoji qui l'enjambe part entier.
    const result = logSafe(`${"x".repeat(187)}\ud83d\ude00${"y".repeat(50)}`);
    expect(result).toMatch(/^x{187}\u2026#[0-9a-f]{10}$/);
  });
});

describe("documentPathOf", () => {
  it("retire la chaîne de requête", () => {
    // `/connexion?redirect=…` porte une destination, les fiches portent des
    // identifiants : rien de tout cela n'aide à corriger une politique.
    expect(documentPathOf("https://bluegenji-esport.fr/connexion?redirect=/profil")).toBe(
      "/connexion",
    );
    expect(documentPathOf("https://bluegenji-esport.fr/tournois/42#match-7")).toBe("/tournois/42");
  });

  it("accepte une valeur relative", () => {
    expect(documentPathOf("/equipes/12?onglet=stats")).toBe("/equipes/12");
  });

  it("rend la racine à défaut", () => {
    expect(documentPathOf(undefined)).toBe("/");
    expect(documentPathOf("")).toBe("/");
    expect(documentPathOf("pas-un-chemin")).toBe("/");
  });

  it("neutralise un saut de ligne dans un chemin relatif", () => {
    expect(documentPathOf("/a\n[auth] connexion admin")).toBe("/a[auth]%20connexion%20admin");
  });
});

describe("parseCspReport", () => {
  it("lit le format historique application/csp-report", () => {
    const violations = parseCspReport({
      "csp-report": {
        "document-uri": "https://bluegenji-esport.fr/profil?x=1",
        "violated-directive": "img-src",
        "effective-directive": "img-src",
        "blocked-uri": "https://lh3.googleusercontent.com/a/ACg8ocK",
      },
    });
    expect(violations).toEqual([
      {
        directive: "img-src",
        blockedOrigin: "https://lh3.googleusercontent.com",
        documentPath: "/profil",
        sourceOrigin: CSP_SOURCE_NONE,
      },
    ]);
  });

  it("lit le format Reporting API, dont les champs sont nommés autrement", () => {
    // Ne lire que l'un des deux formats reviendrait à n'écouter que la moitié
    // des visiteurs, sans jamais savoir laquelle manque.
    const violations = parseCspReport([
      {
        type: "csp-violation",
        body: {
          documentURL: "https://bluegenji-esport.fr/",
          effectiveDirective: "script-src-elem",
          blockedURL: "inline",
        },
      },
    ]);
    expect(violations).toEqual([
      { directive: "script-src-elem", blockedOrigin: "inline", documentPath: "/", sourceOrigin: CSP_SOURCE_NONE },
    ]);
  });

  it("passe un effective-directive vide pour lire le violated-directive", () => {
    // Le premier champ non nul ne suffit pas : vide, il taisait une vraie violation.
    const violations = parseCspReport({
      "csp-report": {
        "effective-directive": "",
        "violated-directive": "img-src 'self'",
        "blocked-uri": "https://x.invalid/a.png",
      },
    });
    expect(violations.map((v) => v.directive)).toEqual(["img-src"]);
  });

  it("passe un effectiveDirective mal typé pour lire le violatedDirective", () => {
    const violations = parseCspReport([
      { type: "csp-violation", body: { effectiveDirective: 42, violatedDirective: "connect-src", blockedURL: "data" } },
    ]);
    expect(violations.map((v) => v.directive)).toEqual(["connect-src"]);
  });

  it("écarte un rapport dont toutes les directives sont vides", () => {
    expect(parseCspReport({ "csp-report": { "effective-directive": "  ", "violated-directive": "" } })).toEqual([]);
  });

  it("écarte les rapports d'un autre type que csp-violation", () => {
    expect(parseCspReport([{ type: "deprecation", body: { effectiveDirective: "x" } }])).toEqual([]);
  });

  it("ne lève sur aucun corps, même absurde", () => {
    // La route est publique : elle reçoit ce qu'on veut bien lui envoyer.
    expect(parseCspReport(null)).toEqual([]);
    expect(parseCspReport("texte")).toEqual([]);
    expect(parseCspReport({})).toEqual([]);
    expect(parseCspReport({ "csp-report": [] })).toEqual([]);
    expect(parseCspReport({ "csp-report": { "blocked-uri": "inline" } })).toEqual([]);
  });

  it("borne le nombre de violations lues à une seule requête, même fabriquée", () => {
    // Le dédoublonnage par cause ne protège que des rechargements répétés :
    // une requête unique portant des milliers de causes distinctes fabriquées
    // (un `blocked-uri` différent à chaque entrée) serait journalisée en
    // entier avant que `CSP_MAX_TRACKED_CAUSES` n'ait de quoi purger.
    const entries = Array.from({ length: CSP_MAX_VIOLATIONS_PER_REPORT * 3 }, (_, i) => ({
      type: "csp-violation",
      body: {
        effectiveDirective: "img-src",
        blockedURL: `https://cause-${i}.exemple.invalid`,
      },
    }));
    expect(parseCspReport(entries)).toHaveLength(CSP_MAX_VIOLATIONS_PER_REPORT);
  });

  it("ne remonte jamais l'extrait de script ni la requête de la page", () => {
    const [violation] = parseCspReport({
      "csp-report": {
        "document-uri": "https://bluegenji-esport.fr/connexion?redirect=/profil",
        "effective-directive": "script-src",
        "blocked-uri": "inline",
        "script-sample": "alert(document.cookie)",
        "source-file": "https://bluegenji-esport.fr/secret.js",
      },
    });
    expect(JSON.stringify(violation)).not.toContain("alert");
    expect(JSON.stringify(violation)).not.toContain("redirect");
    expect(JSON.stringify(violation)).not.toContain("secret.js");
  });

  it("lit le script fautif au format historique (source-file)", () => {
    const [violation] = parseCspReport({
      "csp-report": {
        "document-uri": "https://bluegenji-esport.fr/tournois/20",
        "effective-directive": "connect-src",
        "blocked-uri": "data",
        "source-file": "chrome-extension://abcdefghijklmnop/content.js",
      },
    });
    expect(violation.sourceOrigin).toBe("chrome-extension");
  });

  it("lit le script fautif au format Reporting API (sourceFile)", () => {
    const [violation] = parseCspReport([
      {
        type: "csp-violation",
        body: {
          documentURL: "https://bluegenji-esport.fr/tournois/20",
          effectiveDirective: "connect-src",
          blockedURL: "data",
          sourceFile: "https://bluegenji-esport.fr/_next/static/chunks/page.js",
        },
      },
    ]);
    expect(violation.sourceOrigin).toBe("https://bluegenji-esport.fr");
  });

  interface SourceCase {
    name: string;
    report: Record<string, unknown>;
    expected: string;
  }

  const SITE = "https://bluegenji-esport.fr";
  const legacy = (document: string, directive: string, blocked: string, source: string): Record<string, unknown> => ({
    "csp-report": {
      "document-uri": document,
      "effective-directive": directive,
      "blocked-uri": blocked,
      "source-file": source,
    },
  });

  const sourceCases: SourceCase[] = [
    {
      // Chrome nomme le document pour un script en ligne : sur notre site, ceux
      // de Next portent le nonce, donc ce code a été posé là par un tiers.
      name: "nomme « page » un script fautif qui est la page elle-même",
      report: legacy(`${SITE}/tournois/20?onglet=matchs`, "connect-src", "data", `${SITE}/tournois/20`),
      expected: CSP_SOURCE_PAGE,
    },
    {
      name: "garde l'origine du site pour un script d'une autre page du site",
      report: legacy(`${SITE}/tournois/20`, "connect-src", "data", `${SITE}/_next/static/chunks/a.js`),
      expected: SITE,
    },
    {
      // L'App Router change document-uri ; le code en ligne garde l'adresse
      // de la page où il a été posé.
      name: "nomme « page » un code posé sur une page quittée par une navigation côté client",
      report: legacy(`${SITE}/tournois/20`, "connect-src", "data", `${SITE}/tournois`),
      expected: CSP_SOURCE_PAGE,
    },
    {
      name: "nomme « page » une source qui porte une requête ou une barre finale",
      report: legacy(`${SITE}/tournois/20`, "connect-src", "data", `${SITE}/tournois/20/?onglet=matchs`),
      expected: CSP_SOURCE_PAGE,
    },
    {
      name: "nomme « page » au format Reporting API (documentURL, sourceFile)",
      report: {
        type: "csp-violation",
        body: {
          documentURL: `${SITE}/tournois/20`,
          effectiveDirective: "connect-src",
          blockedURL: "data",
          sourceFile: `${SITE}/tournois/20`,
        },
      },
      expected: CSP_SOURCE_PAGE,
    },
    {
      name: "nomme « page » un script en ligne refusé",
      report: legacy(`${SITE}/equipes`, "script-src-elem", "inline", `${SITE}/equipes`),
      expected: CSP_SOURCE_PAGE,
    },
    {
      // Une image tierce réintroduite dans le rendu serveur est un défaut du
      // site : Chrome nomme le document, la ligne ne doit pas accuser un tiers.
      name: "garde l'origine du site pour une image écrite dans le HTML de la page",
      report: legacy(`${SITE}/joueurs/x`, "img-src", "https://lh3.googleusercontent.com/a/photo", `${SITE}/joueurs/x`),
      expected: SITE,
    },
    {
      name: "garde l'origine du site pour un script externe écrit dans la page",
      report: legacy(`${SITE}/`, "script-src-elem", "https://cdn.example.com/x.js", `${SITE}/`),
      expected: SITE,
    },
    {
      name: "garde l'origine du site pour un script servi à la racine (.js)",
      report: legacy(`${SITE}/tournois/20`, "connect-src", "data", `${SITE}/push-sw.js`),
      expected: SITE,
    },
    {
      name: "garde le schéma d'une extension qui agit sur une page",
      report: legacy(`${SITE}/tournois/20`, "connect-src", "data", "chrome-extension://abcdefghijklmnop/content.js"),
      expected: "chrome-extension",
    },
    {
      name: "garde l'origine d'une page d'un autre site",
      report: legacy(`${SITE}/tournois/20`, "connect-src", "data", "https://autre.example/page"),
      expected: "https://autre.example",
    },
  ];

  it.each(sourceCases)("$name", ({ report, expected }) => {
    const [violation] = parseCspReport(report.type === undefined ? report : [report]);
    expect(violation.sourceOrigin).toBe(expected);
  });

  it("ne garde que le nom d'une directive historique complète", () => {
    const [violation] = parseCspReport({
      "csp-report": { "violated-directive": "script-src 'self' 'nonce-abc'", "blocked-uri": "inline" },
    });
    expect(violation.directive).toBe("script-src");
  });

  it("ne garde rien de ce qui suit un saut de ligne dans la directive", () => {
    const [violation] = parseCspReport({
      "csp-report": { "effective-directive": "img-src\n[auth] connexion admin", "blocked-uri": "inline" },
    });
    expect(violation.directive).toBe("img-src");
  });

  it("écarte une directive qui n'est pas un nom de directive", () => {
    expect(parseCspReport({ "csp-report": { "effective-directive": "img_src;[auth]" } })).toEqual([]);
  });

  it("met le nom de la directive en minuscules", () => {
    const [violation] = parseCspReport({ "csp-report": { "effective-directive": "IMG-SRC" } });
    expect(violation.directive).toBe("img-src");
  });
});

describe("sourceOriginOf", () => {
  it("réduit un script du site à son origine", () => {
    expect(sourceOriginOf("https://bluegenji-esport.fr/_next/static/chunks/a.js?v=1")).toBe(
      "https://bluegenji-esport.fr",
    );
  });

  it("ramène un script d'extension à son schéma, sans l'identifiant de l'extension", () => {
    // `connect-src a refusé data` sans source a fait chercher dans le site un
    // appel que seule une extension faisait : le schéma suffit à trancher.
    expect(sourceOriginOf("chrome-extension://abcdefghijklmnop/content.js")).toBe("chrome-extension");
    expect(sourceOriginOf("moz-extension://0d8e-uuid/inject.js")).toBe("moz-extension");
    expect(sourceOriginOf("safari-web-extension://ID/script.js")).toBe("safari-web-extension");
    expect(sourceOriginOf("Chrome-Extension://abc/x.js")).toBe("chrome-extension");
  });

  it("ramène l'adresse masquée par Safari d'un script d'extension à son schéma", () => {
    expect(sourceOriginOf("webkit-masked-url://hidden/")).toBe("webkit-masked-url");
    expect(sourceOriginOf("webkit-masked-url")).toBe("webkit-masked-url");
  });

  it("reconnaît le schéma seul, forme que Chrome envoie pour une extension", () => {
    expect(sourceOriginOf("chrome-extension")).toBe("chrome-extension");
    expect(sourceOriginOf("moz-extension")).toBe("moz-extension");
  });

  it("dit « aucune » quand le navigateur ne nomme aucun script", () => {
    // Code évalué ou injecté en ligne : Chrome envoie une chaîne vide.
    expect(sourceOriginOf(undefined)).toBe(CSP_SOURCE_NONE);
    expect(sourceOriginOf("")).toBe(CSP_SOURCE_NONE);
    expect(sourceOriginOf("   ")).toBe(CSP_SOURCE_NONE);
    expect(sourceOriginOf(42)).toBe(CSP_SOURCE_NONE);
  });

  it("garde le schéma d'une valeur sans hôte", () => {
    expect(sourceOriginOf("data:text/javascript,x")).toBe("data");
  });

  it("garde les mots-clés du navigateur pour un code sans fichier", () => {
    expect(sourceOriginOf("inline")).toBe("inline");
    expect(sourceOriginOf("eval")).toBe("eval");
  });

  it("rejette une valeur qui n'est ni adresse ni mot-clé", () => {
    expect(sourceOriginOf("inline\n[auth] connexion admin")).toBe("inconnu");
  });

  it("borne la longueur d'une origine fabriquée", () => {
    const origin = sourceOriginOf(`https://${"ab.".repeat(10_000)}invalid/x.js`);
    expect(origin).toHaveLength(CSP_FIELD_MAX_LENGTH);
  });

  it("garde le schéma d'une adresse non standard, qui n'a pas d'origine", () => {
    expect(sourceOriginOf("webkit-masked-url://hidden/")).toBe("webkit-masked-url");
  });

  it("rend un repli lisible sur une adresse illisible", () => {
    expect(sourceOriginOf("https://")).toBe("inconnu");
  });
});

describe("admitViolation", () => {
  it("n'admet qu'une occurrence par cause et par fenêtre", () => {
    // Une page fautive produit une violation par chargement, sur chaque visite
    // de chaque visiteur : journaliser chacune remplirait le disque.
    const tracker = new Map();
    expect(admitViolation(tracker, "img-src|https://exemple.invalid", 0)).toBe(0);
    expect(admitViolation(tracker, "img-src|https://exemple.invalid", 1_000)).toBeNull();
    expect(admitViolation(tracker, "img-src|https://exemple.invalid", 2_000)).toBeNull();
  });

  it("annonce combien d'occurrences ont été tues quand la fenêtre se rouvre", () => {
    const tracker = new Map();
    admitViolation(tracker, "c", 0);
    admitViolation(tracker, "c", 1);
    admitViolation(tracker, "c", 2);
    expect(admitViolation(tracker, "c", CSP_DEDUPE_WINDOW_MS + 1)).toBe(2);
  });

  it("ne confond pas deux causes distinctes", () => {
    const tracker = new Map();
    expect(admitViolation(tracker, "img-src|a", 0)).toBe(0);
    expect(admitViolation(tracker, "img-src|b", 0)).toBe(0);
    expect(admitViolation(tracker, "script-src|a", 0)).toBe(0);
  });

  it("garde la mémoire bornée face à des causes fabriquées", () => {
    // La route est publique et le corps est choisi par l'appelant : sans
    // borne, la table de dédoublonnage est un levier de saturation.
    const tracker = new Map();
    for (let i = 0; i < CSP_MAX_TRACKED_CAUSES * 3; i++) {
      admitViolation(tracker, `cause-${i}`, i);
    }
    expect(tracker.size).toBeLessThanOrEqual(CSP_MAX_TRACKED_CAUSES);
    // La cause qu'on vient d'admettre survit à sa propre purge.
    expect(tracker.has(`cause-${CSP_MAX_TRACKED_CAUSES * 3 - 1}`)).toBe(true);
  });
});

describe("violationCause", () => {
  it("distingue les causes par directive et par origine, pas par page", () => {
    // La même image refusée sur dix fiches de tournoi est un seul défaut.
    const surAccueil = violationCause({
      directive: "img-src",
      blockedOrigin: "https://exemple.invalid",
      documentPath: "/",
      sourceOrigin: CSP_SOURCE_NONE,
    });
    const surTournoi = violationCause({
      directive: "img-src",
      blockedOrigin: "https://exemple.invalid",
      documentPath: "/tournois/42",
      sourceOrigin: CSP_SOURCE_NONE,
    });
    expect(surAccueil).toBe(surTournoi);
  });

  it("distingue un même refus venu du site et d'une extension", () => {
    // Sinon l'extension, plus bavarde, tairait le vrai défaut du site.
    const duSite = violationCause({
      directive: "connect-src",
      blockedOrigin: "data",
      documentPath: "/tournois/20",
      sourceOrigin: "https://bluegenji-esport.fr",
    });
    const dExtension = violationCause({
      directive: "connect-src",
      blockedOrigin: "data",
      documentPath: "/tournois/20",
      sourceOrigin: "chrome-extension",
    });
    expect(duSite).not.toBe(dExtension);
  });
});

describe("logCspViolations", () => {
  // Le suivi de dédoublonnage vit au niveau du module : chaque test emploie
  // une cause qui lui est propre, et l'espion est rendu même sur un échec.
  afterEach(() => {
    jest.restoreAllMocks();
    resetCspLogState();
  });

  it("nomme la source dans la ligne, une fois par cause et par fenêtre", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const violation = {
      directive: "connect-src",
      blockedOrigin: "data",
      documentPath: "/tournois/20",
      sourceOrigin: "moz-extension",
    };
    logCspViolations([violation], 1_000);
    logCspViolations([violation], 2_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[csp] connect-src a refusé data sur /tournois/20 (source : moz-extension)");
  });

  it("n'écrit qu'une ligne, même sur des champs fabriqués", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    logCspViolations(
      [
        {
          directive: "font-src\n[auth] a",
          blockedOrigin: "b\nc",
          documentPath: "/d\re",
          sourceOrigin: "f\u2028g",
        },
      ],
      1_000,
    );
    expect(warn).toHaveBeenCalledWith("[csp] font-src?[auth] a a refusé b?c sur /d?e (source : f?g)");
  });
});

describe("bornes de lecture d'un corps fabriqué", () => {
  it("ne balaie que la tête d'un champ démesuré et y remplace les caractères dangereux", () => {
    const result = logSafe(`a\nb${"x".repeat(30_000)}\n`);
    expect(result).toHaveLength(CSP_FIELD_MAX_LENGTH);
    expect(result.startsWith("a?bxxx")).toBe(true);
  });

  it("lit une origine de 30 Ko faite de deux-points sans la découper", () => {
    expect(blockedOriginOf(":".repeat(30_000))).toBe("inconnu");
    expect(sourceOriginOf(":".repeat(30_000))).toBe("inconnu");
  });

  it("borne un chemin de document démesuré", () => {
    const path = documentPathOf(`https://exemple.invalid/${"a".repeat(30_000)}`);
    expect(path.length).toBeLessThanOrEqual(CSP_FIELD_MAX_LENGTH);
  });

  it("écarte une directive de 30 Ko d'espaces sans la découper", () => {
    const body = { "csp-report": { "effective-directive": " ".repeat(30_000), "blocked-uri": "inline" } };
    expect(parseCspReport(body)).toEqual([]);
  });

  it("garde une directive lisible placée avant le plafond de lecture", () => {
    const directive = `connect-src ${"x".repeat(CSP_INPUT_MAX_LENGTH * 2)}`;
    const [violation] = parseCspReport({ "csp-report": { "violated-directive": directive } });
    expect(violation.directive).toBe("connect-src");
  });
});

describe("admitViolation : récence", () => {
  it("n'évince pas une cause rafraîchie avant des causes plus récentes", () => {
    const tracker = new Map();
    admitViolation(tracker, "vieille", 0);
    for (let i = 0; i < CSP_MAX_TRACKED_CAUSES - 1; i++) admitViolation(tracker, `c-${i}`, 1 + i);
    // La fenêtre est écoulée : la cause est journalisée de nouveau, donc rafraîchie.
    admitViolation(tracker, "vieille", CSP_DEDUPE_WINDOW_MS + 1);
    admitViolation(tracker, "neuve", CSP_DEDUPE_WINDOW_MS + 2);
    expect(tracker.has("vieille")).toBe(true);
    expect(tracker.has("c-0")).toBe(false);
  });
});

const cause = (i: number, host: string) => ({
  directive: "img-src",
  blockedOrigin: `https://${host}${i}.invalid`,
  documentPath: "/",
  sourceOrigin: CSP_SOURCE_NONE,
});

describe("admitLogLine", () => {
  const fresh = () => ({ windowStart: Number.NEGATIVE_INFINITY, written: 0, dropped: 0 });

  it("laisse passer jusqu'au plafond puis compte les lignes tues", () => {
    const budget = fresh();
    for (let i = 0; i < CSP_MAX_LOG_LINES_PER_WINDOW; i++) {
      expect(admitLogLine(budget, 10).allowed).toBe(true);
    }
    expect(admitLogLine(budget, 10).allowed).toBe(false);
    expect(budget.dropped).toBe(1);
  });

  it("annonce les causes tues à l'ouverture de la fenêtre suivante", () => {
    const budget = fresh();
    for (let i = 0; i < CSP_MAX_LOG_LINES_PER_WINDOW + 3; i++) admitLogLine(budget, 10);
    expect(admitLogLine(budget, 10 + CSP_LOG_BUDGET_WINDOW_MS)).toEqual({ allowed: true, announce: 3, announceAtLeast: false });
    expect(budget.written).toBe(1);
  });

  it("ne réannonce rien dans une fenêtre sans perte", () => {
    const budget = fresh();
    admitLogLine(budget, 0);
    expect(admitLogLine(budget, CSP_LOG_BUDGET_WINDOW_MS)).toEqual({ allowed: true, announce: 0, announceAtLeast: false });
  });
});

describe("logCspViolations : plafond global", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetCspLogState();
  });

  it("n'écrit qu'un nombre borné de lignes face à des causes fabriquées", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const now = 50 * CSP_DEDUPE_WINDOW_MS;
    logCspViolations(Array.from({ length: 100 }, (_, i) => cause(i, "flood")), now);
    expect(warn).toHaveBeenCalledTimes(CSP_MAX_LOG_LINES_PER_WINDOW);
  });

  it("n'érige pas en cause vue une ligne qui n'a pas été écrite", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const now = 100 * CSP_DEDUPE_WINDOW_MS;
    logCspViolations(Array.from({ length: CSP_MAX_LOG_LINES_PER_WINDOW + 1 }, (_, i) => cause(i, "noyee")), now);
    warn.mockClear();
    // Fenêtre suivante : la dernière cause, tue plus tôt, s'écrit enfin (après l'annonce).
    const later = now + CSP_LOG_BUDGET_WINDOW_MS;
    logCspViolations([cause(CSP_MAX_LOG_LINES_PER_WINDOW, "noyee")], later);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("1 cause(s) non journalisée(s)");
    expect(warn.mock.calls[1][0]).toContain(`noyee${CSP_MAX_LOG_LINES_PER_WINDOW}`);
  });
});

describe("logCspViolations : plafond sans effet de bord sur le suivi", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetCspLogState();
  });

  it("ne fait pas évincer les causes réelles par un envoi tu par le plafond", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const real = cause(0, "reelle");
    logCspViolations([real], 1_000);
    // Plafond atteint, puis bien plus de causes que le suivi n'en retient.
    logCspViolations(Array.from({ length: CSP_MAX_TRACKED_CAUSES * 2 }, (_, i) => cause(i, "flood")), 1_000);
    warn.mockClear();
    logCspViolations([real], 2_000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ne compte qu'une fois une cause tue puis retentée", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const burst = Array.from({ length: CSP_MAX_LOG_LINES_PER_WINDOW + 2 }, (_, i) => cause(i, "retente"));
    logCspViolations(burst, 10);
    logCspViolations(burst, 20);
    logCspViolations(burst, 30);
    warn.mockClear();
    logCspViolations([], 10 + CSP_LOG_BUDGET_WINDOW_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("2 cause(s) non journalisée(s)");
  });

  it("annonce les causes tues sans attendre une cause neuve", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    logCspViolations(Array.from({ length: CSP_MAX_LOG_LINES_PER_WINDOW + 4 }, (_, i) => cause(i, "fin")), 5);
    warn.mockClear();
    logCspViolations([], 5 + CSP_LOG_BUDGET_WINDOW_MS);
    logCspViolations([], 6 + CSP_LOG_BUDGET_WINDOW_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("4 cause(s) non journalisée(s)");
  });

  it("compte distinctement sans suivi de causes", () => {
    const budget = { windowStart: 0, written: CSP_MAX_LOG_LINES_PER_WINDOW, dropped: 0 };
    admitLogLine(budget, 0, "a");
    admitLogLine(budget, 0, "a");
    expect(budget.dropped).toBe(2);
  });
});

describe("blockedOriginOf : coupure de lecture", () => {
  it("ne laisse pas une coupure au milieu d'une paire changer l'origine lue", () => {
    const prefix = "https://exemple.test/" + "a".repeat(CSP_INPUT_MAX_LENGTH - "https://exemple.test/".length - 1);
    const cut = blockedOriginOf(`${prefix}\u{1F600}suite`);
    expect(cut).toBe("https://exemple.test");
  });
});

describe("logSafe : caractères invisibles supplémentaires", () => {
  it("remplace le trait d'union conditionnel et un caractère d'étiquette", () => {
    expect(logSafe("/a\u{E0041}\u00adb")).toBe("/a??b");
  });

  it("remplace le remplissage hangul, le sélecteur de variante et les ancres d'annotation", () => {
    expect(logSafe("x\u3164\ufe0f\uffa0\ufffbx")).toBe("x????x");
  });
});

describe("documentPathOf : texte de l'appelant", () => {
  it("encode un faux segment de source dans un chemin relatif", () => {
    expect(documentPathOf("/a b (source : page)")).toBe("/a%20b%20(source%20:%20page)");
  });

  it("encode un caractère d'étiquette dans un chemin relatif", () => {
    expect(documentPathOf("/a\u{E0041}")).toBe("/a%F3%A0%81%81");
  });

  it("ramène le chemin opaque d'un document data: à la racine", () => {
    expect(documentPathOf("data:text/html,x (source : page)")).toBe("/");
  });
});

describe("origines en adresse IP ou locales", () => {
  it("tait une adresse IPv4", () => {
    expect(blockedOriginOf("http://192.168.1.4:8080/x.js")).toBe(`${CSP_ORIGIN_IP}:8080`);
  });

  it("tait une adresse IPv6", () => {
    expect(blockedOriginOf("http://[::1]:52130/x.js")).toBe(`${CSP_ORIGIN_IP}:52130`);
  });

  it("tait l'adresse de bouclage d'un script injecté", () => {
    expect(sourceOriginOf("http://127.0.0.1:52130/inject.js")).toBe(`${CSP_ORIGIN_IP}:52130`);
  });

  it("réduit localhost et un hôte .local au mot-clé local", () => {
    expect(blockedOriginOf("http://localhost:3000/a")).toBe(`${CSP_ORIGIN_LOCAL}:3000`);
    expect(sourceOriginOf("https://imprimante.local/a.js")).toBe(CSP_ORIGIN_LOCAL);
  });
});

describe("dédoublonnage : horloge qui recule", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetCspLogState();
  });

  it("réadmet une cause quand l'horloge recule", () => {
    const tracker = new Map<string, { last: number; suppressed: number }>();
    admitViolation(tracker, "c", 10 * CSP_DEDUPE_WINDOW_MS);
    expect(admitViolation(tracker, "c", 8 * CSP_DEDUPE_WINDOW_MS)).toBe(0);
  });

  it("journalise de nouveau une cause après un recul de l'horloge", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    logCspViolations([cause(0, "recul")], 10 * CSP_DEDUPE_WINDOW_MS);
    warn.mockClear();
    logCspViolations([cause(0, "recul")], 8 * CSP_DEDUPE_WINDOW_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("recul0");
  });
});

describe("compte des causes tues : suivi plein", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetCspLogState();
  });

  it("ne compte plus une cause inconnue une fois le suivi plein", () => {
    const droppedCauses = new Set(Array.from({ length: CSP_MAX_TRACKED_CAUSES }, (_, i) => `vue${i}`));
    const budget = { windowStart: 0, written: CSP_MAX_LOG_LINES_PER_WINDOW, dropped: CSP_MAX_TRACKED_CAUSES, droppedCauses };
    admitLogLine(budget, 0, "inconnue");
    expect(budget.dropped).toBe(CSP_MAX_TRACKED_CAUSES);
  });

  it("annonce « au moins » quand le compte atteint la borne du suivi", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const burst = Array.from({ length: CSP_MAX_LOG_LINES_PER_WINDOW + CSP_MAX_TRACKED_CAUSES + 50 }, (_, i) => cause(i, "plein"));
    logCspViolations(burst, 7);
    warn.mockClear();
    logCspViolations([], 7 + CSP_LOG_BUDGET_WINDOW_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`au moins ${CSP_MAX_TRACKED_CAUSES} cause(s) non journalisée(s)`);
  });
});

describe("origines masquées : formes détournées", () => {
  it("lit l'hôte d'une adresse blob: sur l'origine qu'elle enveloppe", () => {
    expect(blockedOriginOf("blob:http://192.168.1.5:8080/uuid")).toBe(`${CSP_ORIGIN_IP}:8080`);
  });

  it("masque l'hôte local d'une adresse blob:", () => {
    expect(sourceOriginOf("blob:http://johns-macbook.local/x")).toBe(CSP_ORIGIN_LOCAL);
  });

  it("masque un hôte local écrit avec un point final", () => {
    expect(sourceOriginOf("http://johns-macbook.local./inject.js")).toBe(CSP_ORIGIN_LOCAL);
    expect(blockedOriginOf("http://localhost./a")).toBe(CSP_ORIGIN_LOCAL);
  });

  it("masque un nom de machine sans point en gardant le port", () => {
    expect(sourceOriginOf("http://desktop-kerya:8080/x.js")).toBe(`${CSP_ORIGIN_LOCAL}:8080`);
  });

  it("masque les suffixes de réseau privé", () => {
    expect(sourceOriginOf("http://nas.lan/a.js")).toBe(CSP_ORIGIN_LOCAL);
    expect(sourceOriginOf("https://proxy.corp.internal/a.js")).toBe(CSP_ORIGIN_LOCAL);
    expect(sourceOriginOf("http://box.home.arpa/a.js")).toBe(CSP_ORIGIN_LOCAL);
  });

  it("garde deux services locaux sur deux ports distincts", () => {
    expect(blockedOriginOf("http://localhost:3000/a")).toBe(`${CSP_ORIGIN_LOCAL}:3000`);
    expect(blockedOriginOf("http://localhost:8888/a")).toBe(`${CSP_ORIGIN_LOCAL}:8888`);
  });

  it("garde l'origine d'un hôte public écrit avec un point final", () => {
    expect(blockedOriginOf("https://exemple.fr./a")).toBe("https://exemple.fr");
  });
});

describe("logSafe : classes Unicode", () => {
  it("remplace les caractères de mise en forme et ignorables qu'une liste oubliait", () => {
    expect(logSafe("a⁥b⁪c￰d\u{1BCA0}e\u{1D173}f\u{E0080}g")).toBe("a?b?c?d?e?f?g");
  });

  it("garde les lettres accentuées et un émoji visible", () => {
    expect(logSafe("/équipe-é\u{1F600}")).toBe("/équipe-é\u{1F600}");
  });
});

describe("dédoublonnage : petit recul de l'horloge", () => {
  it("tait encore une cause après un recul de quelques millisecondes", () => {
    const tracker = new Map<string, { last: number; suppressed: number }>();
    admitViolation(tracker, "c", 10 * CSP_DEDUPE_WINDOW_MS);
    expect(admitViolation(tracker, "c", 10 * CSP_DEDUPE_WINDOW_MS - 3)).toBeNull();
  });
});

describe("compte des causes tues : exact ou minimum", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetCspLogState();
  });

  it("annonce un compte exact sans suivi des causes, même au-delà de la borne", () => {
    const budget = { windowStart: 0, written: CSP_MAX_LOG_LINES_PER_WINDOW, dropped: CSP_MAX_TRACKED_CAUSES + 50 };
    expect(admitLogLine(budget, CSP_LOG_BUDGET_WINDOW_MS)).toEqual({
      allowed: true,
      announce: CSP_MAX_TRACKED_CAUSES + 50,
      announceAtLeast: false,
    });
  });

  it("annonce un minimum quand une cause inconnue tombe sur un suivi plein, puis repart exact", () => {
    const droppedCauses = new Set(Array.from({ length: CSP_MAX_TRACKED_CAUSES }, (_, i) => `vue${i}`));
    const budget = { windowStart: 0, written: CSP_MAX_LOG_LINES_PER_WINDOW, dropped: CSP_MAX_TRACKED_CAUSES, droppedCauses };
    admitLogLine(budget, 0, "inconnue");
    expect(admitLogLine(budget, CSP_LOG_BUDGET_WINDOW_MS).announceAtLeast).toBe(true);
    expect(admitLogLine(budget, 2 * CSP_LOG_BUDGET_WINDOW_MS).announceAtLeast).toBe(false);
  });

  it("annonce un compte exact quand le suivi se remplit sans cause de plus", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const burst = Array.from({ length: CSP_MAX_LOG_LINES_PER_WINDOW + CSP_MAX_TRACKED_CAUSES }, (_, i) => cause(i, "juste"));
    logCspViolations(burst, 9);
    warn.mockClear();
    logCspViolations([], 9 + CSP_LOG_BUDGET_WINDOW_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`] ${CSP_MAX_TRACKED_CAUSES} cause(s) non journalisée(s)`);
  });
});
