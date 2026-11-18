import { describe, expect, it } from "@jest/globals";
import { entryAssignments, entryCoverage } from "@/lib/server/planning/model";
import { loadedAssignment, loadedEntry, planningData } from "../../../helpers/planning";

/** Ce que tient chaque entrée, toutes sources réunies (`CAST_PLANNING.md` § Provisoire, confirmé, manuel). */

describe("entryAssignments", () => {
  it("entryAssignments_matchNoReferee_provisionalRefereeShown", () => {
    const data = planningData({ assignments: [loadedAssignment({ userId: 3, role: "REFEREE", confirmed: false })] });

    expect(entryAssignments(loadedEntry(), data)).toEqual([
      { userId: 3, role: "REFEREE", source: "AUTO", reason: "LOAD", provisional: true },
    ]);
  });

  it("entryAssignments_matchRefereeSet_ignoresProvisional_showsMatchSource", () => {
    const data = planningData({ assignments: [loadedAssignment({ userId: 3, role: "REFEREE", confirmed: false })] });

    expect(entryAssignments(loadedEntry({ matchRefereeId: 8 }), data)).toEqual([
      { userId: 8, role: "REFEREE", source: "MATCH", reason: "MATCH", provisional: false },
    ]);
  });

  it("entryAssignments_matchRefereeWithConfirmedRow_keepsProvenance", () => {
    const data = planningData({
      assignments: [loadedAssignment({ userId: 8, role: "REFEREE", confirmed: true, reason: "PREFERENCE" })],
    });

    expect(entryAssignments(loadedEntry({ matchRefereeId: 8 }), data)).toEqual([
      { userId: 8, role: "REFEREE", source: "AUTO", reason: "PREFERENCE", provisional: false },
    ]);
  });

  it("entryAssignments_matchCasterWithoutRow_castSource", () => {
    const data = planningData({ matchCasters: new Map([["m:1", [5]]]) });

    expect(entryAssignments(loadedEntry(), data)).toEqual([
      { userId: 5, role: "CASTER", source: "CAST", reason: "CAST", provisional: false },
    ]);
  });

  it("entryAssignments_matchCasterWithPlanningRow_notDuplicated", () => {
    const data = planningData({
      assignments: [loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true })],
      matchCasters: new Map([["m:1", [5]]]),
    });

    expect(entryAssignments(loadedEntry(), data)).toEqual([
      { userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", provisional: false },
    ]);
  });

  it("entryAssignments_tournamentRefereeRows_kept", () => {
    const entry = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    const data = planningData({
      assignments: [
        loadedAssignment({ entryKey: "t:10", userId: 2, confirmed: true }),
        loadedAssignment({ entryKey: "t:10", userId: 1 }),
      ],
    });

    expect(entryAssignments(entry, data).map((row) => [row.userId, row.provisional])).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});

describe("entryCoverage", () => {
  it("entryCoverage_countsRolesIncludingProvisional", () => {
    const coverage = entryCoverage(
      [
        { userId: 1, role: "REFEREE", source: "AUTO", reason: "LOAD", provisional: true },
        { userId: 1, role: "CASTER", source: "AUTO", reason: "LOAD", provisional: true },
      ],
      new Set([1]),
    );

    expect(coverage.level).toBe("STREAMED");
    expect(coverage.refereePriority).toBe(false);
  });
});
