import { describe, expect, it } from "@jest/globals";

import { enteredScoreRelation } from "@/lib/shared/player-score-report";
import type { MatchScoreReport } from "@/lib/shared/types";

const report = (team1Score: number, team2Score: number) =>
  ({ team1Score, team2Score, reportedAt: "2026-01-01T00:00:00.000Z" }) as unknown as MatchScoreReport;

describe("enteredScoreRelation", () => {
  it("rien à comparer sans saisie complète ou hors du match", () => {
    expect(enteredScoreRelation(null, { mine: report(2, 1), theirs: null })).toEqual({
      unchangedMine: false,
      confirmsTheirs: false,
    });
    expect(enteredScoreRelation({ team1Score: 2, team2Score: 1 }, null)).toEqual({
      unchangedMine: false,
      confirmsTheirs: false,
    });
  });

  it("repère la répétition de sa propre proposition", () => {
    const view = { mine: report(2, 1), theirs: report(2, 1) };
    expect(enteredScoreRelation({ team1Score: 2, team2Score: 1 }, view)).toEqual({
      unchangedMine: true,
      confirmsTheirs: false,
    });
  });

  it("confirme la proposition adverse quand le lecteur n'a rien envoyé", () => {
    const view = { mine: null, theirs: report(0, 3) };
    expect(enteredScoreRelation({ team1Score: 0, team2Score: 3 }, view)).toEqual({
      unchangedMine: false,
      confirmsTheirs: true,
    });
    expect(enteredScoreRelation({ team1Score: 1, team2Score: 3 }, view).confirmsTheirs).toBe(false);
  });
});
