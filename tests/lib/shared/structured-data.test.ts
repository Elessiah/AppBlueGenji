import { describe, expect, it } from "@jest/globals";
import {
  ORGANIZATION_DISCORD_URL,
  ORGANIZATION_LEGAL_NAME,
  ORGANIZATION_NAME,
  breadcrumbJsonLd,
  organizationJsonLd,
  serializeJsonLd,
  webSiteJsonLd,
} from "@/lib/shared/structured-data";

const BASE = "https://bluegenji-esport.fr";

/**
 * Les données structurées.
 *
 * Deux choses se testent ici, et une seule est cosmétique. La forme des nœuds
 * d'abord — un `@id` qui dérive entre deux pages fait déclarer deux
 * associations là où il n'y en a qu'une. La **sérialisation** ensuite, qui est
 * la seule partie capable de casser la page : `JSON.stringify` n'échappe pas
 * `<`, et un `</script>` glissé dans un texte fermerait la balise.
 */

describe("organizationJsonLd", () => {
  const node = organizationJsonLd(BASE, "Une association esport.");

  it("se déclare comme une structure sportive, pas comme une entreprise", () => {
    expect(node["@type"]).toBe("SportsOrganization");
    expect(node["@context"]).toBe("https://schema.org");
  });

  it("porte une identité absolue et stable, celle que le site référencera", () => {
    expect(node["@id"]).toBe(`${BASE}/#organisation`);
  });

  it("distingue le nom d'usage de la raison sociale", () => {
    expect(node.name).toBe(ORGANIZATION_NAME);
    expect(node.legalName).toBe(ORGANIZATION_LEGAL_NAME);
  });

  it("reprend le siège social des mentions légales", () => {
    expect(node.address).toMatchObject({
      "@type": "PostalAddress",
      postalCode: "51210",
      addressLocality: "Janvilliers",
      addressCountry: "FR",
    });
  });

  it("n'annonce que les liens publics que le site porte vraiment", () => {
    expect(node.sameAs).toEqual([ORGANIZATION_DISCORD_URL]);
  });

  it("ne double jamais la barre oblique, quelle que soit la racine reçue", () => {
    const trailing = organizationJsonLd(`${BASE}/`, "x");
    expect(trailing["@id"]).toBe(`${BASE}/#organisation`);
    expect(trailing.url).toBe(`${BASE}/`);
    expect(trailing.logo).toBe(`${BASE}/logo_bg.webp`);
  });
});

describe("webSiteJsonLd", () => {
  const node = webSiteJsonLd(BASE, "Une plateforme de tournois.");

  it("est un nœud distinct de l'association", () => {
    expect(node["@type"]).toBe("WebSite");
    expect(node["@id"]).toBe(`${BASE}/#site`);
  });

  it("renvoie à l'association par son identité, sans la recopier", () => {
    // Recopier la description ferait deux nœuds à tenir à jour ; le renvoi par
    // `@id` n'en laisse qu'un.
    expect(node.publisher).toEqual({ "@id": `${BASE}/#organisation` });
  });

  it("annonce la langue du site", () => {
    expect(node.inLanguage).toBe("fr-FR");
  });
});

describe("breadcrumbJsonLd", () => {
  const node = breadcrumbJsonLd(BASE, [
    { name: "Accueil", path: "/" },
    { name: "Règles des tournois", path: "/regles" },
    { name: "Ronde suisse", path: "/regles/ronde-suisse" },
  ]);

  it("numérote les maillons à partir de 1, comme l'exige le protocole", () => {
    const items = node.itemListElement as { position: number; item: string }[];
    expect(items.map((entry) => entry.position)).toEqual([1, 2, 3]);
  });

  it("rend chaque maillon en URL absolue", () => {
    const items = node.itemListElement as { item: string }[];
    expect(items.map((entry) => entry.item)).toEqual([
      `${BASE}/`,
      `${BASE}/regles`,
      `${BASE}/regles/ronde-suisse`,
    ]);
  });

  it("accepte un fil vide sans produire de nœud bancal", () => {
    expect(breadcrumbJsonLd(BASE, []).itemListElement).toEqual([]);
  });
});

describe("serializeJsonLd", () => {
  it("rend un JSON relisible à l'identique", () => {
    const data = { "@type": "WebSite", name: "BlueGenji" };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });

  it("neutralise une balise fermante glissée dans un texte", () => {
    // La panne visée : une description éditée depuis l'interface qui contient
    // `</script>` fermerait la balise et rendrait exécutable ce qui suit.
    const serialized = serializeJsonLd({ description: "</script><img onerror=x>" });
    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    // Et pourtant le texte est intact une fois relu.
    expect(JSON.parse(serialized)).toEqual({ description: "</script><img onerror=x>" });
  });

  it("neutralise aussi l'esperluette, par laquelle on reconstruit une balise", () => {
    const serialized = serializeJsonLd({ description: "a &lt;b" });
    expect(serialized).not.toContain("&");
    expect(JSON.parse(serialized)).toEqual({ description: "a &lt;b" });
  });

  it("accepte une liste de nœuds, comme en pose l'accueil", () => {
    const parsed = JSON.parse(serializeJsonLd([organizationJsonLd(BASE, "x"), webSiteJsonLd(BASE, "y")]));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });
});
