import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { GetiSpotlight } from "@/components/cyber/landing/GetiSpotlight";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { messagesFor } from "@/lib/server/i18n-messages";
import { LANDING_CLIENT_NAMESPACES } from "@/lib/shared/landing-text";
import { readSource } from "../helpers/read-source";

/**
 * Encart « Annonces GETI » de l'accueil (GETI-NAV,
 * `docs/features/GETI_INFO.md` § Navigation).
 */
const french = () => renderToStaticMarkup(<GetiSpotlight />);
const english = () =>
  renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <GetiSpotlight locale="en" />
    </AppLocaleProvider>,
  );

/** Adresse et texte de chaque lien, dans l'ordre du rendu. */
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: m[1], label: m[2] }));

describe("GetiSpotlight — encart de l'accueil", () => {
  it("mène à la page des annonces puis à ses six catégories, en français", () => {
    expect(links(french())).toEqual([
      { href: "/geti-info", label: "Voir les annonces GETI" },
      { href: "/geti-info/lfp", label: "Un joueur" },
      { href: "/geti-info/lft", label: "Une équipe" },
      { href: "/geti-info/lfsub", label: "Un remplaçant" },
      { href: "/geti-info/lfstaff", label: "Un staff" },
      { href: "/geti-info/lfs", label: "Un scrim" },
      { href: "/geti-info/lfcast", label: "Un cast" },
    ]);
  });

  it("mène aux adresses /en avec des libellés anglais", () => {
    expect(links(english())).toEqual([
      { href: "/en/geti-info", label: "Browse GETI posts" },
      { href: "/en/geti-info/lfp", label: "A player" },
      { href: "/en/geti-info/lft", label: "A team" },
      { href: "/en/geti-info/lfsub", label: "A sub" },
      { href: "/en/geti-info/lfstaff", label: "Staff" },
      { href: "/en/geti-info/lfs", label: "A scrim" },
      { href: "/en/geti-info/lfcast", label: "A cast" },
    ]);
  });

  it("ne laisse aucun texte français dans le rendu anglais", () => {
    const html = english();
    expect(html).toContain("GETI posts are here.");
    expect(html).not.toMatch(/Annonces|Je cherche|joueur|équipe|remplaçant/i);
  });

  it("titre la section et nomme la liste des catégories", () => {
    const html = french();
    expect(html).toMatch(/<section [^>]*aria-labelledby="geti-spotlight-title"/);
    expect(html).toMatch(
      /<h2 id="geti-spotlight-title"[^>]*>Un joueur, une équipe, un scrim \? <span[^>]*>Les annonces GETI sont ici\.<\/span><\/h2>/,
    );
    expect(html).toMatch(/<p id="geti-spotlight-categories"[^>]*>Je cherche<\/p>/);
    expect(html).toMatch(/<ul [^>]*aria-labelledby="geti-spotlight-categories"/);
  });

  it("donne à chaque lien un texte visible distinct", () => {
    const labels = links(french()).map((l) => l.label);
    expect(new Set(labels).size).toBe(7);
  });
});

describe("textes de l'encart GETI", () => {
  it("porte les mêmes clés en français et en anglais", () => {
    const fr = messagesFor("fr").landing.geti;
    const en = messagesFor("en").landing.geti;
    expect(Object.keys(en)).toEqual(Object.keys(fr));
    expect(Object.keys(en.categories)).toEqual(["lfp", "lft", "lfsub", "lfstaff", "lfs", "lfcast"]);
  });

  it("reste côté serveur : l'espace geti ne voyage pas jusqu'au navigateur", () => {
    expect(LANDING_CLIENT_NAMESPACES).not.toContain("geti");
  });
});

describe("accueil — place de l'encart GETI", () => {
  it("le rend juste après le bandeau défilant, avant le tableau des tournois", () => {
    const page = readSource("app/page.tsx");
    const ticker = page.indexOf("<LandingTicker");
    const spotlight = page.indexOf("<GetiSpotlight locale={locale} />");
    const board = page.indexOf("<TournamentBoard");
    expect(ticker).toBeGreaterThan(-1);
    expect(spotlight).toBeGreaterThan(ticker);
    expect(board).toBeGreaterThan(spotlight);
  });
});
