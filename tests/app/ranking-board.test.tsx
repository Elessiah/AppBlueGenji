import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { RankingBoard, podiumGapText } from "@/app/classement/RankingBoard";
import { rankingAddedMessage } from "@/app/classement/RankingMore";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";

/**
 * Page `/classement` : podium, tableau complet, filtres en liens, couleur de
 * défaite réservée aux défaites réelles (docs/features/RANKING_PAGE.md).
 */

function row(rank: number, overrides: Partial<LandingLeaderboardRow> = {}): LandingLeaderboardRow {
  return {
    rank,
    teamId: rank * 10,
    teamName: `Équipe ${rank}`,
    logoUrl: null,
    wins: 4,
    losses: 1,
    draws: 0,
    points: 700 - rank * 20,
    trend: "flat",
    trendValue: 0,
    ...overrides,
  };
}

const ROWS = [row(1), row(2, { trend: "up", trendValue: 2 }), row(3), row(4, { losses: 0, trend: "down", trendValue: 1 })];

function render(props: Partial<Parameters<typeof RankingBoard>[0]> = {}): string {
  return renderToStaticMarkup(
    <RankingBoard rows={ROWS} filter="all" forms={new Map([[10, ["w", "l", "d"] as ("w" | "l" | "d")[]]])} {...props} />,
  );
}

describe("RankingBoard", () => {
  it("rend un podium des trois premières, la 1re couronnée", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Podium"');
    expect((markup.match(/data-place="\d"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(markup).toContain("1re place");
    expect(markup).toContain("En tête du classement");
    expect(markup).toContain("À 20 pts de la tête");
  });

  it("n'affiche pas de podium sous trois équipes", () => {
    const markup = render({ rows: [row(1), row(2)] });
    expect(markup).not.toContain('aria-label="Podium"');
    expect(markup).toContain("Tableau du classement des équipes");
  });

  it("mène chaque équipe à sa fiche et libelle les cellules chiffrées", () => {
    const markup = render();
    expect(markup).toContain('href="/equipes/40"');
    expect(markup).toContain('data-label="Cote"');
    expect(markup).toContain('data-label="D"');
  });

  it("colore une défaite, laisse neutre un compte nul", () => {
    const markup = render({ rows: [row(1, { losses: 0 })] });
    expect(markup).not.toContain("result-loss");
    expect(render()).toContain("result-loss");
  });

  it("montre la forme au général seulement, épelée pour les lecteurs d'écran", () => {
    expect(render()).toContain("Forme récente, du plus récent au plus ancien : V, D, N");
    expect(render({ forms: null })).not.toContain("Forme récente");
  });

  it("n'ajoute la colonne des nuls que s'il y en a", () => {
    expect(render()).not.toContain('data-label="N"');
    expect(render({ rows: [row(1, { draws: 2 })] })).toContain('data-label="N"');
  });

  it("dit la tendance en toutes lettres", () => {
    const markup = render();
    expect(markup).toContain("Monte de 2 sur 7 jours");
    expect(markup).toContain("Descend de 1 sur 7 jours");
    expect(markup).toContain("Stable sur 7 jours");
  });

  it("rend les filtres en liens, le courant marqué", () => {
    const markup = render({ filter: "ow" });
    expect(markup).toContain('href="/classement?jeu=ow"');
    expect(markup).toMatch(/aria-current="page"[^>]*>Overwatch|href="\/classement\?jeu=ow"[^>]*aria-current="page"/);
  });

  it("distingue une liste vide d'une panne", () => {
    expect(render({ rows: [] })).toContain("Aucune équipe classée");
    expect(render({ rows: [], unavailable: true })).toContain("momentanément indisponible");
  });
});

describe("podiumGapText", () => {
  it("dit l'égalité avec la tête", () => {
    expect(podiumGapText([{ points: 500 }, { points: 500 }], 1)).toBe("À égalité avec la tête");
  });

  it("dit l'égalité avec le rang au-dessus plutôt qu'un écart nul", () => {
    expect(podiumGapText([{ points: 600 }, { points: 580 }, { points: 580 }], 2)).toBe(
      "À 20 pts de la tête · à égalité avec le rang au-dessus",
    );
  });

  it("ajoute l'écart au rang au-dessus quand il diffère de celui à la tête", () => {
    expect(podiumGapText([{ points: 600 }, { points: 560 }, { points: 540 }], 2)).toBe(
      "À 60 pts de la tête · 20 du rang au-dessus",
    );
  });
});

describe("styles de /classement", () => {
  const css = readFileSync(join(process.cwd(), "app/classement/page.module.css"), "utf8");

  it("met en pause toute animation infinie avec le régime de charge", () => {
    const infinite = css.match(/animation:[^;]*infinite[^;]*;/g) ?? [];
    expect(infinite.length).toBeGreaterThan(0);
    const states = css.match(/animation-play-state: var\(--deco-anim-state\)/g) ?? [];
    expect(states).toHaveLength(infinite.length);
  });

  it("n'emploie aucune police sous le plancher de 11 px", () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });
});

describe("RankingBoard — affichage progressif", () => {
  const page = Array.from({ length: 50 }, (_, index) => row(index + 1));

  it("rend un vrai lien « Afficher plus » vers la page suivante, sans JavaScript", () => {
    const markup = render({ rows: page, filter: "ow", forms: null, hasMore: true });
    expect(markup).toMatch(/<a href="\/classement\?jeu=ow&amp;n=100#rang-51"[^>]*>Afficher plus<\/a>/);
    expect(markup).toContain('<output class="sr-only">');
  });

  it("n'offre aucun lien quand tout est affiché, mais garde la région d'annonce", () => {
    const markup = render({ rows: page, hasMore: false });
    expect(markup).not.toContain("Afficher plus");
    expect(markup).toContain('<output class="sr-only">');
  });

  it("garde des rangs absolus et une ancre focalisable sur chaque ligne d'une page suivante", () => {
    const second = Array.from({ length: 100 }, (_, index) => row(index + 1));
    const markup = render({ rows: second, hasMore: true });
    expect(markup).toMatch(/id="rang-51" tabindex="-1"/);
    expect(markup).toContain(">51</span>");
    expect(markup).toContain(">100</span>");
    expect(markup).toContain('href="/classement?n=150#rang-101"');
  });

  it("annonce le nombre de lignes ajoutées, et la fin du classement", () => {
    expect(rankingAddedMessage(50, "more")).toBe("50 équipes ajoutées.");
    expect(rankingAddedMessage(1, "end")).toBe("1 équipe ajoutée. Fin du classement.");
    expect(rankingAddedMessage(50, "capped")).toBe("50 équipes ajoutées. Affichage limité aux 1000 premières équipes.");
  });

  it("au plafond, dit qu'il reste des équipes au lieu d'un faux « fin du classement »", () => {
    const capped = Array.from({ length: 1000 }, (_, index) => row(index + 1));
    const markup = render({ rows: capped, forms: null, hasMore: true });
    expect(markup).not.toContain("Afficher plus");
    expect(markup).toContain("Affichage limité aux 1000 premières équipes.");
    expect(render({ rows: capped, forms: null, hasMore: false })).not.toContain("Affichage limité");
  });
});
