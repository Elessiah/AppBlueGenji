import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { BOT_DOC_SECTIONS } from "@/lib/server/bot-docs";
import { TOURNAMENT_RULE_MODES } from "@/lib/shared/tournament-rules";

/**
 * Les deux portes d'entrée d'un moteur.
 *
 * Elles n'existaient pas : `robots.txt` et `sitemap.xml` répondaient `404` en
 * production. Ce qui est vérifié ici est ce que le protocole exige et que rien
 * d'autre ne rattraperait — des URL **absolues** (un sitemap en chemins relatifs
 * est rejeté en bloc), et un `robots.txt` qui désigne bien le sitemap, faute de
 * quoi il ne sert à rien.
 */

const APP_URL = process.env.APP_URL;

describe("robots.txt", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://bluegenji-esport.fr";
  });
  afterEach(() => {
    if (APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = APP_URL;
  });

  it("désigne le sitemap en URL absolue", () => {
    expect(robots().sitemap).toBe("https://bluegenji-esport.fr/sitemap.xml");
  });

  it("ouvre le site et n'interdit que les routes d'API", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule?.userAgent).toBe("*");
    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toEqual(["/api/"]);
  });

  it("ne double pas la barre oblique quand `APP_URL` en porte une", () => {
    process.env.APP_URL = "https://bluegenji-esport.fr/";
    expect(robots().sitemap).toBe("https://bluegenji-esport.fr/sitemap.xml");
  });

  it("n'écrit pas de directive `Host`, dépréciée et jamais lue", () => {
    // Extension Yandex abandonnée depuis 2018, dont la forme attendue est un
    // nom d'hôte : l'émettre avec un schéma ajoutait une ligne qu'un outil
    // d'audit signale sans qu'elle serve à personne.
    expect(robots().host).toBeUndefined();
  });

  it("reste servable sans `APP_URL`, plutôt que de faire échouer la route", () => {
    delete process.env.APP_URL;
    expect(robots().sitemap).toMatch(/^https?:\/\/[^/]+\/sitemap\.xml$/);
  });
});

describe("sitemap.xml", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://bluegenji-esport.fr";
  });
  afterEach(() => {
    if (APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = APP_URL;
  });

  it("n'écrit que des URL absolues, seule forme que le protocole accepte", () => {
    for (const entry of sitemap()) {
      expect(entry.url.startsWith("https://bluegenji-esport.fr")).toBe(true);
    }
  });

  it("porte l'accueil sans barre oblique finale, comme l'URL canonique rendue", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://bluegenji-esport.fr");
    expect(urls).not.toContain("https://bluegenji-esport.fr/");
  });

  it("liste chaque page de règles et chaque section de doc du bot", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const mode of TOURNAMENT_RULE_MODES) {
      expect(urls).toContain(`https://bluegenji-esport.fr/regles/${mode.slug}`);
    }
    for (const section of BOT_DOC_SECTIONS) {
      expect(urls).toContain(`https://bluegenji-esport.fr/bot/docs/${section.slug}`);
    }
  });

  it("ne laisse entrer aucune page de l'espace sécurisé", () => {
    for (const entry of sitemap()) {
      expect(entry.url).not.toMatch(/\/(tournois|equipes|joueurs|profil|connexion)(\/|$)/);
    }
  });

  it("n'annonce aucune date de modification, faute d'en connaître une vraie", () => {
    // Écrire l'instant du rendu annoncerait que tout le site change à chaque
    // visite : un moteur cesse alors d'y croire, y compris quand c'est vrai.
    for (const entry of sitemap()) {
      expect(entry.lastModified).toBeUndefined();
    }
  });

  it("est rendu à la demande, pour ne pas figer l'adresse du site", async () => {
    const [robotsModule, sitemapModule] = await Promise.all([
      import("@/app/robots"),
      import("@/app/sitemap"),
    ]);
    // Préremplies à la compilation, les deux routes emporteraient l'`APP_URL`
    // de la machine qui compile — `http://localhost:3000` si elle n'en a pas.
    expect(robotsModule.dynamic).toBe("force-dynamic");
    expect(sitemapModule.dynamic).toBe("force-dynamic");
  });
});
