import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { SwissView } from "@/app/(secured)/tournois/[id]/_components/SwissView";
import { ToastProvider } from "@/components/ui/toast";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import type { SwissMeta, SwissStandingRow } from "@/lib/shared/types";

/**
 * Classement de la ronde suisse (tâche 9 d'`ACCESSIBILITE.md`) : un classement
 * à colonnes est un **tableau**. Il était une liste dont l'en-tête de colonnes
 * était masqué aux lecteurs d'écran, et chaque ligne réécrivait ses intitulés
 * dans un `aria-label` ; vide, la liste laissait `aria-required-children` à
 * vérifier.
 */

function standing(overrides: Partial<SwissStandingRow> = {}): SwissStandingRow {
  return {
    teamId: 1,
    teamName: "Dragon Squad",
    logoUrl: null,
    seed: 1,
    points: 6,
    wins: 2,
    draws: 0,
    losses: 0,
    byes: 0,
    buchholz: 3,
    status: "ACTIVE",
    rank: 1,
    ...overrides,
  };
}

function swiss(standings: SwissStandingRow[]): SwissMeta {
  return {
    totalRounds: 3,
    currentRound: 2,
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
    pointsForBye: 3,
    tiebreakers: ["buchholz"],
    standings,
  };
}

function render(
  standings: SwissStandingRow[],
  { canForfeit = () => false, isFinished = false }: { canForfeit?: (id: number) => boolean; isFinished?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <EntrantProvider participantType="TEAM" soloUserIds={{}} logos={buildEntrantLogoMap([])}>
        <SwissView
          swiss={swiss(standings)}
          matches={[]}
          allTournamentMatches={[]}
          myTeamId={null}
          isFinished={isFinished}
          canReport={() => false}
          adminResolvable={() => false}
          drafts={{}}
          onScoreChange={() => {}}
          onSubmit={async () => {}}
          onOpenAdminModal={() => {}}
          canForfeit={canForfeit}
          onForfeit={() => {}}
        />
      </EntrantProvider>
    </ToastProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

const TWO_TEAMS = [
  standing(),
  standing({ teamId: 2, teamName: "Frost Alliance", rank: 2, points: 3, wins: 1, losses: 1, byes: 1 }),
];

describe("classement de la ronde suisse", () => {
  it("est un tableau nommé, et plus une liste", () => {
    const html = render(TWO_TEAMS);
    expect(html).toContain('role="table" aria-label="Classement du tournoi"');
    expect(html).not.toContain('role="list"');
    expect(html).not.toContain('role="listitem"');
  });

  it("expose son en-tête de colonnes, avec les intitulés abrégés en toutes lettres", () => {
    const html = render(TWO_TEAMS);
    expect(html).toContain('role="columnheader" aria-label="Rang"');
    expect(html).toContain('role="columnheader" aria-label="Points"');
    expect(html).toContain('role="columnheader" aria-label="Victoires-Nuls-Défaites"');
    expect(html).toContain('role="columnheader" aria-label="Buchholz"');
    // L'en-tête ne se cache plus aux technologies d'assistance.
    expect(html).not.toMatch(/aria-hidden="true"[^>]*>\s*<span[^>]*>#/);
  });

  it("donne à chaque ligne autant de cellules que l'en-tête a de colonnes", () => {
    const html = render(TWO_TEAMS);
    // Un en-tête + deux équipes.
    expect(count(html, 'role="row"')).toBe(3);
    expect(count(html, 'role="columnheader"')).toBe(7);
    expect(count(html, 'role="cell"')).toBe(2 * 7);
  });

  it("ne réécrit plus le contenu d'une ligne dans son nom accessible", () => {
    expect(render(TWO_TEAMS)).not.toMatch(/role="row"[^>]*aria-label/);
  });

  it("dit la victoire d'office en toutes lettres, la coche restant décorative", () => {
    const html = render(TWO_TEAMS);
    expect(html).toContain('<span aria-hidden="true">✓</span><span class="sr-only">Oui</span>');
    expect(count(html, "✓")).toBe(1);
  });

  it("n'ajoute la colonne d'action que si une ligne porte le bouton d'abandon", () => {
    const withoutAction = render(TWO_TEAMS);
    expect(withoutAction).not.toContain(">Action<");
    expect(withoutAction).not.toContain("Abandonner");

    const withAction = render(TWO_TEAMS, { canForfeit: (id) => id === 2 });
    expect(withAction).toContain('<span class="sr-only">Action</span>');
    expect(count(withAction, 'role="columnheader"')).toBe(8);
    // Chaque ligne réserve la cellule, qu'elle porte le bouton ou non.
    expect(count(withAction, 'role="cell"')).toBe(2 * 8);
    expect(count(withAction, "<button")).toBe(1);
  });

  it("fait commencer le nom du bouton d'abandon par son texte visible (WCAG 2.5.3)", () => {
    const html = render(TWO_TEAMS, { canForfeit: () => true });
    expect(html).toContain("aria-label=\"Abandonner : déclarer l&#x27;abandon de Frost Alliance\"");
  });

  it("aligne ses colonnes par une grille à sous-grilles, sans largeur écrite à la main", () => {
    const html = render(TWO_TEAMS);
    // Les colonnes suivent leur cellule la plus large ; seul le nom est élastique,
    // avec un plancher qui suit la police.
    expect(html).toContain("grid-template-columns:auto minmax(6em, 1fr) auto auto auto auto auto;");
    expect(count(html, "grid-template-columns:subgrid")).toBe(2 + TWO_TEAMS.length + 1);
    // Aucune largeur de colonne écrite à la main dans le tableau, aucun fantôme.
    const table = html.slice(html.indexOf('role="table"'), html.indexOf("À points égaux"));
    expect(table).not.toMatch(/(?:min-)?width:\d+px/);
    expect(table).not.toContain("visibility:hidden");
    // La colonne d'action ajoute une piste, rien de plus.
    expect(render(TWO_TEAMS, { canForfeit: () => true })).toContain(
      "grid-template-columns:auto minmax(6em, 1fr) auto auto auto auto auto auto;",
    );
  });

  it("défile à l'horizontale sous le plancher du nom", () => {
    expect(render(TWO_TEAMS)).toContain(
      'role="region" aria-label="Classement du tournoi — défilement horizontal"',
    );
  });

  it("remplace le tableau par une phrase quand aucune équipe n'est classée", () => {
    const html = render([]);
    expect(html).not.toContain('role="table"');
    expect(html).toContain("Aucune équipe classée pour l&#x27;instant.");
  });

  it("ne promet aucune suite à un tournoi clos sans équipe classée", () => {
    const html = render([], { isFinished: true });
    expect(html).toContain("Aucune équipe classée.</p>");
    expect(html).not.toContain("Aucune équipe classée pour");
  });

  it("ne propose aucun abandon sur un tournoi terminé", () => {
    const html = render(TWO_TEAMS, { canForfeit: () => true, isFinished: true });
    expect(html).not.toContain("Abandonner");
    expect(count(html, 'role="columnheader"')).toBe(7);
  });
});
