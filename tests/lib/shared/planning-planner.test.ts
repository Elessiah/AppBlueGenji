import { describe, expect, it } from "@jest/globals";
import type { PlanningRole } from "@/lib/shared/planning";
import { planAssignments, rolesConflict, slotsOverlap } from "@/lib/shared/planning-planner";
import { available, HOUR_MS, MONDAY, plannerEntry, plannerInput } from "../../helpers/planning";

/**
 * Calcul automatique du planning (`docs/features/CAST_PLANNING.md` § Calcul) :
 * préférences, charge, autogestion, choix verrouillés, règles de couverture,
 * plusieurs casquettes, groupe d'arbitres d'un tournoi entier, chevauchement,
 * déterminisme.
 */

const REFEREE: PlanningRole[] = ["REFEREE"];
const CASTER: PlanningRole[] = ["CASTER"];
const PROD: PlanningRole[] = ["PROD"];

/** Les propositions réduites à « qui, quel rôle, où ». */
function picks(result: ReturnType<typeof planAssignments>) {
  return result.map(({ entryKey, userId, role }) => ({ entryKey, userId, role }));
}

describe("slotsOverlap / rolesConflict", () => {
  it("slotsOverlap_overlapping_true", () => {
    expect(slotsOverlap({ startAt: 0, endAt: 10 }, { startAt: 5, endAt: 15 })).toBe(true);
  });

  it("slotsOverlap_consecutive_false", () => {
    expect(slotsOverlap({ startAt: 0, endAt: 10 }, { startAt: 10, endAt: 20 })).toBe(false);
  });

  it("slotsOverlap_disjoint_false", () => {
    expect(slotsOverlap({ startAt: 0, endAt: 10 }, { startAt: 30, endAt: 40 })).toBe(false);
  });

  it("rolesConflict_casterProd_true", () => {
    expect(rolesConflict("CASTER", "PROD")).toBe(true);
    expect(rolesConflict("PROD", "CASTER")).toBe(true);
  });

  it("rolesConflict_refereeCaster_false", () => {
    expect(rolesConflict("REFEREE", "CASTER")).toBe(false);
    expect(rolesConflict("REFEREE", "PROD")).toBe(false);
  });
});

describe("planAssignments — préférences et charge", () => {
  it("planAssignments_preferredCandidate_chosenWithReasonPreference", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "REFEREE"), available("m:1", 2, "REFEREE", { preferred: true })],
      members: new Map([[1, REFEREE], [2, REFEREE]]),
    });

    const result = planAssignments(input);

    expect(result).toEqual([{ entryKey: "m:1", userId: 2, role: "REFEREE", reason: "PREFERENCE", weekLoad: 1, historyLoad: 0 }]);
  });

  it("planAssignments_noPreference_lowerWeekLoadWins_reasonLoad", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 44)],
      availability: [
        available("m:1", 1, "REFEREE"),
        available("m:1", 2, "REFEREE"),
        available("m:2", 1, "REFEREE"),
        available("m:2", 2, "REFEREE"),
      ],
      members: new Map([[1, REFEREE], [2, REFEREE]]),
    });

    const result = planAssignments(input);

    expect(result.map((row) => row.userId).sort()).toEqual([1, 2]);
    expect(result.every((row) => row.reason === "LOAD" && row.weekLoad === 1)).toBe(true);
  });

  it("planAssignments_equalWeekLoad_lowerHistoryWins", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "REFEREE"), available("m:1", 2, "REFEREE")],
      members: new Map([[1, REFEREE], [2, REFEREE]]),
      history: new Map([[1, 3]]),
    });

    const result = planAssignments(input);

    expect(picks(result)).toEqual([{ entryKey: "m:1", userId: 2, role: "REFEREE" }]);
  });
});

describe("planAssignments — refus et verrous", () => {
  it("planAssignments_unavailableOrPending_neverAssigned", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [
        available("m:1", 1, "REFEREE", { status: "UNAVAILABLE" }),
        available("m:1", 2, "REFEREE", { status: "PENDING" }),
      ],
      members: new Map([[1, REFEREE], [2, REFEREE]]),
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_roleNotHeld_neverAssigned", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "CASTER")],
      members: new Map([[1, REFEREE]]),
      soloCasterIds: new Set([1]),
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_excludedKey_neverAssigned", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "REFEREE")],
      members: new Map([[1, REFEREE]]),
      excluded: new Set(["m:1|1|REFEREE"]),
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_refereeDecided_noRefereeProposed", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "REFEREE")],
      members: new Map([[1, REFEREE]]),
      refereeDecided: new Set(["m:1"]),
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_lockedManual_keptAndNotReturned", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 2, "REFEREE", { preferred: true })],
      members: new Map([[1, REFEREE], [2, REFEREE]]),
      locked: [{ entryKey: "m:1", userId: 1, role: "REFEREE", reason: "MANUAL" }],
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_lockedConflictsByOverlap_otherEntryGetsSomeoneElse", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20, { open: false }), plannerEntry("m:2", 20)],
      availability: [available("m:2", 1, "REFEREE"), available("m:2", 2, "REFEREE")],
      members: new Map([[1, REFEREE], [2, REFEREE]]),
      locked: [{ entryKey: "m:1", userId: 1, role: "REFEREE", reason: "MANUAL" }],
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:2", userId: 2, role: "REFEREE" }]);
  });

  it("planAssignments_closedEntry_notFilled", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20, { open: false })],
      availability: [available("m:1", 1, "REFEREE")],
      members: new Map([[1, REFEREE]]),
    });

    expect(planAssignments(input)).toEqual([]);
  });
});

describe("planAssignments — règles de couverture", () => {
  it("planAssignments_prodWithoutCaster_noProdAssigned", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 2, "PROD")],
      members: new Map([[2, PROD]]),
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_nonSoloCasterNoOtherProd_casterNotAssigned", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "CASTER")],
      members: new Map([[1, CASTER]]),
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_soloCaster_assignedWithoutProd", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "CASTER")],
      members: new Map([[1, CASTER]]),
      soloCasterIds: new Set([1]),
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:1", userId: 1, role: "CASTER" }]);
  });

  it("planAssignments_casterAndProd_bothAssigned", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "CASTER"), available("m:1", 2, "PROD"), available("m:1", 3, "REFEREE")],
      members: new Map([[1, CASTER], [2, PROD], [3, REFEREE]]),
    });

    expect(picks(planAssignments(input))).toEqual([
      { entryKey: "m:1", userId: 3, role: "REFEREE" },
      { entryKey: "m:1", userId: 1, role: "CASTER" },
      { entryKey: "m:1", userId: 2, role: "PROD" },
    ]);
  });

  it("planAssignments_oneRefereeTwoOverlappingEntries_streamedEntryGetsReferee", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20, { startAt: MONDAY + 20 * HOUR_MS + 1 })],
      availability: [available("m:1", 1, "REFEREE"), available("m:2", 1, "REFEREE"), available("m:2", 10, "CASTER")],
      members: new Map([[1, REFEREE], [10, CASTER]]),
      soloCasterIds: new Set([10]),
    });

    expect(picks(planAssignments(input))).toEqual([
      { entryKey: "m:2", userId: 1, role: "REFEREE" },
      { entryKey: "m:2", userId: 10, role: "CASTER" },
    ]);
  });
});

describe("planAssignments — plusieurs casquettes", () => {
  it("planAssignments_multiHat_prefersDistinctPeople", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "REFEREE"), available("m:1", 1, "CASTER"), available("m:1", 2, "CASTER")],
      members: new Map<number, PlanningRole[]>([[1, ["REFEREE", "CASTER"]], [2, CASTER]]),
      soloCasterIds: new Set([1, 2]),
    });

    expect(picks(planAssignments(input))).toEqual([
      { entryKey: "m:1", userId: 1, role: "REFEREE" },
      { entryKey: "m:1", userId: 2, role: "CASTER" },
    ]);
  });

  it("planAssignments_multiHatOnlyOption_samePersonRefereesAndCasts", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "REFEREE"), available("m:1", 1, "CASTER")],
      members: new Map<number, PlanningRole[]>([[1, ["REFEREE", "CASTER"]]]),
      soloCasterIds: new Set([1]),
    });

    expect(picks(planAssignments(input))).toEqual([
      { entryKey: "m:1", userId: 1, role: "REFEREE" },
      { entryKey: "m:1", userId: 1, role: "CASTER" },
    ]);
  });

  it("planAssignments_multiHat_neverCasterAndProdSamePerson", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "CASTER"), available("m:1", 1, "PROD"), available("m:1", 2, "CASTER")],
      members: new Map<number, PlanningRole[]>([[1, ["CASTER", "PROD"]], [2, CASTER]]),
    });

    expect(picks(planAssignments(input))).toEqual([
      { entryKey: "m:1", userId: 2, role: "CASTER" },
      { entryKey: "m:1", userId: 1, role: "PROD" },
    ]);
  });
});

describe("planAssignments — tournoi entier et chevauchement", () => {
  it("planAssignments_tournamentEntry_poolOfTwoReferees", () => {
    const input = plannerInput({
      entries: [plannerEntry("t:5", 20, { endAt: MONDAY + 24 * HOUR_MS, refereeSlots: 2 })],
      availability: [available("t:5", 1, "REFEREE"), available("t:5", 2, "REFEREE"), available("t:5", 3, "REFEREE")],
      members: new Map([[1, REFEREE], [2, REFEREE], [3, REFEREE]]),
    });

    expect(picks(planAssignments(input))).toEqual([
      { entryKey: "t:5", userId: 1, role: "REFEREE" },
      { entryKey: "t:5", userId: 2, role: "REFEREE" },
    ]);
  });

  it("planAssignments_tournamentEntryAndOverlappingMatch_matchStillGetsFirstReferee", () => {
    const input = plannerInput({
      entries: [plannerEntry("t:5", 20, { endAt: MONDAY + 24 * HOUR_MS, refereeSlots: 2 }), plannerEntry("m:1", 21)],
      availability: [
        available("t:5", 1, "REFEREE"),
        available("t:5", 2, "REFEREE"),
        available("m:1", 1, "REFEREE"),
        available("m:1", 2, "REFEREE"),
      ],
      members: new Map([[1, REFEREE], [2, REFEREE]]),
    });

    const result = picks(planAssignments(input));

    expect(result.filter((row) => row.entryKey === "m:1")).toHaveLength(1);
    expect(result.filter((row) => row.entryKey === "t:5")).toHaveLength(1);
  });

  it("planAssignments_overlappingEntries_samePersonNotTwice", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20, { endAt: MONDAY + 22 * HOUR_MS }), plannerEntry("m:2", 21)],
      availability: [available("m:1", 1, "REFEREE"), available("m:2", 1, "REFEREE")],
      members: new Map([[1, REFEREE]]),
    });

    expect(planAssignments(input)).toHaveLength(1);
  });

  it("planAssignments_consecutiveEntries_samePersonChained", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 21)],
      availability: [available("m:1", 1, "REFEREE"), available("m:2", 1, "REFEREE")],
      members: new Map([[1, REFEREE]]),
    });

    expect(picks(planAssignments(input))).toEqual([
      { entryKey: "m:1", userId: 1, role: "REFEREE" },
      { entryKey: "m:2", userId: 1, role: "REFEREE" },
    ]);
  });
});

describe("planAssignments — déterminisme", () => {
  const entries = [plannerEntry("m:1", 20), plannerEntry("m:2", 20), plannerEntry("m:3", 22)];
  const availability = [
    available("m:1", 1, "REFEREE"),
    available("m:1", 2, "REFEREE"),
    available("m:2", 1, "REFEREE"),
    available("m:2", 3, "CASTER"),
    available("m:2", 4, "PROD"),
    available("m:3", 2, "REFEREE", { preferred: true }),
    available("m:3", 3, "CASTER"),
  ];
  const members = new Map<number, PlanningRole[]>([[1, REFEREE], [2, REFEREE], [3, CASTER], [4, PROD]]);

  it("planAssignments_sameInput_sameOutput", () => {
    const input = plannerInput({ entries, availability, members, soloCasterIds: new Set([3]) });

    expect(planAssignments(input)).toEqual(planAssignments(input));
  });

  it("planAssignments_shuffledInputOrder_sameOutput", () => {
    const ordered = plannerInput({ entries, availability, members, soloCasterIds: new Set([3]) });
    const shuffled = plannerInput({
      entries: [...entries].reverse(),
      availability: [...availability].reverse(),
      members,
      soloCasterIds: new Set([3]),
    });

    expect(planAssignments(shuffled)).toEqual(planAssignments(ordered));
  });
});
