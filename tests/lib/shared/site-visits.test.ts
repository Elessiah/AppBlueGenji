import { describe, expect, it } from "@jest/globals";
import {
  MAX_VISIT_PATH_LENGTH,
  normalizeVisitPath,
  parseForwardedIp,
  SITE_VISIT_WINDOW_MINUTES,
  visitorIdentitySource,
} from "@/lib/shared/site-visits";

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

describe("parseForwardedIp", () => {
  it("prend la première IP de la chaîne de proxys", () => {
    expect(parseForwardedIp("203.0.113.7, 70.41.3.18, 150.172.238.178")).toBe("203.0.113.7");
  });

  it("gère une IP seule et les espaces", () => {
    expect(parseForwardedIp("  203.0.113.7  ")).toBe("203.0.113.7");
  });

  it("renvoie null pour un en-tête absent ou vide", () => {
    expect(parseForwardedIp(null)).toBeNull();
    expect(parseForwardedIp(undefined)).toBeNull();
    expect(parseForwardedIp("")).toBeNull();
    expect(parseForwardedIp(" , , ")).toBeNull();
  });
});

describe("fenêtre de session", () => {
  it("regroupe les chargements sur une demi-heure", () => {
    expect(SITE_VISIT_WINDOW_MINUTES).toBe(30);
  });
});
