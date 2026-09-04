import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dependentMatches, type MatchScoreState } from "@/lib/shared/match-lock";

/**
 * Les matchs d'un tournoi « BlueGenji Survie » étaient rendus avec
 * `format="SURVIVAL"` **en dur**.
 *
 * Sans effet visible aujourd'hui — `dependentMatches` range les deux modes dans
 * la même branche —, mais c'est exactement le genre de mensonge qui devient
 * faux en silence : le jour où les deux formats divergeraient, le verrouillage
 * d'un score se lirait sur les règles de l'autre mode, et rien ne le signalerait
 * à l'écran.
 *
 * D'où deux gardes : le branchement passe le format du tournoi, et le module
 * pur traite bien les deux formats de la même façon **aujourd'hui** — ce second
 * test est ce qui rendrait le premier indispensable s'il changeait.
 */
const PAGE = readFileSync(
  join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "page.tsx"),
  "utf8",
);

/**
 * Le bloc JSX d'`EnduranceView`, de sa balise ouvrante à la branche suivante de
 * la chaîne ternaire qui choisit la vue du plateau.
 */
function enduranceRenderMatch(): string {
  const start = PAGE.indexOf("<EnduranceView");
  expect(start).toBeGreaterThan(-1);
  const end = PAGE.indexOf(") : detail.card.format", start);
  expect(end).toBeGreaterThan(start);
  return PAGE.slice(start, end);
}

function match(overrides: Partial<MatchScoreState> = {}): MatchScoreState {
  return {
    id: 1,
    roundNumber: 1,
    team1Id: 10,
    team2Id: 11,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    hasPendingReport: false,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
    ...overrides,
  };
}

describe("EnduranceView — format des matchs", () => {
  it("passe le format du tournoi, jamais une constante", () => {
    const block = enduranceRenderMatch();
    expect(block).toContain("format={detail.card.format}");
    expect(block).not.toContain('format="SURVIVAL"');
  });
});

describe("match-lock — BG_SURVIE et SURVIVAL suivent la même règle", () => {
  const all = [match({ id: 1, roundNumber: 1 }), match({ id: 2, roundNumber: 2 })];

  it("fait dépendre les manches suivantes dans les deux modes", () => {
    for (const format of ["BG_SURVIE", "SURVIVAL"] as const) {
      expect(dependentMatches(all[0], all, format).map((m) => m.id)).toEqual([2]);
    }
  });

  it("ne fait dépendre aucune manche antérieure", () => {
    for (const format of ["BG_SURVIE", "SURVIVAL"] as const) {
      expect(dependentMatches(all[1], all, format)).toEqual([]);
    }
  });
});
