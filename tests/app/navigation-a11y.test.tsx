import { afterEach, describe, expect, it, jest } from "@jest/globals";

let mockPathname: string | null = "/equipes/12";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { ARENA_NAV_LINKS, ArenaNav } from "@/components/arena-nav";
import { ToastProvider } from "@/components/ui/toast";
import {
  PUBLIC_NAV_LINKS,
  PublicNavMenu,
  PublicNavPanel,
  handleMenuEscape,
} from "@/components/cyber/landing/PublicNavMenu";
import { readSource } from "../helpers/read-source";

const arenaNav = (activeTeam: { teamId: number; teamName: string } | null = null) =>
  renderToStaticMarkup(
    <ToastProvider>
      <ArenaNav pseudo="Nova" avatarUrl={null} activeTeam={activeTeam} />
    </ToastProvider>,
  );

/** Les liens `<a>` du rendu qui portent `aria-current="page"`. */
const currentLinks = (html: string) =>
  [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);

describe("ArenaNav — page courante et pictogrammes", () => {
  afterEach(() => {
    mockPathname = "/equipes/12";
  });

  it("signale la section courante autrement que par le style", () => {
    expect(currentLinks(arenaNav())).toEqual(["Équipes"]);
  });

  it("n'annonce aucune page courante hors de ses sections", () => {
    mockPathname = "/profil";
    expect(arenaNav()).not.toContain("aria-current");
  });

  it("propose « Classement » aux connectés, page courante comprise", () => {
    expect(arenaNav()).toMatch(/<a [^>]*href="\/classement"[^>]*>Classement<\/a>/);
    mockPathname = "/classement";
    expect(currentLinks(arenaNav())).toEqual(["Classement"]);
  });

  it("donne à chaque section une teinte froide qui lui est propre", () => {
    const tints = ARENA_NAV_LINKS.map((link) => link.rgb);
    expect(new Set(tints).size).toBe(tints.length);
    for (const tint of tints) expect(tint).not.toMatch(/amber|orange|red|result-loss/);
  });

  it("ne déborde pas entre 721 et 1000 px : liens resserrés, repli plutôt que débordement", () => {
    const css = readSource("components/arena-nav.module.css");
    const block = css.slice(css.indexOf("@media (min-width: 721px) and (max-width: 1000px)"));
    expect(block).toMatch(/\.navLeft\s*\{[^}]*min-width:\s*0;[^}]*flex-wrap:\s*wrap;/);
    expect(block).toMatch(/\.navLink\s*\{[^}]*letter-spacing:\s*0\.08em;/);
    // Replié, le trait du lien actif ne barre pas la ligne suivante.
    expect(block).toMatch(/\.navLinkActive::after\s*\{\s*bottom:\s*-5px;/);
  });

  it("nomme sa navigation", () => {
    expect(arenaNav()).toContain('<nav class="nav" aria-label="Navigation principale" data-sticky-header="true">');
  });

  it("n'alourdit plus la barre de raccourcis « Accueil » / « Mon équipe »", () => {
    const html = arenaNav({ teamId: 3, teamName: "Les Ours" });
    // L'accueil passe par le logo, l'équipe par le menu du compte.
    expect(html).not.toContain("navHome");
    expect(html).not.toContain('href="/equipes/3"');
    expect(html.match(/<a [^>]*href="\/"/g)).toHaveLength(1);
    expect(html).toContain('<a class="navLogo" aria-label="Accueil" href="/">');
  });

  it("réduit les signalements à un drapeau nommé, compteur en pastille", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ArenaNav pseudo="Nova" avatarUrl={null} openReports={2} />
      </ToastProvider>,
    );
    expect(html).toContain('<a class="navTool navReports" href="/admin/signalements">');
    // Pas de `title` : il doublait le nom accessible à la lecture.
    expect(html).not.toContain('title="Signalements"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg><span class="navReportsLabel">Signalements<\/span>/);
    // Pastille muette, compte lu séparé du libellé (« Signalements, 2 à traiter »).
    expect(html).toContain('<span class="navBadge" aria-hidden="true">2</span><span class="sr-only">, 2 à traiter</span>');
  });

  it("marque la page des signalements comme courante", () => {
    mockPathname = "/admin/signalements";
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ArenaNav pseudo="Nova" avatarUrl={null} openReports={0} />
      </ToastProvider>,
    );
    expect(html).toContain('<a class="navTool navReports" aria-current="page" href="/admin/signalements">');
    const css = readSource("components/arena-nav.module.css");
    expect(css).toMatch(/\.navReports\[aria-current="page"\]\s*\{[^}]*border-color: var\(--amber\);/);
  });

  it("ne rend pas de groupe d'outils vide sur une route pas encore traduite", () => {
    // `/equipes/12` n'est pas traduite : le sélecteur serait muet, le filet orphelin.
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ArenaNav pseudo="Nova" avatarUrl={null} languageSwitcherLabel="lire cette page en anglais" />
      </ToastProvider>,
    );
    expect(html).not.toContain("navTools");
  });

  it("rend le sélecteur compact dans le groupe d'outils sur une route traduite", () => {
    mockPathname = "/tournois";
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ArenaNav pseudo="Nova" avatarUrl={null} languageSwitcherLabel="lire cette page en anglais" />
      </ToastProvider>,
    );
    expect(html).toMatch(/<div class="navTools"><a href="\/en\/tournois"[^>]*class="link navTool"/);
  });

  it("ne rend ni drapeau ni groupe d'outils sans permission de modération ni langue", () => {
    const html = arenaNav();
    expect(html).not.toContain("navReports");
    expect(html).not.toContain("navTools");
  });

  it("n'affiche pas de pastille quand rien n'attend", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ArenaNav pseudo="Nova" avatarUrl={null} openReports={0} />
      </ToastProvider>,
    );
    expect(html).toContain("navReports");
    expect(html).not.toContain("navBadge");
  });
});

describe("PublicNavMenu — bouton du menu", () => {
  it("n'annonce pas un menu ARIA qu'il n'est pas", () => {
    const html = renderToStaticMarkup(<PublicNavMenu />);
    expect(html).not.toContain("aria-haspopup");
    expect(html).toContain('aria-expanded="false"');
    // Fermé, le panneau n'existe pas : rien à désigner.
    expect(html).not.toContain("aria-controls");
  });

});

describe("PublicNavPanel — page courante", () => {
  const panel = (pathname: string | null) =>
    renderToStaticMarkup(<PublicNavPanel id="menu" pathname={pathname} onNavigate={() => undefined} />);

  it("signale la section courante, sous-pages comprises", () => {
    expect(currentLinks(panel("/recrutement/annonce"))).toEqual(["Recrutement"]);
    expect(currentLinks(panel("/bot"))).toEqual(["Bot"]);
  });

  it("ne désigne jamais une ancre de l'accueil, même sur l'accueil", () => {
    expect(currentLinks(panel("/"))).toEqual([]);
  });

  it("mène aux listes des tournois et des équipes, pas à des sections de l'accueil", () => {
    const html = panel("/");
    expect(html).toContain('href="/tournois"');
    expect(html).toContain('href="/equipes"');
    expect(html).not.toMatch(/href="\/#/);
  });

  it("signale les listes des tournois et des équipes comme page courante", () => {
    expect(currentLinks(panel("/tournois/42"))).toEqual(["Tournois"]);
    expect(currentLinks(panel("/equipes"))).toEqual(["Équipes"]);
  });

  it("porte l'identifiant que le bouton désigne", () => {
    expect(panel("/")).toContain('<nav id="menu"');
  });

  it("rend exactement les entrées de la liste, une par adresse", () => {
    const hrefs = [...panel("/").matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(PUBLIC_NAV_LINKS.map((l) => l.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("ne liste plus les règles des tournois, même sur une page de règles", () => {
    const html = panel("/regles/ronde-suisse");
    expect(html).not.toContain('href="/regles');
    expect(html).not.toContain("Règles");
    expect(currentLinks(html)).toEqual([]);
  });
});

describe("handleMenuEscape", () => {
  const inside = { id: "lien" } as unknown as Element;
  const outside = { id: "ailleurs" } as unknown as Element;
  const root = { contains: (node: Node | null) => node === (inside as unknown as Node) };

  function run(key: string, focused: Element | null) {
    const calls: string[] = [];
    const handled = handleMenuEscape(
      key,
      focused,
      root,
      { focus: () => calls.push("focus") },
      () => calls.push("close"),
    );
    return { handled, calls };
  }

  it("ferme et rend le focus au bouton quand il était dans le panneau", () => {
    expect(run("Escape", inside)).toEqual({ handled: true, calls: ["close", "focus"] });
  });

  it("ferme sans déplacer un focus qui était ailleurs", () => {
    expect(run("Escape", outside)).toEqual({ handled: true, calls: ["close"] });
    expect(run("Escape", null)).toEqual({ handled: true, calls: ["close"] });
  });

  it("ignore les autres touches", () => {
    expect(run("Enter", inside)).toEqual({ handled: false, calls: [] });
  });

  it("tolère des références pas encore montées", () => {
    expect(handleMenuEscape("Escape", inside, null, null, () => undefined)).toBe(true);
  });
});

describe("PublicHeader — menu du compte", () => {
  it("rend le même menu du compte que l'espace connecté", () => {
    const source = readSource("components/cyber/landing/PublicHeader.tsx");
    expect(source).toContain("<AccountMenu pseudo={user.pseudo}");
    expect(source).not.toContain('aria-label="Mon profil"');
  });
});
