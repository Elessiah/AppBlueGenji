import { describe, expect, it } from "@jest/globals";
import {
  clientIpFromForwardedFor,
  DEFAULT_TRUSTED_PROXY_HOPS,
  MAX_VISIT_PATH_LENGTH,
  normalizeVisitPath,
  parseTrustedProxyHops,
  SITE_VISIT_WINDOW_MINUTES,
  visitorIdentitySource,
  AUDIENCE_OPT_OUT_COOKIE,
  AUDIENCE_OPT_OUT_MAX_AGE_DAYS,
  SITE_VISITOR_RETENTION_MONTHS,
  audienceOptOutCookieString,
  audienceOptOutFromHeaders,
  audienceOptOutReason,
  readCookieValue,
  strongerAudienceOptOut,
} from "@/lib/shared/site-visits";

describe("opposition à la mesure d'audience", () => {
  it("lit GPC, puis DNT, puis le choix du cookie", () => {
    expect(audienceOptOutReason({ gpc: true, dnt: "1", cookie: "bg_audience_optout=1" })).toBe("GPC");
    expect(audienceOptOutReason({ gpc: "1" })).toBe("GPC");
    expect(audienceOptOutReason({ dnt: "1", cookie: "bg_audience_optout=1" })).toBe("DNT");
    expect(audienceOptOutReason({ cookie: "a=b; bg_audience_optout=1" })).toBe("CHOICE");
  });

  it("ne voit aucune opposition dans un signal absent, à 0 ou « unspecified »", () => {
    expect(audienceOptOutReason({})).toBeNull();
    expect(audienceOptOutReason({ gpc: false, dnt: "0" })).toBeNull();
    expect(audienceOptOutReason({ gpc: null, dnt: "unspecified", cookie: "" })).toBeNull();
    expect(audienceOptOutReason({ cookie: "bg_audience_optout=0" })).toBeNull();
    // Un cookie au nom voisin n'est pas le choix.
    expect(audienceOptOutReason({ cookie: "xbg_audience_optout=1" })).toBeNull();
  });

  it("se lit sur les en-têtes d'une requête", () => {
    expect(audienceOptOutFromHeaders(new Headers({ "Sec-GPC": "1" }))).toBe("GPC");
    expect(audienceOptOutFromHeaders(new Headers({ DNT: "1" }))).toBe("DNT");
    expect(audienceOptOutFromHeaders(new Headers({ Cookie: `${AUDIENCE_OPT_OUT_COOKIE}=1` }))).toBe("CHOICE");
    expect(audienceOptOutFromHeaders(new Headers())).toBeNull();
  });

  it("lit une valeur de cookie sans se tromper de nom", () => {
    expect(readCookieValue("a=1; b = 2 ;c=3", "b")).toBe("2");
    expect(readCookieValue("a=1", "b")).toBeNull();
    expect(readCookieValue(null, "a")).toBeNull();
  });

  it("pose le cookie treize mois, sans identifiant, et l'efface au retour", () => {
    expect(audienceOptOutCookieString(true, true)).toBe(
      `bg_audience_optout=1; Path=/; Max-Age=${395 * 86400}; SameSite=Lax; Secure`,
    );
    expect(AUDIENCE_OPT_OUT_MAX_AGE_DAYS).toBeLessThanOrEqual(395);
    expect(audienceOptOutCookieString(false, false)).toBe("bg_audience_optout=; Path=/; Max-Age=0; SameSite=Lax");
  });

  it("garde la plus forte de deux lectures : un cookie n'éclipse pas un signal d'en-tête", () => {
    expect(strongerAudienceOptOut("DNT", "CHOICE")).toBe("DNT");
    expect(strongerAudienceOptOut("CHOICE", "GPC")).toBe("GPC");
    expect(strongerAudienceOptOut("GPC", "DNT")).toBe("GPC");
    expect(strongerAudienceOptOut(null, "CHOICE")).toBe("CHOICE");
    expect(strongerAudienceOptOut("DNT", null)).toBe("DNT");
    expect(strongerAudienceOptOut(null, null)).toBeNull();
  });

  it("borne l'empreinte à 25 mois", () => {
    expect(SITE_VISITOR_RETENTION_MONTHS).toBe(25);
  });
});

describe("normalizeVisitPath", () => {
  it("garde un chemin déjà propre", () => {
    expect(normalizeVisitPath("/tournois")).toBe("/tournois");
  });

  it("retombe sur la racine pour une entrée absente ou vide", () => {
    expect(normalizeVisitPath(undefined)).toBe("/");
    expect(normalizeVisitPath(null)).toBe("/");
    expect(normalizeVisitPath("")).toBe("/");
    expect(normalizeVisitPath("   ")).toBe("/");
    expect(normalizeVisitPath(42)).toBe("/");
  });

  it("réduit une URL absolue à son chemin", () => {
    expect(normalizeVisitPath("https://bluegenji.fr/equipes/12")).toBe("/equipes/12");
    // Racine implicite : pas de chemin après l'hôte.
    expect(normalizeVisitPath("https://bluegenji.fr")).toBe("/");
  });

  it("écarte la query string et le fragment", () => {
    expect(normalizeVisitPath("/tournois?state=RUNNING&page=2")).toBe("/tournois");
    expect(normalizeVisitPath("/regles#survival")).toBe("/regles");
    expect(normalizeVisitPath("https://bluegenji.fr/joueurs?id=3#top")).toBe("/joueurs");
  });

  it("normalise les chemins mal formés", () => {
    expect(normalizeVisitPath("tournois")).toBe("/tournois");
    expect(normalizeVisitPath("//equipes//12")).toBe("/equipes/12");
    expect(normalizeVisitPath("/tournois/")).toBe("/tournois");
    expect(normalizeVisitPath("/")).toBe("/");
  });

  it("supprime les caractères d'espacement injectés", () => {
    expect(normalizeVisitPath("/tour nois\n")).toBe("/tournois");
  });

  it("tronque un chemin démesuré à la taille de la colonne", () => {
    const long = `/${"a".repeat(400)}`;
    expect(normalizeVisitPath(long)).toHaveLength(MAX_VISIT_PATH_LENGTH);
  });
});

describe("visitorIdentitySource", () => {
  it("identifie un visiteur connecté par son compte", () => {
    expect(visitorIdentitySource({ userId: 321, ip: "1.2.3.4", userAgent: "Firefox" })).toBe("u:321");
  });

  it("reconnaît un même compte d'un appareil à l'autre", () => {
    const home = visitorIdentitySource({ userId: 7, ip: "1.2.3.4", userAgent: "Firefox" });
    const mobile = visitorIdentitySource({ userId: 7, ip: "9.9.9.9", userAgent: "Safari" });
    expect(home).toBe(mobile);
  });

  it("retombe sur l'empreinte réseau pour un visiteur anonyme", () => {
    expect(visitorIdentitySource({ userId: null, ip: "1.2.3.4", userAgent: "Firefox" })).toBe(
      "a:1.2.3.4|Firefox",
    );
  });

  it("ignore un identifiant de compte invalide", () => {
    for (const userId of [0, -3, 1.5, Number.NaN]) {
      expect(visitorIdentitySource({ userId, ip: "1.2.3.4", userAgent: "Firefox" })).toBe(
        "a:1.2.3.4|Firefox",
      );
    }
  });

  it("distingue deux navigateurs derrière la même IP", () => {
    const firefox = visitorIdentitySource({ ip: "1.2.3.4", userAgent: "Firefox" });
    const chrome = visitorIdentitySource({ ip: "1.2.3.4", userAgent: "Chrome" });
    expect(firefox).not.toBe(chrome);
  });

  it("reste stable quand IP et user-agent manquent", () => {
    expect(visitorIdentitySource({})).toBe("a:unknown-ip|unknown-ua");
    expect(visitorIdentitySource({ ip: "  ", userAgent: "" })).toBe("a:unknown-ip|unknown-ua");
  });
});

describe("clientIpFromForwardedFor", () => {
  it("prend l'entrée ajoutée par le proxy de confiance, pas celle du client", () => {
    // Un client malveillant préfixe sa propre valeur ; nginx ajoute la vraie à droite.
    expect(clientIpFromForwardedFor("1.1.1.1, 203.0.113.7")).toBe("203.0.113.7");
  });

  it("gère une IP seule et les espaces", () => {
    expect(clientIpFromForwardedFor("  203.0.113.7  ")).toBe("203.0.113.7");
  });

  it("remonte d'autant d'entrées qu'il y a de relais de confiance", () => {
    const chain = "1.1.1.1, 203.0.113.7, 70.41.3.18, 150.172.238.178";
    expect(clientIpFromForwardedFor(chain, 1)).toBe("150.172.238.178");
    expect(clientIpFromForwardedFor(chain, 2)).toBe("70.41.3.18");
    expect(clientIpFromForwardedFor(chain, 3)).toBe("203.0.113.7");
  });

  it("ne sort jamais des bornes si la chaîne est plus courte qu'annoncé", () => {
    expect(clientIpFromForwardedFor("203.0.113.7", 4)).toBe("203.0.113.7");
  });

  it("ramène un nombre de relais aberrant à au moins un", () => {
    const chain = "1.1.1.1, 203.0.113.7";
    for (const hops of [0, -3, Number.NaN]) {
      expect(clientIpFromForwardedFor(chain, hops)).toBe("203.0.113.7");
    }
  });

  it("renvoie null pour un en-tête absent ou vide", () => {
    expect(clientIpFromForwardedFor(null)).toBeNull();
    expect(clientIpFromForwardedFor(undefined)).toBeNull();
    expect(clientIpFromForwardedFor("")).toBeNull();
    expect(clientIpFromForwardedFor(" , , ")).toBeNull();
  });
});

describe("parseTrustedProxyHops", () => {
  it("lit une valeur configurée", () => {
    expect(parseTrustedProxyHops("2")).toBe(2);
  });

  it("retombe sur le défaut pour une valeur absente ou aberrante", () => {
    for (const raw of [undefined, null, "", "  ", "zéro", "0", "-2"]) {
      expect(parseTrustedProxyHops(raw)).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
    }
  });
});

describe("fenêtre de session", () => {
  it("regroupe les chargements sur une demi-heure", () => {
    expect(SITE_VISIT_WINDOW_MINUTES).toBe(30);
  });
});
