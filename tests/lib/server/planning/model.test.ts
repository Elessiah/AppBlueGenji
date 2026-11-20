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

  it("entryAssignments_castSignupOverProvisionalCaster_becomesCast", () => {
    const data = planningData({
      assignments: [loadedAssignment({ userId: 5, role: "CASTER", confirmed: false })],
      matchCasters: new Map([["m:1", [5]]]),
    });

    expect(entryAssignments(loadedEntry(), data)).toEqual([
      { userId: 5, role: "CASTER", source: "CAST", reason: "CAST", provisional: false },
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

describe("entryAssignments — regroupement par entrée", () => {
  it("entryAssignments_manyEntries_eachSeesOnlyItsOwnRows", () => {
    const entries = Array.from({ length: 300 }, (_, i) => loadedEntry({ key: `m:${i}`, matchId: i }));
    const data = planningData({
      entries,
      assignments: entries.map((entry, i) => loadedAssignment({ entryKey: entry.key, userId: i + 1, role: "CASTER" })),
    });

    const seen = entries.map((entry) => entryAssignments(entry, data).map((row) => row.userId));

    expect(seen).toEqual(entries.map((_, i) => [i + 1]));
  });

  it("entryAssignments_entryWithoutRows_empty", () => {
    const data = planningData({ assignments: [loadedAssignment({ entryKey: "m:2" })] });

    expect(entryAssignments(loadedEntry({ key: "m:1" }), data)).toEqual([]);
  });

  it("entryAssignments_twoLoads_independentResults", () => {
    const first = planningData({ assignments: [loadedAssignment({ userId: 3, role: "CASTER" })] });
    const second = planningData({ assignments: [loadedAssignment({ userId: 4, role: "CASTER" })] });

    expect(entryAssignments(loadedEntry(), first)[0].userId).toBe(3);
    expect(entryAssignments(loadedEntry(), second)[0].userId).toBe(4);
  });
});

describe("entryAssignments — prod du match (MATCH_PROD.md)", () => {
  it("entryAssignments_matchProd_addsHeldProdRow_dropsProvisionalProd", () => {
    const data = planningData({ assignments: [loadedAssignment({ userId: 7, role: "PROD", confirmed: false })] });

    expect(entryAssignments(loadedEntry({ matchProdId: 5 }), data)).toEqual([
      { userId: 5, role: "PROD", source: "CAST", reason: "CAST", provisional: false },
    ]);
  });

  it("entryAssignments_matchProdAlreadyHeld_keepsSingleRow", () => {
    const data = planningData({
      assignments: [loadedAssignment({ userId: 5, role: "PROD", confirmed: true, reason: "PREFERENCE" })],
    });

    expect(entryAssignments(loadedEntry({ matchProdId: 5 }), data)).toEqual([
      { userId: 5, role: "PROD", source: "AUTO", reason: "PREFERENCE", provisional: false },
    ]);
  });

  it("entryAssignments_noMatchProd_keepsProvisionalProd", () => {
    const data = planningData({ assignments: [loadedAssignment({ userId: 7, role: "PROD", confirmed: false })] });

    expect(entryAssignments(loadedEntry({ matchProdId: null }), data)).toEqual([
      { userId: 7, role: "PROD", source: "AUTO", reason: "LOAD", provisional: true },
    ]);
  });
});
