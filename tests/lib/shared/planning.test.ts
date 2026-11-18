import { describe, expect, it } from "@jest/globals";
import {
  parsePlanningEntryKey,
  planningCoverage,
  planningEntryKey,
  planningHistoryStart,
  planningNextWeekStart,
  planningRolesOf,
  planningWeekStart,
} from "@/lib/shared/planning";
import { authUser } from "../../helpers/auth-user";
import { MONDAY } from "../../helpers/planning";

/** Règles pures du planning (`docs/features/CAST_PLANNING.md`) : clés, rôles tenus, couverture, semaines. */

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_SOLO = new Set<number>();

describe("planningEntryKey / parsePlanningEntryKey", () => {
  it("planningEntryKey_matchAndTournament_returnsPrefixedKeys", () => {
    expect(planningEntryKey("MATCH", 5)).toBe("m:5");
    expect(planningEntryKey("TOURNAMENT", 7)).toBe("t:7");
  });

  it("parsePlanningEntryKey_matchKey_returnsMatchKind", () => {
    expect(parsePlanningEntryKey("m:42")).toEqual({ kind: "MATCH", id: 42 });
  });

  it("parsePlanningEntryKey_tournamentKey_returnsTournamentKind", () => {
    expect(parsePlanningEntryKey("t:9")).toEqual({ kind: "TOURNAMENT", id: 9 });
  });

  it("parsePlanningEntryKey_unknownPrefix_returnsNull", () => {
    expect(parsePlanningEntryKey("x:1")).toBeNull();
  });

  it("parsePlanningEntryKey_zeroId_returnsNull", () => {
    expect(parsePlanningEntryKey("m:0")).toBeNull();
  });

  it("parsePlanningEntryKey_leadingZero_returnsNull", () => {
    expect(parsePlanningEntryKey("m:01")).toBeNull();
  });

  it("parsePlanningEntryKey_fifteenDigits_returnsId", () => {
    expect(parsePlanningEntryKey("m:123456789012345")).toEqual({ kind: "MATCH", id: 123456789012345 });
  });

  it("parsePlanningEntryKey_sixteenDigits_returnsNull", () => {
    expect(parsePlanningEntryKey("m:1234567890123456")).toBeNull();
  });

  it("parsePlanningEntryKey_nonString_returnsNull", () => {
    expect(parsePlanningEntryKey(12)).toBeNull();
  });
});

describe("planningRolesOf", () => {
  it("planningRolesOf_arbitre_returnsReferee", () => {
    expect(planningRolesOf(authUser({ roles: ["ARBITRE"] }))).toEqual(["REFEREE"]);
  });

  it("planningRolesOf_admin_returnsReferee", () => {
    expect(planningRolesOf(authUser({ isAdmin: true }))).toEqual(["REFEREE"]);
  });

  it("planningRolesOf_casterProd_returnsCasterAndProd", () => {
    expect(planningRolesOf(authUser({ roles: ["CASTER", "PROD"] }))).toEqual(["CASTER", "PROD"]);
  });

  it("planningRolesOf_playerView_returnsEmpty", () => {
    expect(planningRolesOf(authUser({ roles: [], isAdmin: false, playerView: true }))).toEqual([]);
  });

  it("planningRolesOf_null_returnsEmpty", () => {
    expect(planningRolesOf(null)).toEqual([]);
  });
});

describe("planningCoverage", () => {
  it("planningCoverage_refereeCasterProd_complete", () => {
    const coverage = planningCoverage({ hasReferee: true, casterIds: [1], prodIds: [2], soloCasterIds: NO_SOLO });
    expect(coverage).toEqual({ level: "COMPLETE", streamed: true, refereePriority: false, idleProds: 0, casterNeedsProd: false });
  });

  it("planningCoverage_soloCasterNoReferee_streamedRefereePriority", () => {
    const coverage = planningCoverage({ hasReferee: false, casterIds: [1], prodIds: [], soloCasterIds: new Set([1]) });
    expect(coverage.level).toBe("STREAMED");
    expect(coverage.refereePriority).toBe(true);
  });

  it("planningCoverage_casterAndProdNoReferee_streamed", () => {
    const coverage = planningCoverage({ hasReferee: false, casterIds: [1], prodIds: [2], soloCasterIds: NO_SOLO });
    expect(coverage.level).toBe("STREAMED");
  });

  it("planningCoverage_soloCasterWithReferee_streamedNotComplete", () => {
    const coverage = planningCoverage({ hasReferee: true, casterIds: [1], prodIds: [], soloCasterIds: new Set([1]) });
    expect(coverage.level).toBe("STREAMED");
    expect(coverage.refereePriority).toBe(false);
  });

  it("planningCoverage_refereeOnly_refereed", () => {
    const coverage = planningCoverage({ hasReferee: true, casterIds: [], prodIds: [], soloCasterIds: NO_SOLO });
    expect(coverage.level).toBe("REFEREED");
  });

  it("planningCoverage_nothing_selfManaged", () => {
    const coverage = planningCoverage({ hasReferee: false, casterIds: [], prodIds: [], soloCasterIds: NO_SOLO });
    expect(coverage.level).toBe("SELF_MANAGED");
  });

  it("planningCoverage_prodWithoutCaster_notCountedIdle", () => {
    const coverage = planningCoverage({ hasReferee: true, casterIds: [], prodIds: [2], soloCasterIds: NO_SOLO });
    expect(coverage.level).toBe("REFEREED");
    expect(coverage.idleProds).toBe(1);
  });

  it("planningCoverage_nonSoloCasterWithoutProd_needsProdNotStreamed", () => {
    const coverage = planningCoverage({ hasReferee: false, casterIds: [1], prodIds: [], soloCasterIds: NO_SOLO });
    expect(coverage.streamed).toBe(false);
    expect(coverage.casterNeedsProd).toBe(true);
    expect(coverage.level).toBe("SELF_MANAGED");
  });
});

describe("planningWeekStart / planningHistoryStart", () => {
  it("planningWeekStart_sunday_returnsPreviousMondayUtc", () => {
    expect(planningWeekStart(MONDAY - 2 * 60 * 60 * 1000)).toBe(MONDAY - 7 * DAY_MS);
  });

  it("planningWeekStart_monday_returnsSameMidnight", () => {
    expect(planningWeekStart(MONDAY + 15 * 60 * 60 * 1000)).toBe(MONDAY);
  });

  it("planningHistoryStart_returnsEightWeeksBeforeWeekStart", () => {
    // Huit lundis plus tôt : le 28 septembre 2026, minuit à Paris (heure d'été, 22:00 UTC la veille).
    expect(planningHistoryStart(MONDAY + DAY_MS)).toBe(Date.UTC(2026, 8, 27, 22));
  });

  it("planningWeekStart_mondayEarlyParisTime_sameWeekNotPrevious", () => {
    // Lundi 00:30 à Paris = dimanche 23:30 UTC : déjà la semaine du lundi.
    expect(planningWeekStart(MONDAY + 30 * 60 * 1000)).toBe(MONDAY);
  });

  it("planningWeekStart_sundayLateParisTime_previousWeek", () => {
    expect(planningWeekStart(MONDAY - 30 * 60 * 1000)).toBe(planningWeekStart(MONDAY - 3 * DAY_MS));
    expect(planningWeekStart(MONDAY - 30 * 60 * 1000)).toBe(MONDAY - 7 * DAY_MS);
  });

  it("planningWeekStart_summerTime_mondayMidnightParis", () => {
    // Mercredi 1er juillet 2026 12:00 UTC → lundi 29 juin, minuit à Paris (22:00 UTC le 28).
    expect(planningWeekStart(Date.UTC(2026, 6, 1, 12))).toBe(Date.UTC(2026, 5, 28, 22));
  });

  it("planningNextWeekStart_acrossDstChange_nextParisMonday", () => {
    const summerMonday = Date.UTC(2026, 9, 18, 22);
    expect(planningNextWeekStart(summerMonday)).toBe(Date.UTC(2026, 9, 25, 23));
    expect(planningNextWeekStart(MONDAY)).toBe(MONDAY + 7 * DAY_MS);
  });
});
