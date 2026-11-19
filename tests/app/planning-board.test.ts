import { describe, expect, it } from "@jest/globals";
import {
  applyAvailability,
  candidatesFor,
  canWithdraw,
  COVERAGE_PILL,
  errorKey,
  filterEntries,
  filtersActive,
  groupByDay,
  groupByWeek,
  hasProvisional,
  isPastEntry,
  planningOpenKey,
  newestFirst,
  splitPast,
  heldBy,
  isThrottled,
  leadUntil,
  mergeView,
  needsCover,
  NO_FILTERS,
  castersFullKind,
  withdrawBodyKey,
  withdrawDoneKey,
  roleChoices,
  tournamentChoices,
  weekWindow,
} from "@/app/(secured)/planning/_lib/planning-board";
import { PLANNING_STATUSES } from "@/lib/server/planning/actions";
import enPlanning from "@/messages/en/planning.json";
import frPlanning from "@/messages/fr/planning.json";
import FR_PUSH from "@/messages/fr/pushMessages.json";
import { DEFAULT_PLANNING_DURATIONS } from "@/lib/shared/planning-durations";
import type { PlanningMember, PlanningView } from "@/lib/shared/planning-view";
import { fieldForError } from "@/lib/shared/field-errors";
import { planningCoverage, WITHDRAWAL_FIELD_ERRORS } from "@/lib/shared/planning";
import { entryView, HOUR_MS, MONDAY } from "../helpers/planning";

/** Logique pure de l'écran « Planning » et ses textes de refus (`CAST_PLANNING.md` § Interface). */

const WEEK_MS = 7 * 24 * HOUR_MS;
const iso = (ms: number) => new Date(ms).toISOString();

function member(overrides: Partial<PlanningMember> = {}): PlanningMember {
  return { userId: 1, pseudo: "Membre", roles: ["CASTER"], soloCaster: false, ...overrides };
}

describe("groupByWeek", () => {
  it("groupByWeek_entriesAcrossWeeks_groupedChronologically", () => {
    const later = entryView({ key: "m:3", startAt: iso(MONDAY + WEEK_MS + HOUR_MS) });
    const second = entryView({ key: "m:2", startAt: iso(MONDAY + 30 * HOUR_MS) });
    const first = entryView({ key: "m:1", startAt: iso(MONDAY + HOUR_MS) });

    const weeks = groupByWeek([later, second, first]);

    expect(weeks.map((week) => [week.weekStart, week.entries.map((entry) => entry.key)])).toEqual([
      [MONDAY, ["m:1", "m:2"]],
      [MONDAY + WEEK_MS, ["m:3"]],
    ]);
  });
});

describe("hasProvisional", () => {
  it("hasProvisional_provisionalRow_true", () => {
    const entry = entryView({ assignments: [{ userId: 1, role: "CASTER", source: "AUTO", reason: "LOAD", provisional: true }] });
    expect(hasProvisional(entry)).toBe(true);
  });

  it("hasProvisional_onlyConfirmed_false", () => {
    const entry = entryView({ assignments: [{ userId: 1, role: "CASTER", source: "MANUAL", reason: "MANUAL", provisional: false }] });
    expect(hasProvisional(entry)).toBe(false);
  });
});

describe("candidatesFor", () => {
  it("candidatesFor_ordersAvailablePreferredFirst_excludesTakenAndRoleless", () => {
    const entry = entryView({
      assignments: [{ userId: 5, role: "CASTER", source: "AUTO", reason: "LOAD", provisional: true }],
      availability: [
        { userId: 1, role: "CASTER", status: "UNAVAILABLE", preferred: false },
        { userId: 2, role: "CASTER", status: "AVAILABLE", preferred: false },
        { userId: 3, role: "CASTER", status: "AVAILABLE", preferred: true },
        { userId: 4, role: "CASTER", status: "PENDING", preferred: false },
      ],
    });
    const members = [
      member({ userId: 1, pseudo: "Absent" }),
      member({ userId: 2, pseudo: "Bea" }),
      member({ userId: 3, pseudo: "Zed" }),
      member({ userId: 4, pseudo: "Avoir" }),
      member({ userId: 5, pseudo: "Pris" }),
      member({ userId: 6, pseudo: "Muet" }),
      member({ userId: 7, pseudo: "Arbitre", roles: ["REFEREE"] }),
    ];

    const result = candidatesFor(entry, "CASTER", members);

    expect(result.map((row) => [row.member.userId, row.status, row.preferred])).toEqual([
      [3, "AVAILABLE", true],
      [2, "AVAILABLE", false],
      [4, "PENDING", false],
      [6, null, false],
      [1, "UNAVAILABLE", false],
    ]);
  });
  it("candidatesFor_hiddenEntry_excludesMembersNotSeeingHidden", () => {
    const members = [member({ userId: 1, seesHidden: false }), member({ userId: 2, seesHidden: true })];

    const result = candidatesFor(entryView({ hidden: true }), "CASTER", members);

    expect(result.map((row) => row.member.userId)).toEqual([2]);
  });

  it("candidatesFor_visibleEntry_keepsMembersNotSeeingHidden", () => {
    const result = candidatesFor(entryView({ hidden: false }), "CASTER", [member({ userId: 1, seesHidden: false })]);

    expect(result.map((row) => row.member.userId)).toEqual([1]);
  });

  it("candidatesFor_memberProdOnEntry_excludedFromCasterButKeptForReferee", () => {
    const entry = entryView({ assignments: [{ userId: 4, role: "PROD", source: "MANUAL", reason: "MANUAL", provisional: false }] });
    const members = [member({ userId: 4, pseudo: "Double", roles: ["CASTER", "PROD", "REFEREE"] })];

    expect(candidatesFor(entry, "CASTER", members)).toEqual([]);
    expect(candidatesFor(entry, "REFEREE", members).map((row) => row.member.userId)).toEqual([4]);
  });
});

describe("errorKey / weekWindow / leadUntil / COVERAGE_PILL", () => {
  it("errorKey_rateLimited_ownTextInBothLanguages", () => {
    expect(errorKey("TOO_MANY_REQUESTS", frPlanning.errors)).toBe("TOO_MANY_REQUESTS");
    expect(errorKey("TOO_MANY_REQUESTS", enPlanning.errors)).toBe("TOO_MANY_REQUESTS");
  });

  it("errorKey_known_returnsCode", () => {
    expect(errorKey("PLANNING_BUSY", { PLANNING_BUSY: "x" })).toBe("PLANNING_BUSY");
  });

  it("errorKey_unknown_returnsGeneric", () => {
    expect(errorKey("WHATEVER", { PLANNING_BUSY: "x" })).toBe("generic");
  });

  it("errorKey_null_returnsGeneric", () => {
    expect(errorKey(null, { PLANNING_BUSY: "x" })).toBe("generic");
  });

  it("weekWindow_returnsMondayToNextMonday", () => {
    expect(weekWindow(MONDAY)).toEqual({ from: "2026-11-22T23:00:00.000Z", to: "2026-11-29T23:00:00.000Z" });
  });

  it("weekWindow_acrossDstChange_endsAtNextParisMonday", () => {
    // Semaine du 26 octobre 2026 (passage à l'heure d'hiver le 25) : la précédente dure 7 j + 1 h.
    const summerMonday = Date.UTC(2026, 9, 18, 22);
    expect(weekWindow(summerMonday)).toEqual({ from: "2026-10-18T22:00:00.000Z", to: "2026-10-25T23:00:00.000Z" });
  });

  it("leadUntil_addsHours", () => {
    expect(leadUntil(MONDAY, 48)).toBe("2026-11-24T23:00:00.000Z");
  });

  it("COVERAGE_PILL_neverWarning", () => {
    expect(Object.values(COVERAGE_PILL)).not.toContain("warning");
  });
});

describe("textes de refus du planning", () => {
  /**
   * Tout refus qu'un geste de l'écran peut rencontrer a son texte. Les autres
   * codes (corps forgé à la main, panne du serveur) tombent sur `generic` :
   * l'écran n'envoie jamais ces corps-là.
   */
  const ROUTE_CODES = [...Object.keys(PLANNING_STATUSES), "INVALID_WINDOW", "INVALID_CONFIRM_SCOPE", "INVALID_DURATIONS", "generic"];

  it("planningErrors_everyRouteCode_hasFrenchText", () => {
    expect(ROUTE_CODES.filter((code) => !Object.hasOwn(frPlanning.errors, code))).toEqual([]);
  });

  it("planningErrors_everyRouteCode_hasEnglishText", () => {
    expect(ROUTE_CODES.filter((code) => !Object.hasOwn(enPlanning.errors, code))).toEqual([]);
  });
});

function covered(input: { hasReferee?: boolean; casterIds?: number[]; prodIds?: number[]; soloCasterIds?: number[] }) {
  return planningCoverage({
    hasReferee: input.hasReferee ?? false,
    casterIds: input.casterIds ?? [],
    prodIds: input.prodIds ?? [],
    soloCasterIds: new Set(input.soloCasterIds ?? []),
  });
}

function assigned(userId: number, provisional = false) {
  return { userId, role: "REFEREE" as const, source: "AUTO" as const, reason: "LOAD" as const, provisional };
}

describe("isThrottled", () => {
  it("isThrottled_tooManyRequestsError_returnsTrue", () => {
    expect(isThrottled(new Error("TOO_MANY_REQUESTS"))).toBe(true);
  });

  it("isThrottled_otherError_returnsFalse", () => {
    expect(isThrottled(new Error("PLANNING_BUSY"))).toBe(false);
  });

  it("isThrottled_nonErrorValue_returnsFalse", () => {
    expect(isThrottled("TOO_MANY_REQUESTS")).toBe(false);
  });
});

describe("groupByDay", () => {
  it("groupByDay_sameDayEntries_oneGroup", () => {
    const first = entryView({ key: "m:1", startAt: iso(MONDAY + HOUR_MS) });
    const second = entryView({ key: "m:2", startAt: iso(MONDAY + 22 * HOUR_MS) });

    const days = groupByDay([first, second]);

    expect(days.map((day) => [day.dayStart, day.entries.map((entry) => entry.key)])).toEqual([[MONDAY, ["m:1", "m:2"]]]);
  });

  it("groupByDay_lateEveningAndNextMorning_splitAtParisMidnight", () => {
    const evening = entryView({ key: "m:1", startAt: iso(MONDAY + 23.5 * HOUR_MS) });
    const morning = entryView({ key: "m:2", startAt: iso(MONDAY + 24.5 * HOUR_MS) });

    const days = groupByDay([evening, morning]);

    expect(days.map((day) => day.dayStart)).toEqual([MONDAY, MONDAY + 24 * HOUR_MS]);
  });

  it("groupByWeek_entries_carryTheirDays", () => {
    const monday = entryView({ key: "m:1", startAt: iso(MONDAY + HOUR_MS) });
    const tuesday = entryView({ key: "m:2", startAt: iso(MONDAY + 30 * HOUR_MS) });

    const [week] = groupByWeek([tuesday, monday]);

    expect(week.days.map((day) => day.entries.map((entry) => entry.key))).toEqual([["m:1"], ["m:2"]]);
  });
});

describe("heldBy", () => {
  it("heldBy_confirmedAssignment_true", () => {
    expect(heldBy(entryView({ assignments: [assigned(7)] }), 7)).toBe(true);
  });

  it("heldBy_provisionalAssignment_true", () => {
    expect(heldBy(entryView({ assignments: [assigned(7, true)] }), 7)).toBe(true);
  });

  it("heldBy_someoneElse_false", () => {
    expect(heldBy(entryView({ assignments: [assigned(8)] }), 7)).toBe(false);
  });
});

describe("needsCover", () => {
  it("needsCover_nobodyOnOpenEntry_true", () => {
    expect(needsCover(entryView())).toBe(true);
  });

  it("needsCover_refereeOnly_true", () => {
    expect(needsCover(entryView({ coverage: covered({ hasReferee: true }) }))).toBe(true);
  });

  it("needsCover_casterWithoutProd_true", () => {
    expect(needsCover(entryView({ coverage: covered({ hasReferee: true, casterIds: [1] }) }))).toBe(true);
  });

  it("needsCover_streamedWithoutReferee_true", () => {
    expect(needsCover(entryView({ coverage: covered({ casterIds: [1], prodIds: [2] }) }))).toBe(true);
  });

  it("needsCover_complete_false", () => {
    expect(needsCover(entryView({ coverage: covered({ hasReferee: true, casterIds: [1], prodIds: [2] }) }))).toBe(false);
  });

  it("needsCover_soloCasterWithReferee_false", () => {
    expect(needsCover(entryView({ coverage: covered({ hasReferee: true, casterIds: [1], soloCasterIds: [1] }) }))).toBe(false);
  });

  it("needsCover_closedEntry_false", () => {
    expect(needsCover(entryView({ open: false }))).toBe(false);
  });

  it("needsCover_deliberateSelfManagement_false", () => {
    expect(needsCover(entryView({ selfManaged: true }))).toBe(false);
  });
});

describe("filterEntries", () => {
  const mineOpen = entryView({ key: "m:1", tournamentId: 10, assignments: [assigned(7)] });
  const otherCovered = entryView({
    key: "m:2",
    tournamentId: 20,
    coverage: covered({ hasReferee: true, casterIds: [1], prodIds: [2] }),
  });
  const otherOpen = entryView({ key: "m:3", tournamentId: 20 });
  const all = [mineOpen, otherCovered, otherOpen];
  const keys = (entries: readonly { key: string }[]) => entries.map((entry) => entry.key);

  it("filterEntries_noFilter_everyEntry", () => {
    expect(keys(filterEntries(all, NO_FILTERS, 7))).toEqual(["m:1", "m:2", "m:3"]);
  });

  it("filterEntries_mine_onlyHeldSlots", () => {
    expect(keys(filterEntries(all, { ...NO_FILTERS, mine: true }, 7))).toEqual(["m:1"]);
  });

  it("filterEntries_uncovered_onlySlotsMissingSomeone", () => {
    expect(keys(filterEntries(all, { ...NO_FILTERS, uncovered: true }, 7))).toEqual(["m:1", "m:3"]);
  });

  it("filterEntries_tournament_onlyThatTournament", () => {
    expect(keys(filterEntries(all, { ...NO_FILTERS, tournamentId: 20 }, 7))).toEqual(["m:2", "m:3"]);
  });

  it("filterEntries_allFiltersCombined_intersection", () => {
    expect(keys(filterEntries(all, { mine: false, uncovered: true, tournamentId: 20 }, 7))).toEqual(["m:3"]);
  });

  it("filterEntries_noMatch_empty", () => {
    expect(filterEntries(all, { ...NO_FILTERS, mine: true }, 99)).toEqual([]);
  });
});

describe("tournamentChoices", () => {
  it("tournamentChoices_repeatedTournaments_uniqueSortedByName", () => {
    const entries = [
      entryView({ key: "m:1", tournamentId: 2, tournamentName: "Zeta" }),
      entryView({ key: "m:2", tournamentId: 1, tournamentName: "Alpha" }),
      entryView({ key: "m:3", tournamentId: 2, tournamentName: "Zeta" }),
    ];

    expect(tournamentChoices(entries)).toEqual([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Zeta" },
    ]);
  });

  it("tournamentChoices_noEntries_empty", () => {
    expect(tournamentChoices([])).toEqual([]);
  });
});

describe("filtersActive", () => {
  it("filtersActive_defaults_false", () => {
    expect(filtersActive(NO_FILTERS)).toBe(false);
  });

  it("filtersActive_mine_true", () => {
    expect(filtersActive({ ...NO_FILTERS, mine: true })).toBe(true);
  });

  it("filtersActive_uncovered_true", () => {
    expect(filtersActive({ ...NO_FILTERS, uncovered: true })).toBe(true);
  });

  it("filtersActive_tournament_true", () => {
    expect(filtersActive({ ...NO_FILTERS, tournamentId: 3 })).toBe(true);
  });
});

function viewOf(overrides: Partial<PlanningView> = {}): PlanningView {
  return {
    me: 1,
    myRoles: ["CASTER"],
    canManage: false,
    canCompute: false,
    entries: [entryView({ key: "m:1" }), entryView({ key: "m:2", matchId: 2 })],
    members: [member()],
    durations: DEFAULT_PLANNING_DURATIONS,
    ...overrides,
  };
}

describe("applyAvailability", () => {
  it("applyAvailability_newAnswer_addedToMineOnly_whenNotManager", () => {
    const view = viewOf();

    const next = applyAvailability(view, { entryKey: "m:1", role: "CASTER", status: "AVAILABLE", preferred: true });

    expect(next.entries[0].mine).toEqual([{ userId: 1, role: "CASTER", status: "AVAILABLE", preferred: true }]);
    expect(next.entries[0].availability).toEqual([]);
  });

  it("applyAvailability_existingAnswer_replacedNotDuplicated", () => {
    const row = { userId: 1, role: "CASTER" as const, status: "PENDING" as const, preferred: false };
    const view = viewOf({ entries: [entryView({ key: "m:1", mine: [row] })] });

    const next = applyAvailability(view, { entryKey: "m:1", role: "CASTER", status: "UNAVAILABLE", preferred: false });

    expect(next.entries[0].mine).toEqual([{ ...row, status: "UNAVAILABLE" }]);
  });

  it("applyAvailability_otherRoleAndOtherUser_kept", () => {
    const others = [
      { userId: 1, role: "PROD" as const, status: "AVAILABLE" as const, preferred: false },
      { userId: 2, role: "CASTER" as const, status: "AVAILABLE" as const, preferred: false },
    ];
    const view = viewOf({ canManage: true, entries: [entryView({ key: "m:1", availability: others })] });

    const next = applyAvailability(view, { entryKey: "m:1", role: "CASTER", status: "PENDING", preferred: false });

    expect(next.entries[0].availability).toHaveLength(3);
    expect(next.entries[0].availability).toEqual(expect.arrayContaining(others));
  });

  it("applyAvailability_otherEntries_sameObjects", () => {
    const view = viewOf();

    const next = applyAvailability(view, { entryKey: "m:1", role: "CASTER", status: "AVAILABLE", preferred: false });

    expect(next.entries[1]).toBe(view.entries[1]);
    expect(next.members).toBe(view.members);
  });

  it("applyAvailability_unknownEntry_nothingChanges", () => {
    const view = viewOf();

    const next = applyAvailability(view, { entryKey: "m:99", role: "CASTER", status: "AVAILABLE", preferred: false });

    expect(next.entries.every((entry, index) => entry === view.entries[index])).toBe(true);
  });
});

describe("mergeView", () => {
  it("mergeView_noPrevious_returnsNext", () => {
    const next = viewOf();

    expect(mergeView(null, next)).toBe(next);
  });

  it("mergeView_identicalReread_keepsEveryObject", () => {
    const previous = viewOf();
    const next = structuredClone(previous);

    const merged = mergeView(previous, next);

    expect(merged.entries).toBe(previous.entries);
    expect(merged.members).toBe(previous.members);
    expect(merged.myRoles).toBe(previous.myRoles);
    expect(merged.durations).toBe(previous.durations);
  });

  it("mergeView_oneEntryChanged_onlyThatOneIsNew", () => {
    const previous = viewOf();
    const next = structuredClone(previous);
    next.entries[1].open = false;

    const merged = mergeView(previous, next);

    expect(merged.entries[0]).toBe(previous.entries[0]);
    expect(merged.entries[1]).toBe(next.entries[1]);
    expect(merged.entries[1].open).toBe(false);
  });

  it("mergeView_entryRemovedOrAdded_listFollowsNext", () => {
    const previous = viewOf();
    const next = structuredClone(previous);
    next.entries.pop();
    next.entries.push(entryView({ key: "m:3", matchId: 3 }));

    const merged = mergeView(previous, next);

    expect(merged.entries.map((entry) => entry.key)).toEqual(["m:1", "m:3"]);
    expect(merged.entries[0]).toBe(previous.entries[0]);
  });

  it("mergeView_membersChanged_newMembers", () => {
    const previous = viewOf();
    const next = structuredClone(previous);
    next.members[0].soloCaster = true;

    expect(mergeView(previous, next).members).toBe(next.members);
  });
});

describe("groupByWeek — identité des entrées", () => {
  it("groupByWeek_largeBatch_everyEntryGroupedOnceInOrder", () => {
    const entries = Array.from({ length: 600 }, (_, i) => entryView({ key: `m:${i}`, startAt: iso(MONDAY + (599 - i) * HOUR_MS) }));

    const weeks = groupByWeek(entries);

    const flat = weeks.flatMap((week) => week.entries.map((entry) => Date.parse(entry.startAt)));
    expect(flat).toHaveLength(600);
    expect(flat).toEqual([...flat].sort((a, b) => a - b));
    expect(weeks.reduce((sum, week) => sum + week.days.reduce((n, day) => n + day.entries.length, 0), 0)).toBe(600);
  });

  it("groupByWeek_sameEntriesTwice_sameGrouping", () => {
    const entries = [entryView({ key: "m:2", startAt: iso(MONDAY + WEEK_MS) }), entryView({ key: "m:1", startAt: iso(MONDAY) })];

    expect(groupByWeek(entries).map((week) => week.weekStart)).toEqual(groupByWeek(entries).map((week) => week.weekStart));
    expect(groupByWeek(entries)).toHaveLength(2);
  });
});

describe("désistement — refus rattaché au motif", () => {
  it("withdrawalFieldErrors_reasonTooLong_flagsReasonField", () => {
    expect(fieldForError("PLANNING_REASON_TOO_LONG", WITHDRAWAL_FIELD_ERRORS)).toBe("reason");
  });

  it("withdrawalFieldErrors_otherRefusal_flagsNoField", () => {
    expect(fieldForError("PLANNING_WITHDRAWAL_CLOSED", WITHDRAWAL_FIELD_ERRORS)).toBeNull();
  });

  it("withdrawalFieldErrors_mappedCode_hasTextInBothLanguages", () => {
    for (const code of Object.keys(WITHDRAWAL_FIELD_ERRORS)) {
      expect(Object.hasOwn(frPlanning.errors, code)).toBe(true);
      expect(Object.hasOwn(enPlanning.errors, code)).toBe(true);
    }
  });
});

describe("canWithdraw (bouton « Me désister »)", () => {
  const start = Date.parse("2026-11-20T18:00:00Z");

  it("canWithdraw_editableEntryBeforeStart_true", () => {
    expect(canWithdraw({ editable: true, startAt: new Date(start).toISOString() }, start - 1)).toBe(true);
  });

  it("canWithdraw_clockReachesStart_false", () => {
    expect(canWithdraw({ editable: true, startAt: new Date(start).toISOString() }, start)).toBe(false);
    expect(canWithdraw({ editable: true, startAt: new Date(start).toISOString() }, start + HOUR_MS)).toBe(false);
  });

  it("canWithdraw_notEditable_false", () => {
    expect(canWithdraw({ editable: false, startAt: new Date(start).toISOString() }, start - HOUR_MS)).toBe(false);
  });
});

describe("textes du désistement", () => {
  it("withdrawals_noUnusedItemKey_inBothLanguages", () => {
    expect(Object.hasOwn(frPlanning.withdrawals, "item")).toBe(false);
    expect(Object.hasOwn(enPlanning.withdrawals, "item")).toBe(false);
  });

  it("assignedPushTitle_french_isNotGendered", () => {
    expect(FR_PUSH.planning.assigned.title).not.toMatch(/Affecté/);
  });
});

describe("roleChoices", () => {
  const casters = [
    { userId: 1, role: "CASTER" as const, source: "MANUAL" as const, reason: "MANUAL" as const, provisional: false },
    { userId: 2, role: "CASTER" as const, source: "AUTO" as const, reason: "LOAD" as const, provisional: true },
  ];
  const members = [member({ userId: 1 }), member({ userId: 2 }), member({ userId: 3, pseudo: "Troisième" }), member({ userId: 4, roles: ["PROD"] })];

  it("roleChoices_twoCastersManager_fullNoCandidates", () => {
    const choices = roleChoices(entryView({ assignments: casters }), "CASTER", members, true);

    expect(choices).toEqual({ manage: true, full: true, candidates: [] });
  });

  it("roleChoices_oneCasterManager_candidatesListed", () => {
    const choices = roleChoices(entryView({ assignments: [casters[0]] }), "CASTER", members, true);

    expect(choices.full).toBe(false);
    expect(choices.candidates.map((row) => row.member.userId)).toEqual([2, 3]);
  });

  it("roleChoices_notManager_notFullNoCandidates", () => {
    const choices = roleChoices(entryView({ assignments: casters }), "CASTER", members, false);

    expect(choices).toEqual({ manage: false, full: false, candidates: [] });
  });

  it("roleChoices_closedEntryManager_notManaged", () => {
    const choices = roleChoices(entryView({ assignments: casters, editable: false }), "CASTER", members, true);

    expect(choices).toEqual({ manage: false, full: false, candidates: [] });
  });

  it("roleChoices_twoCastersProdRole_notFull", () => {
    const choices = roleChoices(entryView({ assignments: casters }), "PROD", members, true);

    expect(choices.full).toBe(false);
    expect(choices.candidates.map((row) => row.member.userId)).toEqual([4]);
  });
});

describe("castersFullKind", () => {
  const caster = (userId: number, source: "CAST" | "MANUAL" | "AUTO", provisional: boolean) => ({
    userId,
    role: "CASTER" as const,
    source,
    reason: "MANUAL" as const,
    provisional,
  });

  it("castersFullKind_onlyMatchCasters_returnsMatch", () => {
    expect(castersFullKind(entryView({ assignments: [caster(1, "CAST", false), caster(2, "CAST", false)] }))).toBe("castersFullMatch");
  });

  it("castersFullKind_onlyProvisionalRemovable_returnsProvisional", () => {
    expect(castersFullKind(entryView({ assignments: [caster(1, "CAST", false), caster(2, "AUTO", true)] }))).toBe("castersFullProvisional");
  });

  it("castersFullKind_confirmedRemovable_returnsPlain", () => {
    expect(castersFullKind(entryView({ assignments: [caster(1, "MANUAL", false), caster(2, "AUTO", true)] }))).toBe("castersFull");
  });

  it("castersFullKind_twoSignupsPlusManual_returnsMatch", () => {
    const assignments = [caster(1, "CAST", false), caster(2, "CAST", false), caster(3, "MANUAL", false)];

    expect(castersFullKind(entryView({ assignments }))).toBe("castersFullMatch");
  });

  it("castersFullKind_signupPushesTotalOverCap_returnsOver", () => {
    const assignments = [caster(1, "CAST", false), caster(2, "MANUAL", false), caster(3, "AUTO", true)];

    expect(castersFullKind(entryView({ assignments }))).toBe("castersFullOver");
  });

  it("castersFullKind_everyKind_hasFrAndEnText", () => {
    for (const kind of ["castersFull", "castersFullProvisional", "castersFullMatch", "castersFullOver"] as const) {
      expect(frPlanning.assignment[kind]).toBeTruthy();
      expect(enPlanning.assignment[kind]).toBeTruthy();
    }
  });
});

describe("withdrawBodyKey", () => {
  it("withdrawBodyKey_caster_returnsBodyCaster", () => {
    expect(withdrawBodyKey("CASTER")).toBe("withdraw.bodyCaster");
  });

  it("withdrawBodyKey_prod_returnsBody", () => {
    expect(withdrawBodyKey("PROD")).toBe("withdraw.body");
  });
});

describe("withdrawDoneKey", () => {
  it("withdrawDoneKey_stillSignedUp_returnsStillSignedUp", () => {
    expect(withdrawDoneKey({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: true })).toBe(
      "withdraw.doneStillSignedUp",
    );
    expect(frPlanning.withdraw.doneStillSignedUp).toBeTruthy();
    expect(enPlanning.withdraw.doneStillSignedUp).toBeTruthy();
  });

  it("withdrawDoneKey_replaced_returnsReplaced", () => {
    expect(withdrawDoneKey({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false })).toBe("withdraw.doneReplaced");
  });

  it("withdrawDoneKey_unfilledStreamLost_returnsStreamLost", () => {
    expect(withdrawDoneKey({ late: false, replaced: false, unfilled: true, streamLost: true, stillSignedUp: false })).toBe("withdraw.doneStreamLost");
  });

  it("withdrawDoneKey_unfilled_returnsUnfilled", () => {
    expect(withdrawDoneKey({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false })).toBe("withdraw.doneUnfilled");
  });

  it("withdrawDoneKey_held_returnsDone", () => {
    expect(withdrawDoneKey({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: false })).toBe("withdraw.done");
  });

  it("withdrawDoneKey_streamLostText_hasFrAndEn", () => {
    expect(frPlanning.withdraw.doneStreamLost).toBeTruthy();
    expect(enPlanning.withdraw.doneStreamLost).toBeTruthy();
  });
});

describe("matchs passés", () => {
  it("isPastEntry_notEditable_isPast", () => {
    expect(isPastEntry({ editable: false })).toBe(true);
  });

  it("isPastEntry_editableAfterEstimatedEnd_staysUpcoming", () => {
    // Un match en retard se joue encore : sa fin estimée écoulée ne le range pas dans « Matchs passés ».
    expect(isPastEntry({ editable: true })).toBe(false);
  });

  it("splitPast_mixed_keepsOrderInEachHalf", () => {
    const entries = [
      { key: "a", editable: true },
      { key: "b", editable: false },
      { key: "c", editable: true },
      { key: "d", editable: false },
    ];

    const { upcoming, past } = splitPast(entries);

    expect(upcoming.map((entry) => entry.key)).toEqual(["a", "c"]);
    expect(past.map((entry) => entry.key)).toEqual(["b", "d"]);
  });

  it("splitPast_empty_returnsTwoEmptyLists", () => {
    expect(splitPast([])).toEqual({ upcoming: [], past: [] });
  });

  it("newestFirst_twoWeeks_reversesWeeksDaysAndEntries", () => {
    const weeks = groupByWeek([
      entryView({ key: "w1-mon-a", startAt: "2026-11-02T18:00:00.000Z" }),
      entryView({ key: "w1-mon-b", startAt: "2026-11-02T20:00:00.000Z" }),
      entryView({ key: "w1-tue", startAt: "2026-11-03T18:00:00.000Z" }),
      entryView({ key: "w2-mon", startAt: "2026-11-09T18:00:00.000Z" }),
    ]);

    const result = newestFirst(weeks);

    expect(result.map((week) => week.entries.map((entry) => entry.key))).toEqual([["w2-mon"], ["w1-tue", "w1-mon-b", "w1-mon-a"]]);
    expect(result[1].days.map((day) => day.entries.map((entry) => entry.key))).toEqual([["w1-tue"], ["w1-mon-b", "w1-mon-a"]]);
  });

  it("planningMessages_pastKeys_presentInBothLanguagesAndOldRoundKeyGone", () => {
    expect(frPlanning.past.title).toBe("Matchs passés");
    expect(enPlanning.past.title).toBe("Past matches");
    expect(frPlanning.past.noUpcoming).not.toBe("");
    expect(enPlanning.past.noUpcoming).not.toBe("");
    expect("round" in frPlanning).toBe(false);
    expect("round" in enPlanning).toBe(false);
  });
});

describe("planningOpenKey", () => {
  it("planningOpenKey_account_neverHoldsRawId", () => {
    expect(planningOpenKey("past", 357276)).not.toContain("357276");
  });

  it("planningOpenKey_sameAccountAndSection_isStable", () => {
    expect(planningOpenKey("past", 42)).toBe(planningOpenKey("past", 42));
  });

  it("planningOpenKey_otherAccount_differs", () => {
    expect(planningOpenKey("past", 42)).not.toBe(planningOpenKey("past", 43));
  });

  it("planningOpenKey_otherSection_differs", () => {
    expect(planningOpenKey("staff", 42)).toMatch(/^planning:staff-open:[0-9a-z]+$/);
    expect(planningOpenKey("past", 42)).toMatch(/^planning:past-open:[0-9a-z]+$/);
  });
});
