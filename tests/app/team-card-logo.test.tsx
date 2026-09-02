import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamCard } from "@/app/(secured)/equipes/cards/TeamCard";
import type { TeamListItem } from "@/lib/shared/types";

/**
 * Le logo d'une équipe s'affiche dans l'annuaire `/equipes`, pas seulement sur
 * sa fiche.
 *
 * La régression était silencieuse de bout en bout : `listTeams` sélectionnait
 * bien `t.logo_url`, `TeamListItem` portait bien `logoUrl`, l'API le renvoyait
 * — mais `TeamCard` n'affichait que l'initiale du nom. Rien ne cassait, il
 * manquait seulement un rendu. D'où deux gardes complémentaires :
 *
 * 1. la carte **rend** le logo quand il y en a un (et pas l'initiale à sa
 *    place) ;
 * 2. elle **retombe** sur l'initiale quand il n'y en a pas — un repli inventé
 *    (une image absente du dépôt, par exemple) donnerait un 404 visible.
 *
 * Le lien principal de la carte reste une plaque posée par-dessus : le logo est
 * une décoration à l'intérieur de la carte, jamais une seconde ancre.
 */

const ISO = "2026-01-15T10:00:00.000Z";

function team(overrides: Partial<TeamListItem> = {}): TeamListItem {
  return {
    id: 12,
    name: "Dragon Squad",
    logoUrl: null,
    membersCount: 5,
    createdAt: ISO,
    rank: 4,
    points: 21,
    wins: 6,
    losses: 3,
    form: ["w", "l", "w"],
    games: ["OW2"],
    rosterPreview: [{ userId: 1, pseudo: "Kite", avatarUrl: null }],
    region: "FR",
    isGhost: false,
    ...overrides,
  };
}

/** Balises `<img>` du markup, avec leurs attributs bruts. */
function imgTags(markup: string): string[] {
  return markup.match(/<img\b[^>]*>/g) ?? [];
}

/** Retire les commentaires de la feuille : ils citent des sélecteurs en prose. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("TeamCard — logo d'équipe dans l'annuaire", () => {
  it("rend le logo de l'équipe quand elle en a un", () => {
    const markup = renderToStaticMarkup(
      <TeamCard team={team({ logoUrl: "/api/uploads/team-logos/12.webp" })} />,
    );

    const logo = imgTags(markup).find((tag) => tag.includes("/api/uploads/team-logos/12.webp"));
    expect(logo).toBeDefined();
  });

  it("accepte une URL de logo externe (les équipes du jeu de test en ont)", () => {
    const markup = renderToStaticMarkup(
      <TeamCard team={team({ logoUrl: "https://placehold.co/128x128" })} />,
    );

    expect(markup).toContain("https://placehold.co/128x128");
  });

  it("n'affiche plus l'initiale du nom lorsqu'un logo est présent", () => {
    const withLogo = renderToStaticMarkup(
      <TeamCard team={team({ name: "Dragon Squad", logoUrl: "/api/uploads/team-logos/12.webp" })} />,
    );

    // « D » seul dans le cadre de l'emblème : le nom complet et le tag « DRA »
    // restent, mais l'initiale isolée disparaît au profit de l'image.
    expect(withLogo).not.toMatch(/>D<\/div>/);
  });

  it("retombe sur l'initiale du nom quand l'équipe n'a pas de logo", () => {
    const markup = renderToStaticMarkup(<TeamCard team={team({ logoUrl: null })} />);

    expect(markup).toMatch(/>D<\/div>/);
  });

  it("n'invente aucune image de repli pour une équipe sans logo", () => {
    const markup = renderToStaticMarkup(
      <TeamCard team={team({ logoUrl: null, rosterPreview: [] })} />,
    );

    expect(imgTags(markup)).toHaveLength(0);
  });

  it("rend le logo comme décoration, sans ajouter de seconde ancre à la carte", () => {
    const markup = renderToStaticMarkup(
      <TeamCard team={team({ logoUrl: "/api/uploads/team-logos/12.webp", rosterPreview: [] })} />,
    );

    // Une seule ancre : la plaque qui mène à `/equipes/12`.
    expect(markup.match(/<a\b/g) ?? []).toHaveLength(1);
    expect(markup).toContain('href="/equipes/12"');
  });

  it("laisse le logo hors de l'ancre, pour ne pas casser la plaque de la carte", () => {
    const markup = renderToStaticMarkup(
      <TeamCard team={team({ logoUrl: "/api/uploads/team-logos/12.webp", rosterPreview: [] })} />,
    );

    const anchor = markup.match(/<a\b[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(anchor).not.toContain("<img");
  });

  it("décrit le logo par un alt vide : le nom de l'équipe le suit déjà en texte", () => {
    const markup = renderToStaticMarkup(
      <TeamCard team={team({ logoUrl: "/api/uploads/team-logos/12.webp", rosterPreview: [] })} />,
    );

    const logo = imgTags(markup)[0];
    expect(logo).toMatch(/alt=""/);
    expect(markup).toContain("Dragon Squad");
  });
});

/**
 * Le cadre de l'emblème garde ses 56 px carrés quel qu'en soit le contenu.
 *
 * Deux règles le lui volaient, l'une et l'autre invisibles au rendu HTML — d'où
 * ces gardes au niveau de la feuille :
 *
 * 1. `.head > div` visait aussi l'emblème, `div` frère du bloc de texte, et son
 *    `flex: 1` (plus spécifique que `.sigil`) écrasait le `flex-shrink: 0` :
 *    l'emblème occupait la moitié de l'en-tête, et le nom s'élidait pour rien ;
 * 2. un logo laissé **dans le flux** impose sa taille intrinsèque à la case —
 *    un fichier de 128 px débordait sur les statistiques de la carte.
 *
 * Les commentaires de la feuille sont retirés avant lecture, comme dans
 * `tests/app/entity-links.test.ts` : ils **citent** en prose le sélecteur que
 * ces gardes interdisent, et une reformulation qui recopierait la règle avec son
 * accolade ferait échouer un code pourtant correct.
 */
describe("TeamCard — le cadre de l'emblème ne se laisse pas étirer", () => {
  const css = stripCssComments(
    readFileSync(
      join(__dirname, "..", "..", "app", "(secured)", "equipes", "cards", "TeamCard.module.css"),
      "utf8",
    ),
  );

  it("réserve `flex: 1` au bloc de texte, jamais à tous les enfants de l'en-tête", () => {
    expect(css).toMatch(/\.headText\s*\{/);
    expect(css).not.toMatch(/\.head\s*>\s*div\s*\{/);
  });

  it("sort le logo du flux pour qu'il n'impose pas sa taille au cadre", () => {
    const rule = css.match(/\.sigilLogo\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/object-fit:\s*cover/);
  });

  it("garde le cadre en 56 px carrés", () => {
    const rule = css.match(/\.sigil\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/width:\s*56px/);
    expect(rule).toMatch(/height:\s*56px/);
  });
});
