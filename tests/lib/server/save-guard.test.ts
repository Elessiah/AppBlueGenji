import { describe, expect, it } from "@jest/globals";
import type { AdminResolveEntry, AdminScoreEntry } from "@/lib/server/tournaments/admin";
import {
  assertForfeitBelongsToMatch,
  assertMatchSavable,
  assertSaveEntryFits,
  mapEntryOf,
} from "@/lib/server/tournaments/save-guard";

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

/** Corps non typé, tel qu'une route le reçoit : la garde le ferme à l'exécution. */
const untyped = (body: string): AdminResolveEntry => JSON.parse(body) as AdminResolveEntry;
const entrants = { team1_id: 1, team2_id: 2 };

describe("assertForfeitBelongsToMatch", () => {
  it("assertForfeitBelongsToMatch_team1Forfeits_passes", () => {
    expect(() => assertForfeitBelongsToMatch(entrants, 1)).not.toThrow();
  });

  it("assertForfeitBelongsToMatch_team2Forfeits_passes", () => {
    expect(() => assertForfeitBelongsToMatch(entrants, 2)).not.toThrow();
  });

  it("assertForfeitBelongsToMatch_foreignTeam_throwsInvalidForfeitTeamId", () => {
    expect(() => assertForfeitBelongsToMatch(entrants, 9)).toThrow("INVALID_FORFEIT_TEAM_ID");
  });
});

describe("mapEntryOf", () => {
  it("mapEntryOf_wellFormedEntry_returnsSameEntry", () => {
    const entry = { maps: [], userId: 1 };

    expect(mapEntryOf(entry)).toBe(entry);
  });

  it("mapEntryOf_nonIntegerUserId_throwsInvalidRequest", () => {
    expect(() => mapEntryOf({ maps: [], userId: 1.5 })).toThrow("INVALID_REQUEST");
  });

  it("mapEntryOf_mapsNotArray_throwsInvalidRequest", () => {
    expect(() => mapEntryOf(untyped('{"maps":"x","userId":1}'))).toThrow("INVALID_REQUEST");
  });
});

/**
 * Revue perf #542 : la saisie d'« Enregistrer » se juge sur la lecture
 * préalable, avant d'attendre le verrou du tournoi.
 */
describe("assertSaveEntryFits", () => {
  it("assertSaveEntryFits_forfeitOfForeignTeam_throwsInvalidForfeitTeamId", () => {
    expect(() => assertSaveEntryFits(entrants, { forfeitTeamId: 9 })).toThrow("INVALID_FORFEIT_TEAM_ID");
  });

  it("assertSaveEntryFits_forfeitOfEntrant_passes", () => {
    expect(() => assertSaveEntryFits(entrants, { forfeitTeamId: 2 })).not.toThrow();
  });

  it("assertSaveEntryFits_malformedMapEntry_throwsInvalidRequest", () => {
    const entry = JSON.parse('{"maps":"x","userId":1}') as AdminScoreEntry;

    expect(() => assertSaveEntryFits(entrants, entry)).toThrow("INVALID_REQUEST");
  });
});
