import { afterEach, describe, expect, it, jest } from "@jest/globals";

let mockPathname: string | null = "/equipes/12";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

import { renderToStaticMarkup } from "react-dom/server";
import { ArenaNav } from "@/components/arena-nav";
import {
  PublicNavMenu,
  PublicNavPanel,
  handleMenuEscape,
} from "@/components/cyber/landing/PublicNavMenu";
import { readSource } from "../helpers/read-source";

const arenaNav = (activeTeam: { teamId: number; teamName: string } | null = null) =>
  renderToStaticMarkup(<ArenaNav pseudo="Nova" avatarUrl={null} activeTeam={activeTeam} />);

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

  it("n'annonce aucune page courante hors de ses trois sections", () => {
    mockPathname = "/profil";
    expect(arenaNav()).not.toContain("aria-current");
  });

  it("nomme sa navigation", () => {
    expect(arenaNav()).toContain('<nav class="nav" aria-label="Navigation principale">');
  });

  it("masque les pictogrammes aux technologies d'assistance", () => {
    const html = arenaNav({ teamId: 3, teamName: "Les Ours" });
    expect(html).toContain('<span aria-hidden="true">⌂</span> Accueil');
    expect(html).toContain('<span aria-hidden="true">🛡</span> Mon équipe');
    // Le nom accessible du lien d'équipe commence par son texte visible (2.5.3).
    expect(html).toContain('aria-label="Mon équipe : Les Ours"');
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
    expect(currentLinks(panel("/regles/ronde-suisse"))).toEqual(["Règles des tournois"]);
    expect(currentLinks(panel("/bot"))).toEqual(["Bot"]);
  });

  it("ne désigne jamais une ancre de l'accueil, même sur l'accueil", () => {
    expect(currentLinks(panel("/"))).toEqual([]);
  });

  it("porte l'identifiant que le bouton désigne", () => {
    expect(panel("/")).toContain('<nav id="menu"');
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

describe("PublicHeader — lien du profil", () => {
  it("fait commencer son nom accessible par le pseudo affiché (WCAG 2.5.3)", () => {
    const source = readSource("components/cyber/landing/PublicHeader.tsx");
    expect(source).toContain("aria-label={`${user.pseudo}, mon profil`}");
    expect(source).not.toContain('aria-label="Mon profil"');
  });
});
