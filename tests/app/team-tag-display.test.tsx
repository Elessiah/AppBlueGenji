import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamCard } from "@/app/(secured)/equipes/cards/TeamCard";
import { TeamSigil } from "@/components/cyber/TeamSigil";
import { TEAM_TAG_MAX_LENGTH } from "@/lib/shared/team-tag";
import type { TeamListItem } from "@/lib/shared/types";

/**
 * Rendu du sigle.
 *
 * Deux gardes. La carte d'annuaire doit montrer le **sigle choisi** — c'était
 * jusqu'ici les trois premières lettres du nom, que personne n'avait décidées —
 * et retomber sur ces initiales quand l'équipe n'a pas de sigle, pour que la
 * ligne ne disparaisse pas. `TeamSigil`, lui, doit **dimensionner** son texte :
 * sa case est carrée et de taille fixe, un sigle de quatre caractères y
 * débordait tant que la police héritait de son contexte.
 */

const ISO = "2026-01-15T10:00:00.000Z";

function team(overrides: Partial<TeamListItem> = {}): TeamListItem {
  return {
    id: 12,
    name: "Dragon Squad",
    tag: null,
    logoUrl: null,
    membersCount: 5,
    createdAt: ISO,
    rank: 4,
    points: 21,
    wins: 6,
    losses: 3,
    form: [],
    games: [],
    rosterPreview: [],
    region: null,
    isGhost: false,
    ...overrides,
  };
}

describe("TeamCard — sigle", () => {
  it("affiche le sigle de quatre caractères choisi par l'équipe", () => {
    const html = renderToStaticMarkup(<TeamCard team={team({ tag: "DRGN" })} />);
    expect(html).toContain("DRGN");
  });

  it("n'affiche plus les initiales dérivées dès qu'un sigle existe", () => {
    const html = renderToStaticMarkup(<TeamCard team={team({ tag: "OG" })} />);
    expect(html).toContain("OG");
    // « DRA » était le trigramme dérivé du nom : il ne doit plus s'y substituer.
    expect(html).not.toContain(">DRA<");
  });

  it("retombe sur les initiales du nom quand l'équipe n'a pas de sigle", () => {
    const html = renderToStaticMarkup(<TeamCard team={team({ tag: null })} />);
    expect(html).toContain("DRA");
  });

  it("garde la région à côté du sigle", () => {
    const html = renderToStaticMarkup(<TeamCard team={team({ tag: "DRGN", region: "FR" })} />);
    expect(html).toContain("DRGN");
    expect(html).toContain("FR");
  });
});

describe("TeamSigil", () => {
  it("rend le libellé en majuscules", () => {
    const html = renderToStaticMarkup(<TeamSigil label="drgn" />);
    expect(html).toContain("DRGN");
  });

  it("réduit la police à mesure que le sigle s'allonge", () => {
    const sizeOf = (html: string) => Number(/--font-size:\s*(\d+)px/.exec(html)?.[1]);

    const one = sizeOf(renderToStaticMarkup(<TeamSigil label="D" size={40} />));
    const two = sizeOf(renderToStaticMarkup(<TeamSigil label="DR" size={40} />));
    const four = sizeOf(renderToStaticMarkup(<TeamSigil label="DRGN" size={40} />));

    expect(one).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(four);
  });

  it("rend les longueurs déjà affichées à la taille qu'elles avaient (14 px)", () => {
    // Le texte héritait des 14 px du corps de page : le leaderboard (une lettre
    // dans 24 px) et le bureau (trois initiales dans 40 px) ne doivent pas
    // rapetisser au passage.
    const sizeOf = (html: string) => Number(/--font-size:\s*(\d+)px/.exec(html)?.[1]);

    expect(sizeOf(renderToStaticMarkup(<TeamSigil label="D" size={24} />))).toBe(14);
    expect(sizeOf(renderToStaticMarkup(<TeamSigil label="LEO" size={40} />))).toBe(14);
  });

  it("fait tenir un sigle de quatre caractères dans la plus petite case", () => {
    const html = renderToStaticMarkup(<TeamSigil label="DRGN" size={24} />);
    const fontSize = Number(/--font-size:\s*(\d+)px/.exec(html)?.[1]);
    // Quatre caractères d'une police de largeur ~0.6 em doivent rester sous les
    // 24 px de la case, liseré compris.
    expect(fontSize * 4 * 0.6).toBeLessThan(24);
  });

  it("tronque plutôt que de déborder si on lui passe plus long qu'un sigle", () => {
    const html = renderToStaticMarkup(<TeamSigil label="DRAGONSQUAD" />);
    expect(html).toContain("DRAGONSQUAD".slice(0, TEAM_TAG_MAX_LENGTH));
    expect(html).not.toContain("DRAGONSQUAD");
  });

  it("reste sans texte plutôt que de casser sur un libellé vide", () => {
    expect(() => renderToStaticMarkup(<TeamSigil label="" />)).not.toThrow();
  });
});
