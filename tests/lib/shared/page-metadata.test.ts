import { describe, expect, it } from "@jest/globals";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { SITE_NAME } from "@/lib/shared/share-metadata";

/**
 * Le socle d'une page de la vitrine.
 *
 * Ce qui est vérifié ici n'est pas la forme d'un objet `Metadata` mais la
 * panne qu'il ferme : `openGraph` n'étant **pas** fusionné avec celui de la
 * racine, une page qui en déclare un remplace le bloc entier. Chaque page en
 * écrivait donc une version amputée — sans nom de site, sans image, sans carte
 * Twitter. Le socle doit être complet à chaque appel.
 */

describe("pageMetadata", () => {
  const built = pageMetadata({
    title: "Règles des tournois",
    description: "Comment se joue un tournoi BlueGenji.",
    path: "/regles",
  });

  it("laisse le nom du site au gabarit de la racine", () => {
    // Les pages recopiaient « BlueGenji - » dans leur titre, ce qui donnerait
    // « BlueGenji - Règles · BlueGenji Esport » une fois le gabarit appliqué.
    expect(built.title).toBe("Règles des tournois");
    expect(String(built.title)).not.toContain(SITE_NAME);
  });

  it("écrit le nom du site dans l'encart, lui qui n'hérite d'aucun gabarit", () => {
    expect(built.openGraph?.title).toBe(`Règles des tournois · ${SITE_NAME}`);
    expect(built.twitter?.title).toBe(`Règles des tournois · ${SITE_NAME}`);
  });

  it("porte toujours un encart complet : type, site, langue, URL et image", () => {
    expect(built.openGraph).toMatchObject({
      type: "website",
      siteName: SITE_NAME,
      locale: "fr_FR",
      url: "/regles",
    });
    expect(built.openGraph?.images).toEqual([
      { url: "/opengraph-image", width: 1200, height: 630, alt: SITE_NAME },
    ]);
    expect(built.twitter).toMatchObject({ card: "summary_large_image" });
    expect(built.twitter?.images).toEqual(["/opengraph-image"]);
  });

  it("déclare l'URL canonique de la page", () => {
    expect(built.alternates?.canonical).toBe("/regles");
  });

  it("reprend la description de référencement dans l'encart, par défaut", () => {
    expect(built.description).toBe("Comment se joue un tournoi BlueGenji.");
    expect(built.openGraph?.description).toBe("Comment se joue un tournoi BlueGenji.");
  });

  it("accepte une formulation propre à l'encart, sans toucher au référencement", () => {
    const withShare = pageMetadata({
      title: "Mentions légales",
      description: "Mentions légales de la plateforme, éditée par l'association (loi 1901).",
      shareDescription: "Éditeur, hébergement et données personnelles.",
      path: "/mentions-legales",
    });

    expect(withShare.description).toContain("loi 1901");
    expect(withShare.openGraph?.description).toBe("Éditeur, hébergement et données personnelles.");
    expect(withShare.twitter?.description).toBe("Éditeur, hébergement et données personnelles.");
  });
});

/**
 * Le drapeau `selfTitled` ferme une panne propre à Next : le gabarit de titre
 * déclaré dans une mise en page ne s'applique qu'à ses **segments enfants**, et
 * la page qui partage son segment — l'accueil — ne le reçoit pas. Elle était
 * donc la seule page du site dont le `<title>` ne portait pas le nom du site.
 */
describe("pageMetadata — titre de la page racine", () => {
  it("laisse le gabarit faire son travail par défaut", () => {
    const built = pageMetadata({ title: "Bénévoles", description: "…", path: "/benevoles" });
    expect(built.title).toBe("Bénévoles");
  });

  it("écrit le nom du site quand le gabarit ne s'appliquera pas", () => {
    const built = pageMetadata({
      title: "Tournois esport amateurs Overwatch",
      description: "…",
      path: "/",
      selfTitled: true,
    });
    expect(built.title).toEqual({
      absolute: `Tournois esport amateurs Overwatch · ${SITE_NAME}`,
    });
  });

  it("écrit le même titre dans la page et dans l'encart", () => {
    const built = pageMetadata({ title: "Accueil", description: "…", path: "/", selfTitled: true });
    expect(built.title).toEqual({ absolute: built.openGraph?.title });
  });
});
