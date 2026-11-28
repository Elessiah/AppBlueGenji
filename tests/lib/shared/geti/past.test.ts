import { describe, expect, it } from "@jest/globals";
import { getiPostEndsAt, isGetiOneEveningPost, isGetiPostPast, matchesGetiFilter, type GetiParsedPost } from "@/lib/shared/geti";
import { getiAlertSearch, isGetiPostAlertable, matchingGetiAlerts } from "@/lib/shared/geti/alerts";
import { getiSlotEndMinutes } from "@/lib/shared/geti/filter";
import {
  emptyGetiPageQuery,
  getiActiveFilterCount,
  getiHidesPast,
  getiPageFilter,
  getiPageSearch,
  getiPostChips,
  parseGetiPageQuery,
} from "@/lib/shared/geti/page";
import { getiChipLabel, getiChipTitle, getiDataText } from "@/lib/shared/geti/page-text";
import enMessages from "@/messages/en/geti.json";
import frMessages from "@/messages/fr/geti.json";
import { parsedGetiPost } from "../../../helpers/geti";

/**
 * Annonces passées : fin de la dernière soirée visée (heure de Paris), filtre
 * par jour sur les soirées à venir, alertes, état de la page, étiquette d'un
 * horaire converti.
 */

/** Scrim du vendredi 27 novembre 2026, 21 h – 23 h : fini à 22:00Z. */
function fridayScrim(overrides: Partial<GetiParsedPost> = {}): GetiParsedPost {
  return parsedGetiPost({
    category: "lfs",
    dates: ["2026-11-27"],
    availability: { days: ["FRI"], times: [{ from: 1260, to: 1380 }], timezone: null },
    ...overrides,
  });
}

const FRIDAY_END = Date.parse("2026-11-27T22:00:00.000Z");
const FRIDAY_MORNING = Date.parse("2026-11-27T09:00:00.000Z");
const SATURDAY_MORNING = Date.parse("2026-11-28T09:00:00.000Z");

describe("getiSlotEndMinutes", () => {
  it("getiSlotEndMinutes_range_returnsItsEnd", () => {
    expect(getiSlotEndMinutes([{ from: 1260, to: 1380 }])).toBe(1380);
  });

  it("getiSlotEndMinutes_rangeAcrossMidnight_endsTheNextDay", () => {
    expect(getiSlotEndMinutes([{ from: 1320, to: 60 }])).toBe(1500);
  });

  it("getiSlotEndMinutes_singleTime_addsTwoHours", () => {
    expect(getiSlotEndMinutes([{ from: 1260, to: null }])).toBe(1380);
  });

  it("getiSlotEndMinutes_severalSlots_returnsTheLatestEnd", () => {
    expect(getiSlotEndMinutes([{ from: 1200, to: 1320 }, { from: 1260, to: 1380 }])).toBe(1380);
  });

  it("getiSlotEndMinutes_noTime_isTheEndOfTheDay", () => {
    expect(getiSlotEndMinutes([])).toBe(1440);
  });

  it("getiSlotEndMinutes_damagedSlots_areIgnored", () => {
    expect(getiSlotEndMinutes([null, "21h", { from: "abc" }, { from: 1260, to: 1380 }])).toBe(1380);
  });

  it("getiSlotEndMinutes_notAList_isTheEndOfTheDay", () => {
    expect(getiSlotEndMinutes(null)).toBe(1440);
  });
});

describe("getiPostEndsAt", () => {
  it("getiPostEndsAt_noDate_returnsNull", () => {
    expect(getiPostEndsAt(parsedGetiPost())).toBeNull();
  });

  it("getiPostEndsAt_winterEvening_isTheEndOfTheSlotInParisTime", () => {
    expect(getiPostEndsAt(fridayScrim())).toBe(FRIDAY_END);
  });

  it("getiPostEndsAt_summerEvening_usesSummerTime", () => {
    const post = fridayScrim({ dates: ["2026-07-15"] });

    expect(getiPostEndsAt(post)).toBe(Date.parse("2026-07-15T21:00:00.000Z"));
  });

  it("getiPostEndsAt_severalDates_usesTheLastOne", () => {
    const post = fridayScrim({ dates: ["2026-11-27", "2026-11-29"] });

    expect(getiPostEndsAt(post)).toBe(Date.parse("2026-11-29T22:00:00.000Z"));
  });

  it("getiPostEndsAt_dateWithoutTime_isMidnightInParis", () => {
    const post = fridayScrim({ availability: { days: ["FRI"], times: [], timezone: null } });

    expect(getiPostEndsAt(post)).toBe(Date.parse("2026-11-27T23:00:00.000Z"));
  });

  it("getiPostEndsAt_slotAcrossMidnight_endsTheNextMorning", () => {
    const post = fridayScrim({ availability: { days: ["FRI"], times: [{ from: 1380, to: 60 }], timezone: null } });

    expect(getiPostEndsAt(post)).toBe(Date.parse("2026-11-28T00:00:00.000Z"));
  });

  it("getiPostEndsAt_damagedDates_areIgnored", () => {
    const stored: unknown = { ...fridayScrim(), dates: ["27/11", 5, null] };

    expect(getiPostEndsAt(stored as GetiParsedPost)).toBeNull();
  });
});

describe("isGetiPostPast", () => {
  it("isGetiPostPast_oneMillisecondBeforeTheEnd_isFalse", () => {
    expect(isGetiPostPast(fridayScrim(), FRIDAY_END - 1)).toBe(false);
  });

  it("isGetiPostPast_atTheEnd_isTrue", () => {
    expect(isGetiPostPast(fridayScrim(), FRIDAY_END)).toBe(true);
  });

  it("isGetiPostPast_noDate_isNeverPast", () => {
    expect(isGetiPostPast(parsedGetiPost(), SATURDAY_MORNING)).toBe(false);
  });

  it("isGetiPostPast_oneDateStillAhead_isFalse", () => {
    const post = fridayScrim({ dates: ["2026-11-27", "2026-11-29"] });

    expect(isGetiPostPast(post, SATURDAY_MORNING)).toBe(false);
  });
});

describe("matchesGetiFilter — annonces passées", () => {
  it("matchesGetiFilter_hidePastOnAPastPost_rejectsIt", () => {
    expect(matchesGetiFilter(fridayScrim(), { hidePast: true }, SATURDAY_MORNING)).toBe(false);
  });

  it("matchesGetiFilter_hidePastOnAnUpcomingPost_keepsIt", () => {
    expect(matchesGetiFilter(fridayScrim(), { hidePast: true }, FRIDAY_MORNING)).toBe(true);
  });

  it("matchesGetiFilter_hidePastOnAnUndatedPost_keepsIt", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { hidePast: true }, SATURDAY_MORNING)).toBe(true);
  });

  it("matchesGetiFilter_withoutHidePast_keepsAPastPost", () => {
    expect(matchesGetiFilter(fridayScrim(), {}, SATURDAY_MORNING)).toBe(true);
  });

  it("matchesGetiFilter_hidePastWrittenAsText_rejectsAPastPost", () => {
    const stored: unknown = { hidePast: "true" };

    expect(matchesGetiFilter(fridayScrim(), stored as { hidePast: boolean }, SATURDAY_MORNING)).toBe(false);
  });
});

describe("matchesGetiFilter — filtre par jour, soirées à venir seulement", () => {
  it("matchesGetiFilter_fridayFilterBeforeTheEvening_matches", () => {
    expect(matchesGetiFilter(fridayScrim(), { days: ["FRI"] }, FRIDAY_MORNING)).toBe(true);
  });

  it("matchesGetiFilter_fridayFilterOnceTheEveningIsOver_doesNotMatch", () => {
    expect(matchesGetiFilter(fridayScrim(), { days: ["FRI"] }, SATURDAY_MORNING)).toBe(false);
  });

  it("matchesGetiFilter_pastDayWithIncludeUnknown_stillDoesNotMatch", () => {
    expect(matchesGetiFilter(fridayScrim(), { days: ["FRI"], includeUnknown: true }, SATURDAY_MORNING)).toBe(false);
  });

  it("matchesGetiFilter_fridayOverAndSundayAhead_matchesSundayOnly", () => {
    const post = fridayScrim({
      dates: ["2026-11-27", "2026-11-29"],
      availability: { days: ["FRI", "SUN"], times: [{ from: 1260, to: 1380 }], timezone: null },
    });

    expect(matchesGetiFilter(post, { days: ["SUN"] }, SATURDAY_MORNING)).toBe(true);
    expect(matchesGetiFilter(post, { days: ["FRI"] }, SATURDAY_MORNING)).toBe(false);
  });

  it("matchesGetiFilter_sameWeekdayOverAndAhead_matches", () => {
    const post = fridayScrim({ dates: ["2026-11-27", "2026-12-04"] });

    expect(matchesGetiFilter(post, { days: ["FRI"] }, SATURDAY_MORNING)).toBe(true);
  });

  it("matchesGetiFilter_habitualDayBesideAPastDate_stillMatches", () => {
    const post = fridayScrim({
      category: "lfp",
      availability: { days: ["MON", "FRI"], times: [], timezone: null },
    });

    expect(matchesGetiFilter(post, { days: ["MON"] }, SATURDAY_MORNING)).toBe(true);
  });

  it("matchesGetiFilter_undatedDays_matchAsBefore", () => {
    const post = parsedGetiPost({ availability: { days: ["FRI"], times: [], timezone: null } });

    expect(matchesGetiFilter(post, { days: ["FRI"] }, SATURDAY_MORNING)).toBe(true);
    expect(matchesGetiFilter(post, { days: ["MON"] }, SATURDAY_MORNING)).toBe(false);
  });

  it("matchesGetiFilter_noDayRead_followsIncludeUnknown", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { days: ["FRI"] }, SATURDAY_MORNING)).toBe(false);
    expect(matchesGetiFilter(parsedGetiPost(), { days: ["FRI"], includeUnknown: true }, SATURDAY_MORNING)).toBe(true);
  });
});

describe("alertes — une annonce passée ne prévient pas", () => {
  const scrimAlert = { id: 1, category: "lfs" as const, search: "" };

  it("isGetiPostAlertable_upcomingOpenPost_isTrue", () => {
    expect(isGetiPostAlertable(fridayScrim(), FRIDAY_MORNING)).toBe(true);
  });

  it("isGetiPostAlertable_pastPost_isFalse", () => {
    expect(isGetiPostAlertable(fridayScrim(), SATURDAY_MORNING)).toBe(false);
  });

  it("isGetiPostAlertable_closedPost_isFalse", () => {
    expect(isGetiPostAlertable(fridayScrim({ closed: true }), FRIDAY_MORNING)).toBe(false);
  });

  it("matchingGetiAlerts_upcomingPost_returnsTheAlert", () => {
    expect(matchingGetiAlerts(fridayScrim(), "lfs", [scrimAlert], new Map(), FRIDAY_MORNING)).toEqual([scrimAlert]);
  });

  it("matchingGetiAlerts_pastPost_returnsNothing", () => {
    expect(matchingGetiAlerts(fridayScrim(), "lfs", [scrimAlert], new Map(), SATURDAY_MORNING)).toEqual([]);
  });

  it("getiAlertSearch_showPast_isNotKept", () => {
    expect(getiAlertSearch("lfs", "?past=1&reg=eu")).toBe("?reg=eu");
  });
});

describe("page — scrims passés", () => {
  it("getiHidesPast_scrims_isTrue", () => {
    expect(getiHidesPast("lfs")).toBe(true);
  });

  it("getiHidesPast_recruitment_isFalse", () => {
    expect(getiHidesPast("lfp")).toBe(false);
  });

  it("parseGetiPageQuery_pastOnScrims_showsPast", () => {
    expect(parseGetiPageQuery("lfs", { past: "1" }).showPast).toBe(true);
  });

  it("parseGetiPageQuery_noParam_hidesPast", () => {
    expect(parseGetiPageQuery("lfs", {}).showPast).toBe(false);
  });

  it("parseGetiPageQuery_pastWithAnotherValue_isIgnored", () => {
    expect(parseGetiPageQuery("lfs", { past: "yes" }).showPast).toBe(false);
  });

  it("parseGetiPageQuery_pastOnAnotherCategory_isIgnored", () => {
    expect(parseGetiPageQuery("lfp", { past: "1" }).showPast).toBe(false);
  });

  it("getiPageSearch_showPast_writesTheParam", () => {
    expect(getiPageSearch({ ...emptyGetiPageQuery(), showPast: true })).toBe("?past=1");
  });

  it("getiPageFilter_scrimsByDefault_hidesPast", () => {
    expect(getiPageFilter("lfs", emptyGetiPageQuery()).hidePast).toBe(true);
  });

  it("getiPageFilter_scrimsWithShowPast_keepsPast", () => {
    expect(getiPageFilter("lfs", { ...emptyGetiPageQuery(), showPast: true }).hidePast).toBe(false);
  });

  it("getiPageFilter_recruitment_neverHidesPast", () => {
    expect(getiPageFilter("lfp", emptyGetiPageQuery()).hidePast).toBe(false);
  });

  it("getiActiveFilterCount_showPast_countsOne", () => {
    expect(getiActiveFilterCount({ ...emptyGetiPageQuery(), showPast: true })).toBe(1);
  });
});

describe("étiquette d'un horaire converti", () => {
  const converted = parsedGetiPost({
    availability: {
      days: [],
      times: [{ from: 1260, to: 1380 }],
      timezone: "UTC",
      statedTimes: [{ from: 1200, to: 1320 }],
    },
  });
  const fr = getiDataText(frMessages);
  const en = getiDataText(enMessages);

  it("getiPostChips_convertedTime_carriesTheStatedTime", () => {
    expect(getiPostChips(converted)).toEqual([
      { kind: "time", from: 1260, to: 1380, timezone: "UTC", stated: { from: 1200, to: 1320 } },
    ]);
  });

  it("getiPostChips_zoneWithoutShift_hasNoStatedTime", () => {
    const post = parsedGetiPost({ availability: { days: [], times: [{ from: 1260, to: 1380 }], timezone: "CET" } });

    expect(getiPostChips(post)).toEqual([{ kind: "time", from: 1260, to: 1380, timezone: "CET" }]);
  });

  it("getiPostChips_statedTimesWithoutZone_areIgnored", () => {
    const post = parsedGetiPost({
      availability: { days: [], times: [{ from: 1260, to: 1380 }], timezone: null, statedTimes: [{ from: 1200, to: 1320 }] },
    });

    expect(getiPostChips(post)).toEqual([{ kind: "time", from: 1260, to: 1380, timezone: null }]);
  });

  it("getiChipLabel_convertedTime_saysParisTime", () => {
    const [chip] = getiPostChips(converted);

    expect(getiChipLabel(chip, fr, "fr")).toBe("21h – 23h (heure de Paris)");
    expect(getiChipLabel(chip, en, "en")).toBe("21:00 – 23:00 (Paris time)");
  });

  it("getiChipTitle_convertedTime_givesTheTimeAsWritten", () => {
    const [chip] = getiPostChips(converted);

    expect(getiChipTitle(chip, fr, "fr")).toBe("Dans l'annonce : 20h – 22h (UTC)");
    expect(getiChipTitle(chip, en, "en")).toBe("In the post: 20:00 – 22:00 (UTC)");
  });

  it("getiChipTitle_timeWithoutShift_isNull", () => {
    expect(getiChipTitle({ kind: "time", from: 1260, to: 1380, timezone: "CET" }, fr, "fr")).toBeNull();
  });

  it("getiChipTitle_anotherKindOfChip_isNull", () => {
    expect(getiChipTitle({ kind: "day", value: "FRI" }, fr, "fr")).toBeNull();
  });
});

describe("cycle 1 : horaire converti au lendemain, jours habituels, catégories d'une soirée", () => {
  it("getiSlotEndMinutes_convertedSlotWrappingToTheNextDay_endsTheNextDay", () => {
    // 21 h puis 3 h (gardés dans l'ordre écrit) : le second est le lendemain, + 2 h.
    expect(getiSlotEndMinutes([{ from: 1260, to: null }, { from: 180, to: null }])).toBe(1740);
  });

  it("matchesGetiFilter_recurringNamedDaysWithAPastDate_stillMatchesThatDay", () => {
    // LFT du lundi 23 : « dispo lundi, mercredi, vendredi, dès ce soir », lu le mardi.
    const post = parsedGetiPost({
      category: "lft",
      dates: ["2026-11-23"],
      availability: { days: ["MON", "WED", "FRI"], times: [], timezone: null },
    });

    expect(matchesGetiFilter(post, { days: ["MON"] }, Date.parse("2026-11-24T12:00:00.000Z"))).toBe(true);
  });

  it.each([
    ["lfs", true],
    ["lfsub", true],
    ["lft", false],
    ["lfp", false],
  ])("isGetiOneEveningPost_%s_returns%s", (category, expected) => {
    expect(isGetiOneEveningPost(parsedGetiPost({ category: category as GetiParsedPost["category"] }))).toBe(expected);
  });

  it("isGetiPostAlertable_pastLftPost_isTrue", () => {
    expect(isGetiPostAlertable(fridayScrim({ category: "lft" }), SATURDAY_MORNING)).toBe(true);
  });

  it("isGetiPostAlertable_pastLfsubPost_isFalse", () => {
    expect(isGetiPostAlertable(fridayScrim({ category: "lfsub" }), SATURDAY_MORNING)).toBe(false);
  });
});
