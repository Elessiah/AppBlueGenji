import { describe, expect, it } from "@jest/globals";
import {
  SITEMAP_DISALLOWED_PATHS,
  publicSitemapRoutes,
} from "@/lib/shared/sitemap";
import { TOURNAMENT_RULE_MODES } from "@/lib/shared/tournament-rules";

/**
 * Ce que le site déclare aux moteurs.
 *
 * Ce qui est vérifié ici n'est pas la forme d'une liste mais les trois pannes
 * qu'elle ferme : annoncer au sitemap une page qu'on demande par ailleurs
 * d'ignorer, y annoncer une redirection, et laisser la liste des règles diverger
 * du registre des modes.
 */

describe("publicSitemapRoutes", () => {
  const paths = publicSitemapRoutes().map((route) => route.path);

  it("annonce l'accueil et la vitrine", () => {
    expect(paths).toContain("/");
    expect(paths).toContain("/association");
    expect(paths).toContain("/regles");
    expect(paths).toContain("/bot");
    expect(paths).toContain("/mentions-legales");
  });

  it("n'annonce aucune page de l'espace sécurisé, qui porte un `noindex`", () => {
    // Un sitemap qui liste une page en `noindex` demande au moteur deux choses
    // contraires ; Search Console le remonte comme une erreur.
    for (const path of paths) {
      expect(path).not.toMatch(/^\/(tournois|equipes|joueurs|profil)(\/|$)/);
    }
  });

  it("n'annonce ni la connexion ni ses variantes", () => {
    expect(paths).not.toContain("/connexion");
    expect(paths.some((path) => path.includes("?"))).toBe(false);
  });

  it("n'annonce pas une redirection permanente", () => {
    // `/partenaires` ne rend plus de page : elle renvoie en 308 vers `/#sponsors`.
    expect(paths).not.toContain("/partenaires");
  });

  it("descend les pages de règles du registre des modes, sans seconde liste", () => {
    for (const mode of TOURNAMENT_RULE_MODES) {
      expect(paths).toContain(`/regles/${mode.slug}`);
    }
    const ruleCount = paths.filter((path) => path.startsWith("/regles/")).length;
    expect(ruleCount).toBe(TOURNAMENT_RULE_MODES.length);
  });

  it("annonce chaque section de la doc du bot, jamais la racine qui la duplique", () => {
    const withDocs = publicSitemapRoutes(["guide", "api-interne"]).map((r) => r.path);
    expect(withDocs).toContain("/bot/docs/guide");
    expect(withDocs).toContain("/bot/docs/api-interne");
    // `/bot/docs` rend la première section : la page se déclare elle-même
    // canonique sur `/bot/docs/guide`, le sitemap ne doit pas la contredire.
    expect(withDocs).not.toContain("/bot/docs");
  });

  it("sans doc du bot, ne perd aucune page de la vitrine", () => {
    expect(publicSitemapRoutes([]).map((r) => r.path)).toEqual(paths);
  });

  it("ne déclare aucun doublon", () => {
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("n'écrit que des chemins du site, jamais une URL absolue", () => {
    for (const path of paths) {
      expect(path.startsWith("/")).toBe(true);
      expect(path.startsWith("//")).toBe(false);
    }
  });

  it("garde les priorités dans l'intervalle du protocole", () => {
    for (const route of publicSitemapRoutes(["guide"])) {
      expect(route.priority).toBeGreaterThanOrEqual(0);
      expect(route.priority).toBeLessThanOrEqual(1);
    }
  });

  it("met l'accueil en tête de priorité", () => {
    const home = publicSitemapRoutes().find((route) => route.path === "/");
    expect(home?.priority).toBe(1);
  });
});

describe("SITEMAP_DISALLOWED_PATHS", () => {
  it("n'interdit que ce qui ne rend aucune page", () => {
    expect([...SITEMAP_DISALLOWED_PATHS]).toEqual(["/api/"]);
  });

  it("n'interdit pas l'espace sécurisé, dont le `noindex` doit être lu", () => {
    // Interdire l'exploration empêche le robot de lire la directive : il peut
    // alors indexer l'URL seule, sans titre ni description.
    expect(SITEMAP_DISALLOWED_PATHS).not.toContain("/tournois");
    expect(SITEMAP_DISALLOWED_PATHS).not.toContain("/connexion");
  });
});
