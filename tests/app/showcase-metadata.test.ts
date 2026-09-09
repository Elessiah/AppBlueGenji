import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE_NAME } from "@/lib/shared/share-metadata";
import { TOURNAMENT_RULE_MODES } from "@/lib/shared/tournament-rules";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Ce que chaque page de la vitrine dit d'elle-même.
 *
 * Trois pannes sont tenues ici, toutes constatées en production :
 *
 * - l'accueil ne déclarait **aucune** métadonnée — donc un titre réduit au nom
 *   du site, et surtout pas d'URL canonique sur la page qui en a le plus besoin ;
 * - `/connexion` non plus, si bien qu'elle portait le titre *et* la description
 *   de l'accueil : deux pages qui se disputent la même requête ;
 * - les descriptions écrites en dur avaient dérivé du contenu, lui éditable
 *   depuis l'interface : l'association annonçait un jeu que sa page ne mentionne
 *   plus, et `/regles` ne citait que quatre des six modes publiés.
 *
 * La longueur est vérifiée parce qu'elle décide de ce qui est *lu* : au-delà de
 * ~160 caractères, le moteur coupe lui-même, et la coupe tombe où elle veut.
 */
const DESCRIPTION_MAX = 165;

describe("accueil", () => {
  it("déclare un titre qui dit ce qu'on y trouve, et une URL canonique", async () => {
    const { metadata } = await import("@/app/page");

    // Le gabarit de la racine ne s'applique **pas** à la page qui partage son
    // segment : sans titre écrit en entier, l'accueil serait la seule page du
    // site à ne pas porter le nom du site.
    expect(metadata.title).toEqual({
      absolute: `Tournois esport amateurs Overwatch · ${SITE_NAME}`,
    });
    expect(metadata.alternates?.canonical).toBe("/");
  });

  it("porte un encart complet, que la racine ne fusionne pas", async () => {
    const { metadata } = await import("@/app/page");
    expect(metadata.openGraph).toMatchObject({ siteName: SITE_NAME, locale: "fr_FR" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("pose les données structurées de l'association et du site", () => {
    const source = read("app/page.tsx");
    expect(source).toContain("organizationJsonLd");
    expect(source).toContain("webSiteJsonLd");
  });
});

describe("connexion", () => {
  it("ne se dispute plus le titre de l'accueil", async () => {
    const { metadata } = await import("@/app/connexion/layout");
    expect(metadata.title).toBe("Connexion");
  });

  it("est retirée de l'index, mais laisse suivre ses liens", async () => {
    const { metadata } = await import("@/app/connexion/layout");
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("ramène ses variantes `?redirect=` à une seule adresse", async () => {
    const { metadata } = await import("@/app/connexion/layout");
    expect(metadata.alternates?.canonical).toBe("/connexion");
  });
});

describe("association", () => {
  it("décrit ce que la page dit vraiment, sans le jeu qu'elle ne mentionne plus", async () => {
    const { metadata } = await import("@/app/association/page");
    const description = String(metadata.description);

    expect(description).toContain("loi 1901");
    expect(description).toContain("LAN");
    expect(description).not.toContain("Marvel Rivals");
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("rattache la page au même nœud d'association que l'accueil", () => {
    expect(read("app/association/page.tsx")).toContain("organizationJsonLd");
  });
});

describe("règles", () => {
  it("annonce les six modes publiés, et pas seulement quatre", async () => {
    const { metadata } = await import("@/app/regles/page");
    const description = String(metadata.description);

    expect(description).toContain("BlueGenji Survie");
    expect(description).toContain("multi-phases");
    expect(description).toContain("ronde suisse");
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("donne à chaque mode son titre, sa description et son adresse canonique", async () => {
    const { generateMetadata } = await import("@/app/regles/[slug]/page");

    for (const mode of TOURNAMENT_RULE_MODES) {
      const metadata = await generateMetadata({ params: Promise.resolve({ slug: mode.slug }) });
      expect(metadata.title).toBe(`Règles : ${mode.label}`);
      expect(metadata.description).toBe(mode.tagline);
      expect(metadata.alternates?.canonical).toBe(`/regles/${mode.slug}`);
    }
  });

  it("pose un fil d'Ariane sur la page d'un mode", () => {
    expect(read("app/regles/[slug]/page.tsx")).toContain("breadcrumbJsonLd");
  });
});
