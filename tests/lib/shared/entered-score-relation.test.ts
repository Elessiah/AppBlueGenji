import { describe, expect, it } from "@jest/globals";

import { enteredScoreRelation } from "@/lib/shared/player-score-report";
import type { MatchScoreReport } from "@/lib/shared/types";
import { mapsFor } from "../../helpers/match-maps";

const report = (team1Score: number, team2Score: number, maps = mapsFor(team1Score, team2Score)): MatchScoreReport => ({
  team1Score,
  team2Score,
  reportedAt: "2026-01-01T00:00:00.000Z",
  maps: maps.map((map, index) => ({ ...map, mapNumber: index + 1 })),
});

const entered = (team1Score: number, team2Score: number) => ({ team1Score, team2Score, maps: mapsFor(team1Score, team2Score) });

describe("enteredScoreRelation", () => {
  it("rien à comparer sans saisie complète ou hors du match", () => {
    expect(enteredScoreRelation(null, { mine: report(2, 1), theirs: null })).toEqual({
      unchangedMine: false,
      confirmsTheirs: false,
    });
    expect(enteredScoreRelation(entered(2, 1), null)).toEqual({
      unchangedMine: false,
      confirmsTheirs: false,
    });
  });

  it("repère la répétition de sa propre proposition", () => {
    const view = { mine: report(2, 1), theirs: report(2, 1) };
    expect(enteredScoreRelation(entered(2, 1), view)).toEqual({
      unchangedMine: true,
      confirmsTheirs: false,
    });
  });

  it("confirme la proposition adverse quand le lecteur n'a rien envoyé", () => {
    const view = { mine: null, theirs: report(0, 3) };
    expect(enteredScoreRelation(entered(0, 3), view)).toEqual({
      unchangedMine: false,
      confirmsTheirs: true,
    });
    expect(enteredScoreRelation(entered(1, 3), view).confirmsTheirs).toBe(false);
  });

  it("ne confirme pas une proposition dont le détail manque : le serveur la refuserait (PROPOSAL_STALE)", () => {
    const view = { mine: null, theirs: report(0, 3, []) };
    expect(enteredScoreRelation(entered(0, 3), view).confirmsTheirs).toBe(false);
  });

  it("une proposition renvoyée sans son détail n'est pas une répétition", () => {
    const view = { mine: report(2, 1, []), theirs: null };
    expect(enteredScoreRelation(entered(2, 1), view).unchangedMine).toBe(false);
  });
});
