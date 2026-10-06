import { describe, expect, it } from "@jest/globals";
import { pageMetadata, shareCardAlt } from "@/lib/shared/page-metadata";
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

describe("pageMetadata — texte de remplacement de la carte", () => {
  const base = { title: "Classement", description: "…", path: "/classement", shareCard: "ranking" };

  it("dit par défaut ce que la carte montre : son titre, pas celui de l'encart", () => {
    const built = pageMetadata(base);
    expect(built.openGraph?.images).toEqual([
      expect.objectContaining({ url: "/og/fr/ranking.png", alt: `Classement des équipes · ${SITE_NAME}` }),
    ]);
  });

  it("écrit ce titre dans la langue de la page, mode de règles compris", () => {
    expect(shareCardAlt("association", "fr")).toBe(`Une association par et pour les joueurs · ${SITE_NAME}`);
    expect(shareCardAlt("ranking", "en")).toBe(`Team ranking · ${SITE_NAME}`);
    expect(shareCardAlt("rules-bluegenji-survie", "en")).toBe(`BlueGenji's Survival · ${SITE_NAME}`);
    expect(shareCardAlt("home", "fr")).toBe(SITE_NAME);
    expect(shareCardAlt("nope", "fr")).toBeNull();
  });

  it("retombe sur le titre de l'encart pour une clé inconnue", () => {
    const built = pageMetadata({ ...base, shareCard: "nope" });
    expect(built.openGraph?.images).toEqual([expect.objectContaining({ alt: `Classement · ${SITE_NAME}` })]);
  });

  it("prend le texte fourni quand la carte montre autre chose (podium)", () => {
    const built = pageMetadata({ ...base, locale: "en", shareImageAlt: "The BlueGenji podium" });
    expect(built.openGraph?.images).toEqual([
      expect.objectContaining({ url: "/og/en/ranking.png", alt: "The BlueGenji podium" }),
    ]);
  });

  it("ignore le texte fourni sans carte propre (carte du site)", () => {
    const { shareCard: _omit, ...noCard } = base;
    const built = pageMetadata({ ...noCard, shareImageAlt: "Ignoré" });
    expect(built.openGraph?.images).toEqual([expect.objectContaining({ alt: SITE_NAME })]);
  });
});
