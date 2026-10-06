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
import { contrastRatio } from "@/lib/shared/color-contrast";

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

  it("ne répète pas le podium : le tableau commence à la 4e place et le dit", () => {
    const markup = render();
    expect(markup).toContain("Tableau du classement des équipes, à partir de la 4e place");
    expect(markup).toContain('id="rang-4"');
    expect(markup).not.toContain('id="rang-1"');
    expect(markup.match(/href="\/equipes\/10"/g) ?? []).toHaveLength(1);
  });

  it("garde la forme et la tendance des trois premières sur le podium", () => {
    const markup = render({ rows: [row(1), row(2, { trend: "up", trendValue: 2 }), row(3)] });
    expect(markup).not.toContain('role="table"');
    expect(markup).toContain("Forme récente, du plus récent au plus ancien : V, D, N");
    expect(markup).toContain("Monte de 2 sur 7 jours");
  });

  it("libelle visiblement la forme et la tendance du podium, sans les doubler à l'oral", () => {
    const markup = render({ rows: [row(1), row(2), row(3)] });
    expect(markup.match(/aria-hidden="true">Forme<\/span>/g) ?? []).toHaveLength(3);
    expect(markup.match(/aria-hidden="true">7 j<\/span>/g) ?? []).toHaveLength(3);
  });

  it("dit à l'oral qu'une équipe sans résultat récent n'a pas de forme", () => {
    const markup = render({ rows: [row(1), row(2), row(3)], forms: new Map() });
    expect(markup).toContain("Aucun résultat récent");
  });

  it("ne libelle pas la forme du podium quand elle n'est pas affichée", () => {
    const markup = render({ rows: [row(1), row(2), row(3)], forms: null });
    expect(markup).not.toContain('aria-hidden="true">Forme</span>');
    expect(markup.match(/aria-hidden="true">7 j<\/span>/g) ?? []).toHaveLength(3);
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

describe("noms du podium — un effet par marche", () => {
  const css = readFileSync(join(process.cwd(), "app/classement/page.module.css"), "utf8");
  const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const root = /:root\s*\{([^}]*)\}/.exec(globalsCss)![1];
  const tokenHex = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(root)?.[1];
  const SURFACE = "#161a22"; // --cyber-bg-3, le fond le plus clair (neon-palette.test.ts)
  /** Corps de la règle `.nameTierN :global(.entity-link) { … }`. */
  const linkRule = (tier: number) =>
    new RegExp(String.raw`\.nameTier${tier} :global\(\.entity-link\) \{([^}]*)\}`).exec(css)![1];

  it("pose une classe de marche distincte sur le nom de chaque équipe du podium", () => {
    const markup = render();
    const tiers = [...markup.matchAll(/<h3 class="podiumName (nameTier\d)">/g)].map((match) => match[1]);
    expect(tiers).toEqual(["nameTier1", "nameTier2", "nameTier3"]);
    // Le nom reste le texte du lien vers la fiche, nom accessible inchangé.
    expect(markup).toMatch(/<h3 class="podiumName nameTier1"><a [^>]*href="\/equipes\/10"[^>]*>Équipe 1<\/a><\/h3>/);
  });

  it("ne pose aucun effet hors du podium : ni au tableau, ni sans podium", () => {
    const markup = render();
    const table = markup.slice(markup.indexOf('aria-label="Podium"')).split("</ol>").slice(1).join("</ol>");
    expect(table).toContain("Équipe 4");
    expect(table).not.toMatch(/nameTier/);
    expect(render({ rows: [row(1), row(2)] })).not.toMatch(/nameTier/);
  });

  it("écrit chaque arrêt de couleur en jeton de texte tenant 4,5:1, sans teinte chaude", () => {
    for (const tier of [1, 2, 3]) {
      const rule = linkRule(tier);
      const tokens = [...rule.matchAll(/var\((--[a-z0-9-]+)\)/g)]
        .map((match) => match[1])
        // Les halos (`--*-rgb`) ne sont pas du texte ; l'état d'animation non plus.
        .filter((name) => name !== "--deco-anim-state" && !name.endsWith("-rgb"));
      expect(tokens.length).toBeGreaterThan(0);
      expect(rule).not.toMatch(/#[0-9a-f]{3,6}\b|amber|gold|orange/i);
      for (const name of tokens) {
        const hex = tokenHex(name);
        expect(hex).toBeDefined();
        expect(contrastRatio(hex!, SURFACE)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("hiérarchise le mouvement : 1re la plus vive, 2e plus lente, 3e immobile — tout en pause avec le régime", () => {
    const duration = (tier: number) => Number(/animation: nameIridescent ([\d.]+)s[^;]*infinite/.exec(linkRule(tier))?.[1]);
    expect(duration(1)).toBeLessThan(duration(2));
    expect(linkRule(1)).toContain("animation-play-state: var(--deco-anim-state)");
    expect(linkRule(2)).toContain("animation-play-state: var(--deco-anim-state)");
    expect(linkRule(3)).not.toMatch(/animation/);
    // Seule la position du fond bouge (ni mise en page, ni couleur recalculée).
    const keyframes = /@keyframes nameIridescent \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(keyframes.match(/[a-z-]+(?=:)/g)!.every((property) => property === "background-position")).toBe(true);
  });

  it("garde la peinture à l'arrêt : dégradé et filet ne dépendent d'aucune animation", () => {
    for (const tier of [1, 2]) {
      expect(linkRule(tier)).toMatch(/background-clip: text/);
      expect(linkRule(tier)).toMatch(/color: transparent/);
      expect(css).toMatch(new RegExp(String.raw`\.nameTier${tier}::after \{[^}]*width: \d+px`));
    }
    // Survol et focus rendent une couleur pleine (soulignement visible).
    expect(css).toMatch(/\.nameTier1 :global\(\.entity-link\):focus-visible[\s\S]*?\{\s*color: var\(--blue-100\)/);
  });

  it("n'entoure les noms que d'un halo large et léger, qui n'éclaircit pas le bord des lettres", () => {
    const nameRules = [1, 2].map((tier) => new RegExp(String.raw`\.nameTier${tier} \{([^}]*)\}`).exec(css)![1]).join(" ");
    const shadows = [...nameRules.matchAll(/drop-shadow\(0 0 (\d+)px rgba\(var\(--[a-z0-9-]+-rgb\), ([\d.]+)\)\)/g)];
    expect(shadows.length).toBeGreaterThan(0);
    for (const [, blur, alpha] of shadows) {
      expect(Number(blur)).toBeGreaterThanOrEqual(10);
      expect(Number(alpha)).toBeLessThanOrEqual(0.3);
    }
  });

  it("garde un soulignement visible et un nom imprimable malgré le texte transparent", () => {
    for (const tier of [1, 2]) {
      // « Liens soulignés » (menu d'accessibilité) : le trait ne suit pas `color: transparent`.
      expect(linkRule(tier)).toMatch(/text-decoration-color: var\(--blue-300\)/);
    }
    // Imprimé : les fonds ne s'impriment pas — couleur pleine pour les deux noms peints.
    expect(css).toMatch(/@media print \{\s*\.nameTier1 :global\(\.entity-link\),\s*\.nameTier2 :global\(\.entity-link\) \{\s*background: none;\s*color: var\(--blue-500\);/);
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

  it("garde la colonne « N » d'une page à l'autre quand un nul existe plus bas", () => {
    const markup = render({ rows: page, hasMore: true, anyDraws: true });
    expect(markup).toContain('<span role="columnheader">N</span>');
    expect(render({ rows: [row(1, { draws: 1 })], anyDraws: false })).not.toContain('<span role="columnheader">N</span>');
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
