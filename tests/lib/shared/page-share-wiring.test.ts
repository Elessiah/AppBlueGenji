/**
 * Chaque page désigne **sa** carte, dans **sa** langue
 * (`docs/features/SHARE_METADATA.md` § « Une carte par page »).
 */
import { describe, expect, it } from "@jest/globals";
import { memberAreaShareMetadata, pageMetadata, shareImageFor } from "@/lib/shared/page-metadata";
import { allShareCardKeys } from "@/lib/shared/page-share-cards";
import { SITE_NAME } from "@/lib/shared/share-metadata";
import { readSource } from "../../helpers/read-source";

const PAGES: [string, string][] = [
  ["app/page.tsx", "home"],
  ["app/association/page.tsx", "association"],
  ["app/benevoles/page.tsx", "volunteers"],
  ["app/bot/page.tsx", "bot"],
  ["app/bot/docs/[[...slug]]/page.tsx", "botDocs"],
  ["app/classement/page.tsx", "ranking"],
  ["app/conditions-utilisation/page.tsx", "terms"],
  ["app/connexion/layout.tsx", "login"],
  ["app/mentions-legales/page.tsx", "legalNotice"],
  ["app/privacy-policy-bot/page.tsx", "botPrivacy"],
  ["app/recrutement/page.tsx", "recruitment"],
  ["app/rgpd/page.tsx", "privacy"],
  ["app/rgpd/registre/page.tsx", "processingRegister"],
  ["app/terms-of-service-bot/page.tsx", "botTerms"],
  ["app/accessibilite/page.tsx", "accessibility"],
  ["app/regles/page.tsx", "rules"],
];

const MEMBER_AREA: [string, string][] = [
  ["app/(secured)/tournois/layout.tsx", "tournaments"],
  ["app/(secured)/equipes/layout.tsx", "teams"],
  ["app/(secured)/equipes/[id]/layout.tsx", "team"],
  ["app/(secured)/joueurs/layout.tsx", "players"],
  ["app/(secured)/joueurs/[id]/layout.tsx", "player"],
];

describe("pageMetadata({ shareCard })", () => {
  it("désigne la carte de la page dans la langue de la page", () => {
    const fr = pageMetadata({ title: "Classement", description: "…", path: "/classement", shareCard: "ranking" });
    const en = pageMetadata({ title: "Ranking", description: "…", path: "/classement", shareCard: "ranking", locale: "en" });
    expect(fr.openGraph?.images).toEqual([
      { url: "/og/fr/ranking.png", width: 1200, height: 630, alt: `Classement des équipes · ${SITE_NAME}` },
    ]);
    expect(fr.twitter?.images).toEqual(["/og/fr/ranking.png"]);
    expect(en.openGraph?.images).toEqual([{ url: "/og/en/ranking.png", width: 1200, height: 630, alt: `Team ranking · ${SITE_NAME}` }]);
    expect(en.twitter?.images).toEqual(["/og/en/ranking.png"]);
  });

  it("garde la carte du site sans carte propre", () => {
    expect(shareImageFor(undefined, "en")).toBe("/opengraph-image");
  });
});

describe("câblage des pages", () => {
  it.each(PAGES)("%s pose la carte %s", (file, key) => {
    expect(allShareCardKeys()).toContain(key);
    expect(readSource(file)).toContain(`shareCard: "${key}"`);
  });

  it("chaque mode de règles pose sa propre carte", () => {
    expect(readSource("app/regles/[slug]/page.tsx")).toContain("shareCard: ruleModeShareCardKey(mode.slug)");
  });

  it.each(MEMBER_AREA)("%s pose l'encart générique %s", (file, key) => {
    expect(readSource(file)).toMatch(new RegExp(`memberAreaShareMetadata\\("${key}"[,)]`));
  });
});

describe("memberAreaShareMetadata", () => {
  it.each(["team", "player"] as const)("la fiche %s n'annonce que la rubrique, sans adresse", (key) => {
    const metadata = memberAreaShareMetadata(key);
    const openGraph = metadata.openGraph as { url?: unknown; title?: unknown; images?: unknown };
    expect(openGraph.url).toBeUndefined();
    expect(openGraph.title).toBe(key === "team" ? `Fiche d'équipe · ${SITE_NAME}` : `Fiche de joueur · ${SITE_NAME}`);
    expect(openGraph.images).toEqual([
      { url: `/og/fr/${key}.png`, width: 1200, height: 630, alt: openGraph.title },
    ]);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: [`/og/fr/${key}.png`] });
  });
});

describe("og:image:alt des cartes qui ne montrent pas le titre de l'encart", () => {
  it("le classement décrit le podium comme son repli", () => {
    expect(readSource("app/classement/page.tsx")).toContain("shareImageAlt: messages.share.podium.alt");
  });

  it("une section de la documentation du bot ne nomme pas la section", () => {
    const section = pageMetadata({
      title: "Guide — Documentation du bot",
      description: "…",
      path: "/bot/docs/guide",
      shareCard: "botDocs",
    });
    expect(section.openGraph?.images).toEqual([expect.objectContaining({ alt: `Documentation du bot · ${SITE_NAME}` })]);
  });
});

describe("fiche d'équipe : image nominative, texte générique", () => {
  it("la mise en page désigne la carte team-<id> sans lire la base pour elle", () => {
    const source = readSource("app/(secured)/equipes/[id]/layout.tsx");
    expect(source).toContain('memberAreaShareMetadata("team", teamShareCardKey(teamId))');
    expect(source).not.toContain("loadShareTeam");
  });

  it("l'encart garde le texte générique, seule l'image change", () => {
    const metadata = memberAreaShareMetadata("team", "team-42");
    const openGraph = metadata.openGraph as { title?: unknown; images?: unknown };
    expect(openGraph.title).toBe(`Fiche d'équipe · ${SITE_NAME}`);
    expect(openGraph.images).toEqual([
      { url: "/og/fr/team-42.png", width: 1200, height: 630, alt: `Fiche d'équipe · ${SITE_NAME}` },
    ]);
    expect(metadata.twitter).toMatchObject({ images: ["/og/fr/team-42.png"] });
  });

  it("la fiche d'un joueur reste générique", () => {
    expect(readSource("app/(secured)/joueurs/[id]/layout.tsx")).toContain('memberAreaShareMetadata("player")');
    expect(readSource("app/(secured)/joueurs/[id]/layout.tsx")).not.toContain("ShareCardKey(");
  });
});
