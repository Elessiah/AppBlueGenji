import { afterEach, describe, expect, it } from "@jest/globals";
import { siteBaseUrl, siteMetadataBase, siteUrl } from "@/lib/server/site-url";
import { tournamentPageUrl } from "@/lib/server/tournaments/app-url";

/**
 * Sous quel nom le site est servi.
 *
 * Deux exigences opposées cohabitent, et c'est ce qui se vérifie ici : un
 * message Discord préfère **ne pas** porter de lien qu'en porter un inventé,
 * tandis que `metadataBase` doit rendre une URL **toujours** — sans elle, Next
 * sert des `og:image` relatives, que les robots d'aperçu ne résolvent pas.
 */

const ORIGINAL = process.env.APP_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = ORIGINAL;
});

describe("siteBaseUrl", () => {
  it("retire la barre oblique finale, quel qu'en soit le nombre", () => {
    process.env.APP_URL = "https://bluegenji.fr///";
    expect(siteBaseUrl()).toBe("https://bluegenji.fr");
  });

  it("rend null quand la variable est absente ou vide", () => {
    delete process.env.APP_URL;
    expect(siteBaseUrl()).toBeNull();

    process.env.APP_URL = "   ";
    expect(siteBaseUrl()).toBeNull();
  });
});

describe("siteUrl", () => {
  it("compose une URL absolue, que le chemin porte sa barre oblique ou non", () => {
    process.env.APP_URL = "https://bluegenji.fr";
    expect(siteUrl("/regles")).toBe("https://bluegenji.fr/regles");
    expect(siteUrl("regles")).toBe("https://bluegenji.fr/regles");
  });

  it("rend null sans racine connue : pas de lien inventé", () => {
    delete process.env.APP_URL;
    expect(siteUrl("/regles")).toBeNull();
  });
});

describe("tournamentPageUrl", () => {
  it("descend de la même lecture, avec la même règle du null", () => {
    process.env.APP_URL = "https://bluegenji.fr/";
    expect(tournamentPageUrl(42)).toBe("https://bluegenji.fr/tournois/42");

    delete process.env.APP_URL;
    expect(tournamentPageUrl(42)).toBeNull();
  });
});

describe("siteMetadataBase", () => {
  it("rend l'URL publique quand elle est réglée", () => {
    process.env.APP_URL = "https://bluegenji.fr/";
    expect(siteMetadataBase().toString()).toBe("https://bluegenji.fr/");
  });

  it("retombe sur le port de dev plutôt que de rendre l'absence", () => {
    delete process.env.APP_URL;
    expect(siteMetadataBase().toString()).toBe("http://localhost:3000/");
  });

  it("retombe aussi sur une valeur inutilisable, plutôt que de faire échouer la page", () => {
    // Sans protocole, `new URL` lève : ce serait toutes les pages du site qui
    // tomberaient, pour une variable mal recopiée.
    process.env.APP_URL = "bluegenji.fr";
    expect(siteMetadataBase().toString()).toBe("http://localhost:3000/");
  });
});
