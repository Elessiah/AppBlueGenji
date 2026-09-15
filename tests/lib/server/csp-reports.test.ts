import {
  CSP_DEDUPE_WINDOW_MS,
  CSP_MAX_TRACKED_CAUSES,
  CSP_MAX_VIOLATIONS_PER_REPORT,
  admitViolation,
  blockedOriginOf,
  documentPathOf,
  parseCspReport,
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
      { directive: "script-src-elem", blockedOrigin: "inline", documentPath: "/" },
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
    });
    const surTournoi = violationCause({
      directive: "img-src",
      blockedOrigin: "https://exemple.invalid",
      documentPath: "/tournois/42",
    });
    expect(surAccueil).toBe(surTournoi);
  });
});
