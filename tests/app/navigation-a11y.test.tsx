import { afterEach, describe, expect, it, jest } from "@jest/globals";

let mockPathname: string | null = "/equipes/12";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

import { renderToStaticMarkup } from "react-dom/server";
import { ArenaNav } from "@/components/arena-nav";
import { PublicNavMenu } from "@/components/cyber/landing/PublicNavMenu";
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

  it("signale la page courante dans le panneau et rend le focus au bouton sur Échap", () => {
    const source = readSource("components/cyber/landing/PublicNavMenu.tsx");
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
    expect(source).toContain("isNavLinkActive(pathname, link.href)");
    expect(source).toContain("buttonRef.current?.focus()");
  });
});

describe("PublicHeader — lien du profil", () => {
  it("fait commencer son nom accessible par le pseudo affiché (WCAG 2.5.3)", () => {
    const source = readSource("components/cyber/landing/PublicHeader.tsx");
    expect(source).toContain("aria-label={`${user.pseudo}, mon profil`}");
    expect(source).not.toContain('aria-label="Mon profil"');
  });
});
