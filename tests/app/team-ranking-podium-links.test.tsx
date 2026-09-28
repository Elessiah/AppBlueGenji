import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { HighlightStrip } from "@/app/(secured)/equipes/cards/HighlightStrip";
import type { TeamListItem } from "@/lib/shared/types";

/**
 * Le podium du classement de `/equipes` mène à la fiche de chaque équipe.
 *
 * Les cartes d'annuaire juste en dessous étaient cliquables, pas les trois
 * cartes du podium : la même équipe s'ouvrait d'un clic sur l'une et restait
 * inerte sur l'autre.
 */

function team(id: number, rank: number, overrides: Partial<TeamListItem> = {}): TeamListItem {
  return {
    id,
    name: `Équipe ${id}`,
    tag: null,
    logoUrl: null,
    membersCount: 5,
    createdAt: "2026-01-15T10:00:00.000Z",
    rank,
    points: 600 - rank,
    wins: 6,
    losses: 3,
    form: ["w", "l", "w"],
    games: ["OW"],
    rosterPreview: [],
    region: "FR",
    isGhost: false,
    ...overrides,
  };
}

const PODIUM = [team(7, 1), team(3, 2), team(11, 3), team(20, 4)];

function anchors(markup: string): string[] {
  return markup.match(/<a\b[^>]*>/g) ?? [];
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function zIndexOf(css: string, selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  const value = rule?.[1].match(/z-index:\s*(\d+)/)?.[1];
  return value === undefined ? Number.NaN : Number(value);
}

describe("HighlightStrip — liens vers les fiches d'équipe", () => {
  it("rend un lien vers la fiche de chacune des trois premières équipes", () => {
    const links = anchors(renderToStaticMarkup(<HighlightStrip teams={PODIUM} />));
    expect(links).toHaveLength(3);
    expect(links[0]).toContain('href="/equipes/7"');
    expect(links[1]).toContain('href="/equipes/3"');
    expect(links[2]).toContain('href="/equipes/11"');
  });

  it("n'ouvre pas de lien pour une équipe hors podium", () => {
    const markup = renderToStaticMarkup(<HighlightStrip teams={PODIUM} />);
    expect(markup).not.toContain('href="/equipes/20"');
  });

  it("nomme chaque lien par l'équipe qu'il ouvre, pas par tout le texte de la carte", () => {
    const links = anchors(
      renderToStaticMarkup(
        <HighlightStrip teams={[team(7, 1, { name: "Dragon Squad" }), team(3, 2), team(11, 3)]} />,
      ),
    );
    expect(links[0]).toContain('aria-label="Voir la fiche de Dragon Squad"');
  });

  it("n'imbrique aucun contenu dans le lien (plaque transparente)", () => {
    const markup = renderToStaticMarkup(<HighlightStrip teams={PODIUM} />);
    expect(markup).toMatch(/<a\b[^>]*><\/a>/);
    expect(markup.match(/<a\b[^>]*>([\s\S]*?)<\/a>/g)?.every((a) => /<a\b[^>]*><\/a>/.test(a))).toBe(true);
  });

  it("ne rend rien sous trois équipes", () => {
    expect(renderToStaticMarkup(<HighlightStrip teams={PODIUM.slice(0, 2)} />)).toBe("");
  });

  it("couvre la carte et garde la légende des points au-dessus de la plaque", () => {
    const css = stripCssComments(
      readFileSync(join(process.cwd(), "app/(secured)/equipes/cards/HighlightStrip.module.css"), "utf8"),
    );
    expect(css).toMatch(/\.card \{[\s\S]*?position: relative;/);
    expect(css).toMatch(/\.cardOverlay \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
    expect(zIndexOf(css, ".cardOverlay")).toBeGreaterThan(0);
    expect(zIndexOf(css, ".ptsBlock")).toBeGreaterThan(zIndexOf(css, ".cardOverlay"));
    const markup = renderToStaticMarkup(<HighlightStrip teams={PODIUM} />);
    expect(markup).toMatch(/class="[^"]*ptsBlock[^"]*" title="/);
  });
});
