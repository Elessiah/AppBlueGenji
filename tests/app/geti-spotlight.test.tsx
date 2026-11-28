import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { GetiSpotlight } from "@/components/cyber/landing/GetiSpotlight";
import { PUBLIC_NAV_LINKS } from "@/components/cyber/landing/PublicNavMenu";
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
  it("getiSpotlight_french_ctaTargetsCanonicalCategory : le bouton vise l'adresse canonique de la catégorie par défaut", () => {
    expect(links(french())[0]).toEqual({ href: "/geti-info/lfs", label: "Voir les annonces GETI" });
  });

  it("getiSpotlight_french_chipsNameListContent : les raccourcis disent ce que chaque liste contient", () => {
    expect(links(french()).slice(1)).toEqual([
      { href: "/geti-info/lfs", label: "Scrims" },
      { href: "/geti-info/lfp", label: "Équipes qui recrutent" },
      { href: "/geti-info/lft", label: "Joueurs sans équipe" },
      { href: "/geti-info/lfsub", label: "Remplaçants recherchés" },
      { href: "/geti-info/lfstaff", label: "Staff" },
      { href: "/geti-info/lfcast", label: "Casts" },
    ]);
    expect(french()).toMatch(/<p id="geti-spotlight-categories"[^>]*>Parcourir<\/p>/);
  });

  it("getiSpotlight_english_chipsAndCtaUnderEn : adresses /en et libellés anglais", () => {
    expect(links(english())).toEqual([
      { href: "/en/geti-info/lfs", label: "Browse GETI posts" },
      { href: "/en/geti-info/lfs", label: "Scrims" },
      { href: "/en/geti-info/lfp", label: "Teams recruiting" },
      { href: "/en/geti-info/lft", label: "Free agents" },
      { href: "/en/geti-info/lfsub", label: "Subs wanted" },
      { href: "/en/geti-info/lfstaff", label: "Staff" },
      { href: "/en/geti-info/lfcast", label: "Casts" },
    ]);
  });

  it("getiSpotlight_ctaAndFirstChip_shareOneAddress : aucune liste sous deux adresses", () => {
    const html = french();
    expect(html).not.toContain('href="/geti-info"');
    const [cta, firstChip] = links(html);
    expect(cta.href).toBe(firstChip.href);
  });

  it("menuAndSpotlight_sameList_shareOneAddress : le menu et le bouton de l'accueil mènent à la même adresse", () => {
    const [cta] = links(french());
    expect(cta.href).toBe(PUBLIC_NAV_LINKS[0].href);
  });

  it("getiSpotlight_lede_hasInfoHintWithHowTo : la marche à suivre est derrière le « i »", () => {
    const html = french();
    expect(html).toMatch(/<p [^>]*>Équipes, joueurs, scrims, staff, casts : tout le réseau GETI sur une page\.<\/p>/);
    expect(html).toMatch(/<button [^>]*aria-controls="geti-spotlight-hint"[^>]*aria-label="Plus d&#x27;infos : Annonces GETI"|<button [^>]*aria-label="Plus d&#x27;infos : Annonces GETI"[^>]*aria-controls="geti-spotlight-hint"/);
    expect(html).toMatch(/id="geti-spotlight-hint"[^>]*hidden[^>]*>[^<]*Les annonces Overwatch publiées sur les serveurs du réseau GETI\. Filtre par rôle, rang et disponibilités, puis contacte l&#x27;auteur de l&#x27;annonce sur Discord\./);
  });

  it("getiSpotlight_english_infoHint : le « i » parle anglais sous /en", () => {
    const html = english();
    expect(html).toContain("GETI posts");
    expect(html).toContain("Teams, players, scrims, staff, casts: the whole GETI network on one page.");
    expect(html).toContain("The Overwatch posts published on the GETI network servers. Filter by role, rank and availability, then contact the post&#x27;s author on Discord.");
  });

  it("ne laisse aucun texte français dans le rendu anglais", () => {
    const html = english();
    expect(html).toContain("GETI posts are here.");
    expect(html).not.toMatch(/Annonces|Parcourir|joueur|équipe|remplaçant|Plus d/i);
  });

  it("titre la section et nomme la liste des catégories", () => {
    const html = french();
    expect(html).toMatch(/<section [^>]*aria-labelledby="geti-spotlight-title"/);
    expect(html).toMatch(
      /<h2 id="geti-spotlight-title"[^>]*>Un joueur, une équipe, un scrim \? <span[^>]*>Les annonces GETI sont ici\.<\/span><\/h2>/,
    );
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

describe("encart GETI — cibles tactiles", () => {
  const css = readSource("components/cyber/landing/GetiSpotlight.module.css");
  const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];

  it("garde à chaque raccourci de catégorie une hauteur d'au moins 44 px", () => {
    expect(rule(".category")).toContain("min-height: 44px;");
  });

  it("garde au bouton principal une hauteur d'au moins 44 px", () => {
    expect(rule(".cta")).toContain("min-height: 44px;");
  });

  it("n'ajoute pas de marge au paragraphe d'appel : l'écart vient de son enveloppe", () => {
    expect(rule(".lede")).toContain("margin: 0;");
    expect(rule(".ledeRow")).toContain("margin: 18px 0 0;");
  });
});
