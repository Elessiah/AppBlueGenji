import { describe, expect, it } from "@jest/globals";
import {
  roundScheduleDeadline,
  acceptsScheduleDeadline,
  deadlineArmed,
  deadlineEntryChoices,
  deadlineEntryDays,
  deadlineEntryHours,
  deadlineEntryStart,
  deadlineEntryOf,
  deadlineFromEntry,
  deadlineOutcome,
  defaultScheduleDeadline,
  dueDeadlineReminder,
  formatScheduleDeadline,
  planningConfirmAt,
  upcomingScheduleDeadline,
  readScheduleDeadline,
  scheduleOpenedAt,
  suggestedScheduleDeadline,
  type DeadlineMatch,
} from "@/lib/shared/schedule-deadline";

/** Date butoir de planification (`docs/features/SCHEDULE_DEADLINE.md`) : la règle pure. */

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;
const at = (iso: string) => Date.parse(iso);

/** Un match à planifier : option allumée, deux engagées, ni horaire ni lancement. */
function toPlan(overrides: Partial<DeadlineMatch> = {}): DeadlineMatch {
  return { status: "READY", team1Id: 1, team2Id: 2, startAt: null, launchedAt: null, refereeScheduling: true, ...overrides };
}

describe("defaultScheduleDeadline", () => {
  it("defaultScheduleDeadline_sundayLateEvening_returnsTuesday21Paris", () => {
    // Dimanche 15 novembre 2026, 23:00 à Paris (UTC+1).
    expect(defaultScheduleDeadline(at("2026-11-15T22:00:00Z"))).toBe(at("2026-11-17T20:00:00Z"));
  });

  it("defaultScheduleDeadline_mondayMorning_returnsWednesday21Paris", () => {
    expect(defaultScheduleDeadline(at("2026-11-16T09:00:00Z"))).toBe(at("2026-11-18T20:00:00Z"));
  });

  it("defaultScheduleDeadline_acrossAutumnDstChange_keepsWallClock21", () => {
    // Vendredi 23 octobre (CEST) → dimanche 25 octobre, passé à l'heure d'hiver (CET).
    expect(defaultScheduleDeadline(at("2026-10-23T10:00:00Z"))).toBe(at("2026-10-25T20:00:00Z"));
  });

  it("defaultScheduleDeadline_acrossSpringDstChange_keepsWallClock21", () => {
    // Vendredi 27 mars (CET) → dimanche 29 mars, passé à l'heure d'été (CEST).
    expect(defaultScheduleDeadline(at("2026-03-27T11:00:00Z"))).toBe(at("2026-03-29T19:00:00Z"));
  });

  it("defaultScheduleDeadline_openedAfterParisMidnight_countsParisDay", () => {
    // Samedi 23:30 UTC = dimanche 00:30 à Paris : on compte depuis dimanche.
    expect(defaultScheduleDeadline(at("2026-11-14T23:30:00Z"))).toBe(at("2026-11-17T20:00:00Z"));
  });

  it("defaultScheduleDeadline_endOfMonth_rollsIntoNextMonth", () => {
    expect(defaultScheduleDeadline(at("2026-11-30T11:00:00Z"))).toBe(at("2026-12-02T20:00:00Z"));
  });
});

describe("readScheduleDeadline", () => {
  const now = at("2026-11-16T12:00:00Z");

  it("readScheduleDeadline_null_returnsClear", () => {
    expect(readScheduleDeadline(null, now)).toEqual({ kind: "clear" });
  });

  it("readScheduleDeadline_nonString_returnsInvalid", () => {
    expect(readScheduleDeadline(1763400000000, now)).toEqual({ kind: "invalid", code: "INVALID_SCHEDULE_DEADLINE" });
  });

  it("readScheduleDeadline_stringOver40Chars_returnsInvalid", () => {
    expect(readScheduleDeadline(`2026-11-17T20:00:00.000Z${" ".repeat(17)}`, now)).toEqual({
      kind: "invalid",
      code: "INVALID_SCHEDULE_DEADLINE",
    });
  });

  it("readScheduleDeadline_unparsable_returnsInvalid", () => {
    expect(readScheduleDeadline("mardi soir", now)).toEqual({ kind: "invalid", code: "INVALID_SCHEDULE_DEADLINE" });
  });

  it("readScheduleDeadline_secondsPresent_roundsDownToMinute", () => {
    expect(readScheduleDeadline("2026-11-17T20:00:42.500Z", now)).toEqual({ kind: "set", at: at("2026-11-17T20:00:00Z") });
  });

  it("readScheduleDeadline_justUnderTwentyFourHoursAhead_returnsTooSoon", () => {
    expect(readScheduleDeadline(new Date(now + 24 * HOUR - MINUTE).toISOString(), now)).toEqual({
      kind: "invalid",
      code: "SCHEDULE_DEADLINE_TOO_SOON",
    });
  });

  it("readScheduleDeadline_exactlyTwentyFourHoursAhead_returnsSet", () => {
    expect(readScheduleDeadline(new Date(now + 24 * HOUR).toISOString(), now)).toEqual({ kind: "set", at: now + 24 * HOUR });
  });

  it("readScheduleDeadline_oneHourAhead_returnsTooSoon", () => {
    // Une saisie hâtive ne peut plus forfaiter une manche dans l'heure.
    expect(readScheduleDeadline(new Date(now + HOUR).toISOString(), now)).toEqual({ kind: "invalid", code: "SCHEDULE_DEADLINE_TOO_SOON" });
  });

  it("readScheduleDeadline_exactlySixtyDaysAhead_returnsSet", () => {
    expect(readScheduleDeadline(new Date(now + 60 * DAY).toISOString(), now)).toEqual({ kind: "set", at: now + 60 * DAY });
  });

  it("readScheduleDeadline_oneMinuteOverSixtyDays_returnsTooFar", () => {
    expect(readScheduleDeadline(new Date(now + 60 * DAY + MINUTE).toISOString(), now)).toEqual({
      kind: "invalid",
      code: "SCHEDULE_DEADLINE_TOO_FAR",
    });
  });
});

describe("acceptsScheduleDeadline", () => {
  it("acceptsScheduleDeadline_unscheduledMatchEntrantsUnknown_true", () => {
    expect(acceptsScheduleDeadline(toPlan({ status: "PENDING", team1Id: null, team2Id: null }))).toBe(true);
  });

  it("acceptsScheduleDeadline_optionOff_false", () => {
    expect(acceptsScheduleDeadline(toPlan({ refereeScheduling: false }))).toBe(false);
  });

  it("acceptsScheduleDeadline_completed_false", () => {
    expect(acceptsScheduleDeadline(toPlan({ status: "COMPLETED" }))).toBe(false);
  });

  it("acceptsScheduleDeadline_awaitingConfirmation_false", () => {
    expect(acceptsScheduleDeadline(toPlan({ status: "AWAITING_CONFIRMATION" }))).toBe(false);
  });

  it("acceptsScheduleDeadline_startAtSet_false", () => {
    expect(acceptsScheduleDeadline(toPlan({ startAt: "2026-11-17T19:00:00.000Z" }))).toBe(false);
  });

  it("acceptsScheduleDeadline_launched_false", () => {
    expect(acceptsScheduleDeadline(toPlan({ launchedAt: "2026-11-16T19:00:00.000Z" }))).toBe(false);
  });
});

describe("deadlineOutcome", () => {
  const deadline = at("2026-11-17T20:00:00Z");

  it("deadlineOutcome_notYetDue_returnsNull", () => {
    expect(deadlineOutcome(toPlan(), deadline, deadline - 1)).toBeNull();
  });

  it("deadlineOutcome_noDeadline_returnsNull", () => {
    expect(deadlineOutcome(toPlan(), null, deadline)).toBeNull();
  });

  it("deadlineOutcome_exactlyDueAndToPlan_returnsForfeit", () => {
    expect(deadlineOutcome(toPlan(), deadline, deadline)).toBe("FORFEIT");
  });

  it("deadlineOutcome_dueButEntrantMissing_returnsLapse", () => {
    expect(deadlineOutcome(toPlan({ team2Id: null }), deadline, deadline + HOUR)).toBe("LAPSE");
  });

  it("deadlineOutcome_dueButOptionOff_returnsLapse", () => {
    expect(deadlineOutcome(toPlan({ refereeScheduling: false }), deadline, deadline + HOUR)).toBe("LAPSE");
  });

  it("deadlineOutcome_dueButScheduled_returnsRetire", () => {
    expect(deadlineOutcome(toPlan({ startAt: "2026-11-18T19:00:00.000Z" }), deadline, deadline + HOUR)).toBe("RETIRE");
  });

  it("deadlineOutcome_dueButCompleted_returnsNull", () => {
    expect(deadlineOutcome(toPlan({ status: "COMPLETED" }), deadline, deadline + HOUR)).toBeNull();
  });

  it("deadlineOutcome_dueButLaunched_returnsRetire", () => {
    expect(deadlineOutcome(toPlan({ launchedAt: "2026-11-17T19:00:00.000Z" }), deadline, deadline + HOUR)).toBe("RETIRE");
  });
});

describe("deadlineArmed", () => {
  const deadline = at("2026-11-17T20:00:00Z");

  it("deadlineArmed_neverArmed_false", () => {
    expect(deadlineArmed(null, deadline)).toBe(false);
  });

  it("deadlineArmed_exactlyTwelveHoursBefore_true", () => {
    expect(deadlineArmed(deadline - 12 * HOUR, deadline)).toBe(true);
  });

  it("deadlineArmed_lessThanTwelveHoursBefore_false", () => {
    expect(deadlineArmed(deadline - 12 * HOUR + 1, deadline)).toBe(false);
    expect(deadlineArmed(deadline - 30 * MINUTE, deadline)).toBe(false);
  });
});

describe("scheduleOpenedAt", () => {
  const now = at("2026-11-16T08:00:00Z");
  const completed = (updatedAt: string) => ({ status: "COMPLETED", updatedAt });

  it("scheduleOpenedAt_latestCompletedWithinWeek_returnsIt", () => {
    const matches = [completed("2026-11-15T20:00:00Z"), completed("2026-11-15T22:00:00Z"), { status: "READY", updatedAt: "2026-11-16T07:00:00Z" }];

    expect(scheduleOpenedAt(matches, now)).toBe(at("2026-11-15T22:00:00Z"));
  });

  it("scheduleOpenedAt_nothingCompleted_returnsNow", () => {
    expect(scheduleOpenedAt([{ status: "READY", updatedAt: "2026-11-15T22:00:00Z" }], now)).toBe(now);
  });

  it("scheduleOpenedAt_completedOverAWeekAgo_returnsNow", () => {
    expect(scheduleOpenedAt([completed("2026-11-09T07:59:00Z")], now)).toBe(now);
  });

  it("scheduleOpenedAt_completedInTheFuture_ignored", () => {
    expect(scheduleOpenedAt([completed("2026-11-16T09:00:00Z")], now)).toBe(now);
  });

  it("scheduleOpenedAt_targetWithCompletedFeeder_usesFeederNotLaterMatch", () => {
    // Le match 9 alimente le match 20 ; un autre match, retouché lundi, n'y change rien.
    const matches = [
      { ...completed("2026-11-15T22:00:00Z"), nextWinnerMatchId: 20 },
      { ...completed("2026-11-16T07:00:00Z"), nextWinnerMatchId: 21 },
    ];

    expect(scheduleOpenedAt(matches, now, 20)).toBe(at("2026-11-15T22:00:00Z"));
  });

  it("scheduleOpenedAt_targetFedByLoserSide_usesIt", () => {
    const matches = [
      { ...completed("2026-11-15T21:00:00Z"), nextWinnerMatchId: 30, nextLoserMatchId: 20 },
      completed("2026-11-16T07:00:00Z"),
    ];

    expect(scheduleOpenedAt(matches, now, 20)).toBe(at("2026-11-15T21:00:00Z"));
  });

  it("scheduleOpenedAt_targetWithoutCompletedFeeder_fallsBackToTournament", () => {
    const matches = [{ status: "READY", updatedAt: "2026-11-15T20:00:00Z", nextWinnerMatchId: 20 }, completed("2026-11-15T22:00:00Z")];

    expect(scheduleOpenedAt(matches, now, 20)).toBe(at("2026-11-15T22:00:00Z"));
  });
});

describe("suggestedScheduleDeadline", () => {
  it("suggestedScheduleDeadline_roundEndedSundayNightOpenedMonday_tuesday21Paris", () => {
    // Manche finie dimanche 15 nov. 23:00 (Paris), fenêtre ouverte lundi 10:00 (Paris).
    expect(suggestedScheduleDeadline(at("2026-11-15T22:00:00Z"), at("2026-11-16T09:00:00Z"))).toBe(at("2026-11-17T20:00:00Z"));
  });

  it("suggestedScheduleDeadline_openingDeadlineTooClose_fallsBackToNow", () => {
    // Ouverture vendredi : sa date butoir (dimanche 21:00) est passée lundi ; repli sur mercredi 21:00.
    expect(suggestedScheduleDeadline(at("2026-11-13T22:00:00Z"), at("2026-11-16T09:00:00Z"))).toBe(at("2026-11-18T20:00:00Z"));
  });
});

describe("dueDeadlineReminder", () => {
  const deadline = at("2026-11-19T20:00:00Z");

  it("dueDeadlineReminder_nothingSent_returnsSet", () => {
    expect(dueDeadlineReminder(deadline, deadline - 3 * DAY, new Set())).toEqual({ key: "SET", consumes: ["SET"] });
  });

  it("dueDeadlineReminder_setSentJustOver24hBefore_returnsNull", () => {
    expect(dueDeadlineReminder(deadline, deadline - 24 * HOUR - 1, new Set(["SET"]))).toBeNull();
  });

  it("dueDeadlineReminder_setSentExactly24hBefore_returnsDl24ConsumingSetAndDl24", () => {
    expect(dueDeadlineReminder(deadline, deadline - 24 * HOUR, new Set(["SET"]))).toEqual({
      key: "DL24",
      consumes: ["SET", "DL24"],
    });
  });

  it("dueDeadlineReminder_within3hNothingSent_returnsDl3ConsumingAll", () => {
    expect(dueDeadlineReminder(deadline, deadline - 2 * HOUR, new Set())).toEqual({
      key: "DL3",
      consumes: ["SET", "DL24", "DL3"],
    });
  });

  it("dueDeadlineReminder_latestAlreadySent_returnsNull", () => {
    expect(dueDeadlineReminder(deadline, deadline - 2 * HOUR, new Set(["SET", "DL24", "DL3"]))).toBeNull();
  });

  it("dueDeadlineReminder_atDeadline_returnsNull", () => {
    expect(dueDeadlineReminder(deadline, deadline, new Set())).toBeNull();
  });
});

describe("planningConfirmAt", () => {
  it("planningConfirmAt_mondayEveningMatchBeforeTuesdayDeadline_returnsStartMinusLead", () => {
    // Match mardi 22:00 (Paris), date butoir mardi 21:00, délai 24 h : confirmé lundi 22:00.
    const start = at("2026-11-17T21:00:00Z");
    const deadline = at("2026-11-17T20:00:00Z");

    expect(planningConfirmAt(start, deadline, 24)).toBe(at("2026-11-16T21:00:00Z"));
  });

  it("planningConfirmAt_farMatch_returnsDeadline", () => {
    const start = at("2026-11-20T20:00:00Z");
    const deadline = at("2026-11-17T20:00:00Z");

    expect(planningConfirmAt(start, deadline, 24)).toBe(deadline);
  });

  it("planningConfirmAt_noDeadline_returnsStartMinusLead", () => {
    const start = at("2026-11-20T20:00:00Z");

    expect(planningConfirmAt(start, null, 48)).toBe(start - 48 * HOUR);
  });
});

describe("saisie", () => {
  it("deadlineEntryDays_nearParisMidnight_startsFromParisDay", () => {
    const days = deadlineEntryDays(at("2026-11-14T23:30:00Z"));

    expect(days).toHaveLength(21);
    expect(days[0]).toBe("2026-11-15");
    expect(days[20]).toBe("2026-12-05");
  });

  it("deadlineEntryOf_instant_returnsParisDayAndHour", () => {
    expect(deadlineEntryOf(at("2026-11-17T20:00:00Z"))).toEqual({ day: "2026-11-17", hour: 21 });
  });

  it("deadlineFromEntry_summerDay_usesCest", () => {
    expect(deadlineFromEntry("2026-10-24", 21)).toBe(at("2026-10-24T19:00:00Z"));
  });

  it("deadlineFromEntry_winterDay_usesCet", () => {
    expect(deadlineFromEntry("2026-10-25", 21)).toBe(at("2026-10-25T20:00:00Z"));
  });

  it("deadlineFromEntry_malformedDay_returnsNull", () => {
    expect(deadlineFromEntry("17/11/2026", 21)).toBeNull();
  });

  it("deadlineFromEntry_hour24_returnsNull", () => {
    expect(deadlineFromEntry("2026-11-17", 24)).toBeNull();
  });

  it("deadlineFromEntry_negativeHour_returnsNull", () => {
    expect(deadlineFromEntry("2026-11-17", -1)).toBeNull();
  });

  it("deadlineFromEntry_fractionalHour_returnsNull", () => {
    expect(deadlineFromEntry("2026-11-17", 1.5)).toBeNull();
  });

  it("formatScheduleDeadline_fr_showsParisTime", () => {
    expect(formatScheduleDeadline("2026-11-17T20:00:00.000Z", "fr")).toMatch(/mar\.? 17 nov\.?.*21:00/);
  });

  it("formatScheduleDeadline_en_showsParisTime", () => {
    expect(formatScheduleDeadline("2026-11-17T20:00:00.000Z", "en")).toMatch(/Tue.*Nov.*17.*21:00/);
  });
});

describe("upcomingScheduleDeadline", () => {
  const AT = "2026-11-21T20:00:00.000Z";
  const AT_MS = Date.parse(AT);

  it("upcomingScheduleDeadline_noDeadline_null", () => {
    expect(upcomingScheduleDeadline(null, AT_MS)).toBeNull();
  });

  it("upcomingScheduleDeadline_clockUnknown_shown", () => {
    expect(upcomingScheduleDeadline(AT, null)).toBe(AT);
  });

  it("upcomingScheduleDeadline_future_shown", () => {
    expect(upcomingScheduleDeadline(AT, AT_MS - 1)).toBe(AT);
  });

  it("upcomingScheduleDeadline_reachedOrPast_hidden", () => {
    expect(upcomingScheduleDeadline(AT, AT_MS)).toBeNull();
  });
});

describe("saisie : heures et jours permis", () => {
  // Mercredi 18 novembre 2026, 15:40 à Paris (14:40 UTC).
  const NOW = at("2026-11-18T14:40:00Z");

  it("deadlineEntryHours_today_none", () => {
    expect(deadlineEntryHours("2026-11-18", NOW)).toEqual([]);
  });

  it("deadlineEntryHours_tomorrow_skipsHoursUnderTwentyFourHoursAhead", () => {
    const hours = deadlineEntryHours("2026-11-19", NOW);

    expect(hours[0]).toBe(16);
    expect(hours).toContain(21);
    expect(hours).not.toContain(15);
  });

  it("deadlineEntryHours_exactlyTwentyFourHoursAhead_isOffered", () => {
    // 15:00 pile : demain 15:00 est à 24 heures exactes.
    expect(deadlineEntryHours("2026-11-19", at("2026-11-18T14:00:00Z"))[0]).toBe(15);
  });

  it("deadlineEntryHours_laterDay_offersAll24", () => {
    expect(deadlineEntryHours("2026-11-20", NOW)).toHaveLength(24);
  });

  it("deadlineEntryHours_pastDayOrBeyondSixtyDays_none", () => {
    expect(deadlineEntryHours("2026-11-17", NOW)).toEqual([]);
    expect(deadlineEntryHours("2027-02-01", NOW)).toEqual([]);
  });

  it("deadlineEntryChoices_lateEvening_dropsToday", () => {
    // 23:30 à Paris : ni aujourd'hui ni demain n'ont plus d'heure pile à 24 heures d'ici.
    const days = deadlineEntryChoices(at("2026-11-18T22:30:00Z"));

    expect(days[0]).toBe("2026-11-20");
  });

  it("deadlineEntryChoices_farKeptDay_isSortedIn", () => {
    const days = deadlineEntryChoices(NOW, "2026-12-30");

    expect(days[0]).toBe("2026-11-19");
    expect(days.at(-1)).toBe("2026-12-30");
    expect([...days].sort()).toEqual(days);
  });

  it("deadlineEntryChoices_keptDayBeyondLimit_dropped", () => {
    expect(deadlineEntryChoices(NOW, "2027-03-01")).not.toContain("2027-03-01");
  });

  it("deadlineEntryStart_currentStillValid_usesCurrent", () => {
    expect(deadlineEntryStart(at("2026-11-20T17:00:00Z"), at("2026-11-21T20:00:00Z"), NOW)).toEqual({
      day: "2026-11-20",
      hour: 18,
      fromCurrent: true,
    });
  });

  it("deadlineEntryStart_currentPastOrTooSoon_fallsBackToSuggestion", () => {
    const suggested = at("2026-11-21T20:00:00Z");

    expect(deadlineEntryStart(at("2026-11-18T10:00:00Z"), suggested, NOW)).toEqual({ day: "2026-11-21", hour: 21, fromCurrent: false });
    expect(deadlineEntryStart(NOW + 30 * MINUTE, suggested, NOW).fromCurrent).toBe(false);
    expect(deadlineEntryStart(null, suggested, NOW).fromCurrent).toBe(false);
  });
});

describe("saisie en masse : date butoir de la manche reposée", () => {
  // Mercredi 18 novembre 2026, 15:40 à Paris (14:40 UTC) ; la manche se clôt jeudi 19 à 09:00 Paris (17 h 20 devant).
  const NOW = at("2026-11-18T14:40:00Z");
  const ROUND = at("2026-11-19T08:00:00Z");

  it("readScheduleDeadline_customMinAhead_acceptsAtBoundaryRejectsBelow", () => {
    expect(readScheduleDeadline(new Date(NOW + 12 * HOUR + MINUTE).toISOString(), NOW, 12 * HOUR)).toEqual({ kind: "set", at: NOW + 12 * HOUR + MINUTE });
    expect(readScheduleDeadline(new Date(NOW + 11 * HOUR).toISOString(), NOW, 12 * HOUR)).toEqual({ kind: "invalid", code: "SCHEDULE_DEADLINE_TOO_SOON" });
  });

  it("roundScheduleDeadline_latestReappliableOfUnplayed_returned", () => {
    const later = at("2026-11-19T10:00:00Z");
    const matches = [
      { status: "READY", scheduleDeadlineAt: new Date(ROUND).toISOString() },
      { status: "PENDING", scheduleDeadlineAt: new Date(later).toISOString() },
    ];

    expect(roundScheduleDeadline(matches, NOW)).toBe(later);
  });

  it("roundScheduleDeadline_completedOrUnder12hOrNone_null", () => {
    expect(roundScheduleDeadline([{ status: "COMPLETED", scheduleDeadlineAt: new Date(ROUND).toISOString() }], NOW)).toBeNull();
    expect(roundScheduleDeadline([{ status: "READY", scheduleDeadlineAt: new Date(NOW + 11 * HOUR).toISOString() }], NOW)).toBeNull();
    expect(roundScheduleDeadline([{ status: "READY", scheduleDeadlineAt: null }], NOW)).toBeNull();
  });

  it("deadlineEntryHours_reapplyWithin24h_offersOnlyThatHour", () => {
    expect(deadlineEntryHours("2026-11-19", NOW, ROUND)).toContain(9);
    expect(deadlineEntryHours("2026-11-19", NOW, ROUND)).not.toContain(10);
  });

  it("deadlineEntryHours_reapplyUnder12h_notOffered", () => {
    expect(deadlineEntryHours("2026-11-19", NOW, at("2026-11-19T01:00:00Z"))).not.toContain(2);
  });

  it("deadlineEntryStart_reapplyCurrent_fromCurrent", () => {
    expect(deadlineEntryStart(ROUND, at("2026-11-21T20:00:00Z"), NOW, ROUND)).toEqual({ day: "2026-11-19", hour: 9, fromCurrent: true });
  });

  it("deadlineEntryChoices_lateEveningWithReapply_keepsTomorrow", () => {
    // 23:30 à Paris : demain n'a plus d'heure à 24 heures, mais la manche se clôt demain 21:00.
    const now = at("2026-11-18T22:30:00Z");

    expect(deadlineEntryChoices(now, null, at("2026-11-19T20:00:00Z"))[0]).toBe("2026-11-19");
  });
});
