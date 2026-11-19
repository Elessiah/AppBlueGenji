import { describe, expect, it } from "@jest/globals";
import type { PlanningRole } from "@/lib/shared/planning";
import { planAssignments, rolesConflict, slotsOverlap, type PlannerStats } from "@/lib/shared/planning-planner";
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

// Bornes du travail d'un lot de 120 matchs : environ deux fois la valeur mesurée
// (une régression de quelques fois se voit, une variation du calcul non).
const TRIALS_BOUND_120 = 18_000;
const CHECKS_BOUND_120 = 80_000;
const TRIALS_BOUND_120_CROWDED = 60_000;
const CHECKS_BOUND_120_CROWDED = 200_000;
const TRIALS_BOUND_CLUSTERED_300 = 2_000;
const CHECKS_BOUND_CLUSTERED_300 = 1_500_000;

/** Lot de `size` matchs, quatre par soir ; `crowded` : chacun préfère les 20 mêmes dernières entrées (pire cas des échanges). */
function batchInput(size: number, shape: "spread" | "crowded" | "clustered") {
  // `clustered` : une ronde de tableau lance 32 matchs au même instant (tous se chevauchent).
  const entries = Array.from({ length: size }, (_, i) =>
    shape === "clustered"
      ? plannerEntry(`m:${i}`, Math.floor(i / 32) * 3 + 18, { endAt: MONDAY + (Math.floor(i / 32) * 3 + 20) * HOUR_MS })
      : plannerEntry(`m:${i}`, Math.floor(i / 4) * 24 + 18 + (i % 4) * 1.5, {
      endAt: MONDAY + (Math.floor(i / 4) * 24 + 18 + (i % 4) * 1.5 + 2) * HOUR_MS,
    }),
  );
  const roles: PlanningRole[][] = [REFEREE, CASTER, PROD, ["REFEREE", "CASTER"], ["CASTER", "PROD"]];
  const members = new Map<number, PlanningRole[]>(Array.from({ length: 25 }, (_, u) => [u + 1, roles[u % roles.length]]));
  const availability = entries.flatMap((entry, i) =>
    [...members].flatMap(([userId, held]) => {
      if (shape === "clustered") return held.map((role) => available(entry.key, userId, role, { preferred: (i * 7 + userId) % 11 === 0 }));
      if (shape === "crowded") return held.map((role) => available(entry.key, userId, role, { preferred: i >= size - 20 }));
      return (i + userId) % 3 === 0
        ? []
        : held.map((role) => available(entry.key, userId, role, { preferred: (i * 7 + userId) % 11 === 0 }));
    }),
  );
  return plannerInput({ entries, availability, members, soloCasterIds: new Set([2, 7]) });
}

function emptyStats(): PlannerStats {
  return { passes: 0, trials: 0, checks: 0 };
}

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

describe("planAssignments — amélioration globale", () => {
  it("planAssignments_overlappingEntriesCrossedPreferences_swapServesBoth", () => {
    // 1 veut A et B, 2 ne veut que A : la construction donne A à 1 (identifiant le
    // plus bas), B à 2 ; aucun remplacement seul ne passe (chevauchement), l'échange oui.
    const input = plannerInput({
      entries: [plannerEntry("m:a", 20, { endAt: MONDAY + 22 * HOUR_MS }), plannerEntry("m:b", 21)],
      availability: [
        available("m:a", 1, "REFEREE", { preferred: true }),
        available("m:b", 1, "REFEREE", { preferred: true }),
        available("m:a", 2, "REFEREE", { preferred: true }),
        available("m:b", 2, "REFEREE"),
      ],
      members: new Map([
        [1, REFEREE],
        [2, REFEREE],
      ]),
    });

    const result = planAssignments(input);

    expect(result.map(({ entryKey, userId, reason }) => ({ entryKey, userId, reason }))).toEqual([
      { entryKey: "m:a", userId: 2, reason: "PREFERENCE" },
      { entryKey: "m:b", userId: 1, reason: "PREFERENCE" },
    ]);
  });

  it("planAssignments_swapWouldDropStream_notSwapped", () => {
    // B d'abord (20 h) : seul 1 (autonome) le diffuse ; A (21 h, chevauche B) va à 2,
    // pas autonome, avec le prod 3. 2 préfère B, mais l'échange laisserait B sans
    // diffusion (2 sans prod) : refusé.
    const input = plannerInput({
      entries: [plannerEntry("m:b", 20, { endAt: MONDAY + 22 * HOUR_MS }), plannerEntry("m:a", 21)],
      availability: [
        available("m:a", 1, "CASTER"),
        available("m:b", 1, "CASTER"),
        available("m:a", 2, "CASTER"),
        available("m:b", 2, "CASTER", { preferred: true }),
        available("m:a", 3, "PROD"),
      ],
      members: new Map<number, PlanningRole[]>([
        [1, CASTER],
        [2, CASTER],
        [3, PROD],
      ]),
      soloCasterIds: new Set([1]),
    });

    const result = picks(planAssignments(input));

    expect(result).toEqual([
      { entryKey: "m:b", userId: 1, role: "CASTER" },
      { entryKey: "m:a", userId: 2, role: "CASTER" },
      { entryKey: "m:a", userId: 3, role: "PROD" },
    ]);
  });

  it("planAssignments_monthBatch120Entries_workBounded", () => {
    const stats = emptyStats();

    const result = planAssignments(batchInput(120, "spread"), stats);

    expect(result.length).toBeGreaterThan(120);
    expect(stats.passes).toBeGreaterThan(0);
    expect(stats.trials).toBeLessThan(TRIALS_BOUND_120);
    expect(stats.checks).toBeLessThan(CHECKS_BOUND_120);
  });

  it("planAssignments_everyonePrefersTheSameFewEntries_workBounded", () => {
    const stats = emptyStats();

    planAssignments(batchInput(120, "crowded"), stats);

    expect(stats.trials).toBeLessThan(TRIALS_BOUND_120_CROWDED);
    expect(stats.checks).toBeLessThan(CHECKS_BOUND_120_CROWDED);
  });

  it("planAssignments_roundsOf32SimultaneousMatches_workBounded", () => {
    const stats = emptyStats();

    planAssignments(batchInput(300, "clustered"), stats);

    // Mesuré : environ 735 000 vérifications et 850 essais pour 300 entrées par rondes de 32 ; les bornes en gardent environ le double.
    expect(stats.trials).toBeLessThan(TRIALS_BOUND_CLUSTERED_300);
    expect(stats.checks).toBeLessThan(CHECKS_BOUND_CLUSTERED_300);
  });

  it("planAssignments_doublingTheBatch_workGrowsAboutLinearly", () => {
    // Un coût quadratique quadruplerait en doublant le lot : on tolère moins de trois fois.
    for (const shape of ["spread", "crowded", "clustered"] as const) {
      const half = emptyStats();
      const full = emptyStats();

      planAssignments(batchInput(60, shape), half);
      planAssignments(batchInput(120, shape), full);

      expect(full.trials + full.checks).toBeLessThan(3 * (half.trials + half.checks));
    }
  });

  it("planAssignments_historyWeek_lockedWorkOfEarlierBatchWeekTipsFairness", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:w1", 20), plannerEntry("m:w1b", 22), plannerEntry("m:w2", 7 * 24 + 20)],
      availability: [available("m:w2", 1, "REFEREE"), available("m:w2", 2, "REFEREE")],
      members: new Map([
        [1, REFEREE],
        [2, REFEREE],
      ]),
      locked: [
        { entryKey: "m:w1", userId: 1, role: "REFEREE", reason: "MANUAL" },
        { entryKey: "m:w1b", userId: 1, role: "REFEREE", reason: "MANUAL" },
      ],
      history: new Map([[2, 1]]),
      historyWeek: MONDAY,
    });

    const result = planAssignments(input);

    expect(result).toEqual([expect.objectContaining({ entryKey: "m:w2", userId: 2, historyLoad: 1 })]);
  });

  it("planAssignments_historyWeek_provisionalProposalsOfEarlierWeekIgnored", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:w1", 20), plannerEntry("m:w1b", 22), plannerEntry("m:w2", 7 * 24 + 20)],
      availability: [available("m:w2", 1, "REFEREE"), available("m:w2", 2, "REFEREE")],
      members: new Map([
        [1, REFEREE],
        [2, REFEREE],
      ]),
      locked: [
        { entryKey: "m:w1", userId: 1, role: "REFEREE", reason: "LOAD", provisional: true },
        { entryKey: "m:w1b", userId: 1, role: "REFEREE", reason: "LOAD", provisional: true },
      ],
      history: new Map([[2, 1]]),
      historyWeek: MONDAY,
    });

    const result = planAssignments(input);

    expect(result).toEqual([expect.objectContaining({ entryKey: "m:w2", userId: 1, historyLoad: 0 })]);
  });

  it("planAssignments_noHistoryWeek_earlierWeeksIgnored", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:w1", 20), plannerEntry("m:w1b", 22), plannerEntry("m:w2", 7 * 24 + 20)],
      availability: [available("m:w2", 1, "REFEREE"), available("m:w2", 2, "REFEREE")],
      members: new Map([
        [1, REFEREE],
        [2, REFEREE],
      ]),
      locked: [
        { entryKey: "m:w1", userId: 1, role: "REFEREE", reason: "MANUAL" },
        { entryKey: "m:w1b", userId: 1, role: "REFEREE", reason: "MANUAL" },
      ],
      history: new Map([[2, 1]]),
    });

    const result = planAssignments(input);

    expect(result).toEqual([expect.objectContaining({ entryKey: "m:w2", userId: 1, historyLoad: 0 })]);
  });

  it("planAssignments_mondayEarlyParisTime_sameWeekAsMondayEvening", () => {
    // Lundi 00:30 et lundi 20:00 à Paris : même semaine, la charge les cumule.
    const input = plannerInput({
      entries: [
        { key: "m:early", startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + HOUR_MS, open: true },
        plannerEntry("m:late", 20),
      ],
      availability: [available("m:early", 1, "REFEREE"), available("m:late", 1, "REFEREE")],
      members: new Map([[1, REFEREE]]),
    });

    const result = planAssignments(input);

    expect(result.map((row) => row.weekLoad)).toEqual([2, 2]);
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

describe("planAssignments — second caster", () => {
  it("planAssignments_twoCastersAvailable_secondCasterAfterFirst", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "CASTER"), available("m:1", 2, "CASTER"), available("m:1", 3, "PROD")],
      members: new Map([[1, CASTER], [2, CASTER], [3, PROD]]),
    });

    const result = planAssignments(input);

    expect(picks(result)).toEqual([
      { entryKey: "m:1", userId: 1, role: "CASTER" },
      { entryKey: "m:1", userId: 2, role: "CASTER" },
      { entryKey: "m:1", userId: 3, role: "PROD" },
    ]);
  });

  it("planAssignments_threeCastersAvailable_cappedAtTwo", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [1, 2, 3].map((userId) => available("m:1", userId, "CASTER")),
      members: new Map([[1, CASTER], [2, CASTER], [3, CASTER]]),
      soloCasterIds: new Set([1, 2, 3]),
    });

    const result = planAssignments(input);

    expect(result.filter((row) => row.role === "CASTER")).toHaveLength(2);
  });

  it("planAssignments_overlappingEntryNeedsCaster_casterNotTakenAsSpare", () => {
    // Le caster 2 peut couvrir m:1 et m:2 (qui se chevauchent) ; le caster 1, m:1 seulement.
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20)],
      availability: [available("m:1", 1, "CASTER"), available("m:1", 2, "CASTER"), available("m:2", 2, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER]]),
      soloCasterIds: new Set([1, 2]),
    });

    const result = planAssignments(input);

    expect(picks(result)).toEqual([
      { entryKey: "m:1", userId: 1, role: "CASTER" },
      { entryKey: "m:2", userId: 2, role: "CASTER" },
    ]);
  });

  it("planAssignments_overlappingEntryOutsideBatchNeedsCaster_casterNotTakenAsSpare", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20, { open: false })],
      availability: [available("m:1", 1, "CASTER"), available("m:1", 2, "CASTER"), available("m:2", 2, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER]]),
      soloCasterIds: new Set([1, 2]),
      locked: [{ entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" }],
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_spareCasterPrefersEntry_placedThere", () => {
    // Deux entrées qui se chevauchent, chacune avec son caster : le renfort va à celle qu'il préfère.
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20)],
      availability: [
        available("m:1", 3, "CASTER"),
        available("m:2", 3, "CASTER", { preferred: true }),
      ],
      members: new Map([[1, CASTER], [2, CASTER], [3, CASTER]]),
      soloCasterIds: new Set([1, 2, 3]),
      locked: [
        { entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" },
        { entryKey: "m:2", userId: 2, role: "CASTER", reason: "MANUAL" },
      ],
    });

    const result = planAssignments(input);

    expect(result).toEqual([{ entryKey: "m:2", userId: 3, role: "CASTER", reason: "PREFERENCE", weekLoad: 1, historyLoad: 0 }]);
  });

  it("planAssignments_unstreamedEntry_soloSpareChosenOverLighterCaster", () => {
    // Le caster 1 (verrouillé) attend un prod ; 2 n'a rien fait, 3 (autonome) a déjà travaillé.
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 2, "CASTER"), available("m:1", 3, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER], [3, CASTER]]),
      soloCasterIds: new Set([3]),
      locked: [{ entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" }],
      history: new Map([[3, 5]]),
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:1", userId: 3, role: "CASTER" }]);
  });

  it("planAssignments_spareCastersFalse_noSecondCaster", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "CASTER"), available("m:1", 2, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER]]),
      soloCasterIds: new Set([1, 2]),
      spareCasters: false,
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:1", userId: 1, role: "CASTER" }]);
  });

  it("planAssignments_spareCandidateAlreadyRefereeOnEntry_notAddedAsSpare", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 2, "CASTER")],
      members: new Map<number, PlanningRole[]>([[1, CASTER], [2, ["REFEREE", "CASTER"]]]),
      soloCasterIds: new Set([1, 2]),
      locked: [
        { entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" },
        { entryKey: "m:1", userId: 2, role: "REFEREE", reason: "MANUAL" },
      ],
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_twoLockedCasters_noSpareAdded", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 3, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER], [3, CASTER]]),
      soloCasterIds: new Set([3]),
      locked: [
        { entryKey: "m:1", userId: 1, role: "CASTER", reason: "CAST" },
        { entryKey: "m:1", userId: 2, role: "CASTER", reason: "MANUAL" },
      ],
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_nonSoloCastersWithoutProd_noCasterAtAll", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20)],
      availability: [available("m:1", 1, "CASTER"), available("m:1", 2, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER]]),
    });

    expect(planAssignments(input)).toEqual([]);
  });
});

describe("planAssignments — renfort attendu ailleurs", () => {
  const CASTER_PROD: PlanningRole[] = ["CASTER", "PROD"];
  const CASTER_REFEREE: PlanningRole[] = ["CASTER", "REFEREE"];

  it("planAssignments_overlappingEntryNeedsProdFromDualRoleMember_notTakenAsSpare", () => {
    // m:2 (autre lot) a son caster 3 mais pas de prod ; 2, caster et prod, y est disponible comme prod.
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20, { open: false })],
      availability: [available("m:1", 2, "CASTER"), available("m:2", 2, "PROD")],
      members: new Map([[1, CASTER], [2, CASTER_PROD], [3, CASTER]]),
      soloCasterIds: new Set([1]),
      locked: [
        { entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" },
        { entryKey: "m:2", userId: 3, role: "CASTER", reason: "MANUAL" },
      ],
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_overlappingEntryNeedsReferee_notTakenAsSpare", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20, { open: false })],
      availability: [available("m:1", 2, "CASTER"), available("m:2", 2, "REFEREE")],
      members: new Map([[1, CASTER], [2, CASTER_REFEREE], [3, CASTER], [4, PROD]]),
      soloCasterIds: new Set([1, 3]),
      locked: [
        { entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" },
        { entryKey: "m:2", userId: 3, role: "CASTER", reason: "MANUAL" },
        { entryKey: "m:2", userId: 4, role: "PROD", reason: "MANUAL" },
      ],
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_overlappingEntryNotFillable_spareStillPlaced", () => {
    // m:2, commencée, n'attend plus personne : elle ne retient pas le renfort.
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20, { open: false, fillable: false })],
      availability: [available("m:1", 2, "CASTER"), available("m:2", 2, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER]]),
      soloCasterIds: new Set([1, 2]),
      locked: [{ entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" }],
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:1", userId: 2, role: "CASTER" }]);
  });

  it("planAssignments_overlappingEntryWithoutCasterNeedsProd_dualRoleSpareStillPlaced", () => {
    // m:2 n'a pas de caster : un prod n'y servirait à rien, 2 reste libre pour m:1.
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20, { open: false })],
      availability: [available("m:1", 2, "CASTER"), available("m:2", 2, "PROD")],
      members: new Map([[1, CASTER], [2, CASTER_PROD]]),
      soloCasterIds: new Set([1]),
      locked: [{ entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" }],
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:1", userId: 2, role: "CASTER" }]);
  });

  it("planAssignments_overlappingEntryStreamedBySoloCaster_dualRoleSpareStillPlaced", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20), plannerEntry("m:2", 20, { open: false })],
      availability: [available("m:1", 2, "CASTER"), available("m:2", 2, "PROD")],
      members: new Map([[1, CASTER], [2, CASTER_PROD], [3, CASTER]]),
      soloCasterIds: new Set([1, 3]),
      locked: [
        { entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" },
        { entryKey: "m:2", userId: 3, role: "CASTER", reason: "MANUAL" },
      ],
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:1", userId: 2, role: "CASTER" }]);
  });

  it("planAssignments_restoreStreamEntry_soloCasterNeededElsewherePicked", () => {
    // 1 (non autonome) attend son prod sur m:1 ; 2, autonome, est aussi disponible sur m:2 qui n'a pas de caster.
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20, { spareOnly: true, restoreStream: true }), plannerEntry("m:2", 20, { open: false })],
      availability: [available("m:1", 2, "CASTER"), available("m:2", 2, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER]]),
      soloCasterIds: new Set([2]),
      locked: [{ entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" }],
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:1", userId: 2, role: "CASTER" }]);
  });

  it("planAssignments_restoreStreamEntry_nonSoloCandidateRejected", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20, { spareOnly: true, restoreStream: true })],
      availability: [available("m:1", 2, "CASTER")],
      members: new Map([[1, CASTER], [2, CASTER]]),
      soloCasterIds: new Set(),
      locked: [{ entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" }],
    });

    expect(planAssignments(input)).toEqual([]);
  });

  it("planAssignments_spareOnlyEntry_onlySpareCasterPlaced", () => {
    const input = plannerInput({
      entries: [plannerEntry("m:1", 20, { spareOnly: true })],
      availability: [available("m:1", 2, "CASTER"), available("m:1", 3, "PROD")],
      members: new Map([[1, CASTER], [2, CASTER], [3, PROD]]),
      locked: [{ entryKey: "m:1", userId: 1, role: "CASTER", reason: "MANUAL" }],
    });

    expect(picks(planAssignments(input))).toEqual([{ entryKey: "m:1", userId: 2, role: "CASTER" }]);
  });
});
