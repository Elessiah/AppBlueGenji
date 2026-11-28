import { describe, expect, it, jest } from "@jest/globals";
import {
  CSP_DEDUPE_WINDOW_MS,
  CSP_MAX_TRACKED_CAUSES,
  CSP_MAX_VIOLATIONS_PER_REPORT,
  CSP_SOURCE_NONE,
  admitViolation,
  blockedOriginOf,
  documentPathOf,
  logCspViolations,
  parseCspReport,
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

  it("dit « aucune » quand le navigateur ne nomme aucun script", () => {
    // Code évalué ou injecté en ligne : Chrome envoie une chaîne vide.
    expect(sourceOriginOf(undefined)).toBe(CSP_SOURCE_NONE);
    expect(sourceOriginOf("")).toBe(CSP_SOURCE_NONE);
    expect(sourceOriginOf("   ")).toBe(CSP_SOURCE_NONE);
    expect(sourceOriginOf(42)).toBe(CSP_SOURCE_NONE);
  });

  it("garde le schéma d'une valeur sans hôte, et un repli sans schéma", () => {
    expect(sourceOriginOf("data:text/javascript,x")).toBe("data");
    expect(sourceOriginOf("inline")).toBe("inconnu");
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
    warn.mockRestore();
  });
});
