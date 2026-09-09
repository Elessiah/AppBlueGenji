/**
 * Ce que le site dit de lui-même aux moteurs, en `schema.org`.
 *
 * Les métadonnées de partage (`share-metadata.ts`) rédigent pour un **humain**
 * qui verra un encart ; celles-ci décrivent pour une **machine** qui range. Un
 * moteur qui lit « BlueGenji Esport » dans un `<title>` ne sait pas s'il a
 * affaire à une association, à un tournoi ou à une marque de vêtements — ces
 * nœuds le lui disent, et c'est ce qui permet à une recherche sur le nom de
 * l'association de rendre autre chose qu'un lien bleu.
 *
 * Module pur : il rend des objets, jamais du HTML ni des balises. C'est
 * `components/seo/JsonLd.tsx` qui les pose dans la page, et
 * {@link serializeJsonLd} qui les met en forme — la sérialisation étant la
 * partie qui peut casser la page, elle se teste.
 *
 * Les identités (`@id`) sont **stables et absolues** : c'est ce qui permet à la
 * page d'accueil et à la page association de parler de la *même* association au
 * lieu d'en déclarer deux.
 */

/** Raison sociale telle qu'elle figure aux mentions légales. */
export const ORGANIZATION_LEGAL_NAME = "Bluegenji Esport";

/** Nom d'usage, celui qu'on lit partout sur le site. */
export const ORGANIZATION_NAME = "BlueGenji Esport";

/** Siège social, repris des mentions légales. */
export const ORGANIZATION_ADDRESS = {
  streetAddress: "4 impasse des Cyprès",
  postalCode: "51210",
  addressLocality: "Janvilliers",
  addressCountry: "FR",
} as const;

/** Année de création, telle qu'affichée sur la page association. */
export const ORGANIZATION_FOUNDING_YEAR = "2020";

/** Le seul lien public de l'association, hors site. */
export const ORGANIZATION_DISCORD_URL = "https://discord.gg/bluegenji";

/** Un objet JSON-LD : une valeur sérialisable, rien de plus précis. */
export type JsonLdNode = Record<string, unknown>;

/** Retire la barre oblique finale d'une racine, pour ne jamais écrire `//`. */
function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * L'association elle-même.
 *
 * `SportsOrganization` plutôt qu'`Organization` tout court : c'est le type que
 * `schema.org` réserve aux structures dont l'activité *est* la compétition, et
 * il hérite de tout ce qu'`Organization` sait dire (adresse, fondation, liens).
 */
export function organizationJsonLd(baseUrl: string, description: string): JsonLdNode {
  const base = normalizeBase(baseUrl);

  return {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    "@id": `${base}/#organisation`,
    name: ORGANIZATION_NAME,
    legalName: ORGANIZATION_LEGAL_NAME,
    url: `${base}/`,
    logo: `${base}/logo_bg.webp`,
    image: `${base}/opengraph-image`,
    description,
    foundingDate: ORGANIZATION_FOUNDING_YEAR,
    // « Association loi 1901 » n'a pas de type `schema.org` : le champ libre est
    // le seul endroit où le statut juridique peut être dit à une machine.
    additionalType: "https://www.wikidata.org/wiki/Q2495883",
    address: { "@type": "PostalAddress", ...ORGANIZATION_ADDRESS },
    areaServed: "FR",
    sameAs: [ORGANIZATION_DISCORD_URL],
  };
}

/**
 * Le site, distinct de l'association qui l'édite.
 *
 * Les deux nœuds sont séparés parce qu'ils ne désignent pas la même chose : on
 * peut fermer un site sans dissoudre une association. `publisher` fait le lien,
 * par l'identité stable du nœud précédent — d'où l'`@id` plutôt qu'une seconde
 * description recopiée.
 */
export function webSiteJsonLd(baseUrl: string, description: string): JsonLdNode {
  const base = normalizeBase(baseUrl);

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}/#site`,
    name: ORGANIZATION_NAME,
    url: `${base}/`,
    description,
    inLanguage: "fr-FR",
    publisher: { "@id": `${base}/#organisation` },
  };
}

/** Un maillon du fil d'Ariane : ce qu'on lit, et où il mène. */
export type BreadcrumbItem = { name: string; path: string };

/**
 * Le fil d'Ariane d'une page profonde.
 *
 * C'est ce qui remplace, dans un résultat de recherche, l'URL brute par le
 * chemin lisible « bluegenji-esport.fr › Règles › Ronde suisse ». Sans lui, une
 * page de règles s'annonce par son adresse, qui ne dit pas d'où elle vient.
 */
export function breadcrumbJsonLd(baseUrl: string, items: BreadcrumbItem[]): JsonLdNode {
  const base = normalizeBase(baseUrl);

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${base}${item.path}`,
    })),
  };
}

/**
 * Met un ou plusieurs nœuds en forme pour un `<script type="application/ld+json">`.
 *
 * `JSON.stringify` n'échappe **pas** `<` : un texte contenant `</script>` — une
 * description de tournoi, un nom d'équipe, un texte de vitrine édité depuis
 * l'interface — fermerait la balise et rendrait exécutable tout ce qui suit.
 * Les trois caractères qui permettent de sortir d'un `<script>` sont donc
 * réécrits en séquences d'échappement Unicode : le JSON reste strictement
 * équivalent (un décodeur les relit à l'identique), mais plus rien n'y ressemble
 * à du balisage.
 */
export function serializeJsonLd(data: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
