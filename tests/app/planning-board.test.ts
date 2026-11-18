import { describe, expect, it } from "@jest/globals";
import {
  candidatesFor,
  COVERAGE_PILL,
  errorKey,
  groupByWeek,
  hasProvisional,
  leadUntil,
  weekWindow,
} from "@/app/(secured)/planning/_lib/planning-board";
import { PLANNING_STATUSES } from "@/lib/server/planning/actions";
import enPlanning from "@/messages/en/planning.json";
import frPlanning from "@/messages/fr/planning.json";
import type { PlanningMember } from "@/lib/shared/planning-view";
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
  it("candidatesFor_memberProdOnEntry_excludedFromCasterButKeptForReferee", () => {
    const entry = entryView({ assignments: [{ userId: 4, role: "PROD", source: "MANUAL", reason: "MANUAL", provisional: false }] });
    const members = [member({ userId: 4, pseudo: "Double", roles: ["CASTER", "PROD", "REFEREE"] })];

    expect(candidatesFor(entry, "CASTER", members)).toEqual([]);
    expect(candidatesFor(entry, "REFEREE", members).map((row) => row.member.userId)).toEqual([4]);
  });
});

describe("errorKey / weekWindow / leadUntil / COVERAGE_PILL", () => {
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
    expect(weekWindow(MONDAY)).toEqual({ from: "2026-11-23T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" });
  });

  it("leadUntil_addsHours", () => {
    expect(leadUntil(MONDAY, 48)).toBe("2026-11-25T00:00:00.000Z");
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
