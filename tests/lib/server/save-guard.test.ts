import { describe, expect, it } from "@jest/globals";
import { assertMatchSavable } from "@/lib/server/tournaments/save-guard";

/**
 * Garde d'« Enregistrer » (revue perf #542) : une seule règle pour la lecture
 * préalable hors transaction et la lecture sous verrou.
 */
describe("assertMatchSavable", () => {
  it("assertMatchSavable_bothEntrantsOpenMatch_passes", () => {
    expect(() => assertMatchSavable({ team1_id: 1, team2_id: 2, status: "READY" })).not.toThrow();
  });

  it("assertMatchSavable_awaitingConfirmation_passes", () => {
    expect(() => assertMatchSavable({ team1_id: 1, team2_id: 2, status: "AWAITING_CONFIRMATION" })).not.toThrow();
  });

  it("assertMatchSavable_team1Missing_throwsMatchNotReady", () => {
    expect(() => assertMatchSavable({ team1_id: null, team2_id: 2, status: "READY" })).toThrow("MATCH_NOT_READY");
  });

  it("assertMatchSavable_team2Missing_throwsMatchNotReady", () => {
    expect(() => assertMatchSavable({ team1_id: 1, team2_id: null, status: "READY" })).toThrow("MATCH_NOT_READY");
  });

  it("assertMatchSavable_completed_throwsMatchAlreadyCompleted", () => {
    expect(() => assertMatchSavable({ team1_id: 1, team2_id: 2, status: "COMPLETED" })).toThrow(
      "MATCH_ALREADY_COMPLETED",
    );
  });
});
