import { describe, expect, it } from "@jest/globals";
import { parseGetiPost, type GetiCategory, type GetiParsedPost } from "@/lib/shared/geti";
import { getiRawPost } from "../../../helpers/geti";

/**
 * Dates et horaires d'une annonce : mots relatifs résolus depuis la date de
 * publication (jamais l'heure de lecture), fuseau écrit converti à l'heure de Paris.
 *
 * Repères : le jeudi 26 novembre 2026 ; 12:00Z = 13 h à Paris.
 */

const WEDNESDAY_NOON = "2026-11-25T12:00:00.000Z";
const THURSDAY_NOON = "2026-11-26T12:00:00.000Z";
const FRIDAY_NOON = "2026-11-27T12:00:00.000Z";
const SATURDAY_NOON = "2026-11-28T12:00:00.000Z";
const SUNDAY_NOON = "2026-11-29T12:00:00.000Z";
const MONDAY_NOON = "2026-11-23T12:00:00.000Z";
const SUMMER_NOON = "2026-07-15T12:00:00.000Z";

function parsed(content: string, postedAt: string | null, category: GetiCategory = "lfs"): GetiParsedPost {
  return parseGetiPost(getiRawPost(content, { category, postedAt }));
}

describe("parseGetiPost — mots relatifs, depuis la date de publication", () => {
  it("parseGetiPost_tonightPostedThursday2330Paris_isThursday", () => {
    const post = parsed("LFS tonight 21h-23h", "2026-11-26T22:30:00.000Z");

    expect(post.dates).toEqual(["2026-11-26"]);
    expect(post.availability.days).toEqual(["THU"]);
  });

  it("parseGetiPost_tonightPostedFriday0030Paris_isFriday", () => {
    const post = parsed("LFS tonight 21h-23h", "2026-11-26T23:30:00.000Z");

    expect(post.dates).toEqual(["2026-11-27"]);
    expect(post.availability.days).toEqual(["FRI"]);
  });

  it.each([["LFS ce soir 21h"], ["LFS cette nuit 23h-1h"], ["LFS cet après-midi 15h"], ["LFS this evening 9pm"], ["LFS ajd 21h"]])(
    "parseGetiPost_%s_isThePostingDay",
    (text) => {
      expect(parsed(text, THURSDAY_NOON).dates).toEqual(["2026-11-26"]);
    },
  );

  it.each([["LFS demain 21h-23h"], ["LFS tomorrow 9pm"], ["LFS tmrw 21h"]])("parseGetiPost_%s_isTheNextDay", (text) => {
    expect(parsed(text, THURSDAY_NOON).dates).toEqual(["2026-11-27"]);
  });

  it.each([["LFS après-demain 21h-23h"], ["LFS apres demain 21h"], ["LFS the day after tomorrow 9pm"]])(
    "parseGetiPost_%s_isTwoDaysLaterOnly",
    (text) => {
      expect(parsed(text, THURSDAY_NOON).dates).toEqual(["2026-11-28"]);
    },
  );

  it("parseGetiPost_tomorrowAndDayAfter_keepsBoth", () => {
    expect(parsed("LFS demain ou après-demain 21h", THURSDAY_NOON).dates).toEqual(["2026-11-27", "2026-11-28"]);
  });

  it("parseGetiPost_thisWeekendPostedWednesday_isSaturdayAndSunday", () => {
    const post = parsed("LFS ce week-end 21h-23h", WEDNESDAY_NOON);

    expect(post.dates).toEqual(["2026-11-28", "2026-11-29"]);
    expect(post.availability.days).toEqual(["SAT", "SUN"]);
  });

  it("parseGetiPost_thisWeekendPostedSaturday_isSaturdayAndSunday", () => {
    expect(parsed("LFS this weekend 9pm", SATURDAY_NOON).dates).toEqual(["2026-11-28", "2026-11-29"]);
  });

  it("parseGetiPost_thisWeekendPostedSunday_isThatSunday", () => {
    expect(parsed("LFS ce we 21h", SUNDAY_NOON).dates).toEqual(["2026-11-29"]);
  });

  it("parseGetiPost_nextMondayPostedMonday_isAWeekLater", () => {
    expect(parsed("LFS lundi prochain 21h", MONDAY_NOON).dates).toEqual(["2026-11-30"]);
  });

  it("parseGetiPost_nextMondayPostedThursday_isTheComingMonday", () => {
    expect(parsed("LFS lundi prochain 21h", THURSDAY_NOON).dates).toEqual(["2026-11-30"]);
  });

  it("parseGetiPost_nextFridayPostedThursday_isTheNextDay", () => {
    expect(parsed("LFS next friday 9pm", THURSDAY_NOON).dates).toEqual(["2026-11-27"]);
  });

  it("parseGetiPost_thisFridayPostedFriday_isThatDay", () => {
    expect(parsed("LFS ce vendredi 21h", FRIDAY_NOON).dates).toEqual(["2026-11-27"]);
  });

  it("parseGetiPost_thisFridayPostedThursday_isTheNextDay", () => {
    expect(parsed("LFS this friday 9pm", THURSDAY_NOON).dates).toEqual(["2026-11-27"]);
  });

  it("parseGetiPost_weekendHabitInRecruitment_hasNoDate", () => {
    const post = parsed("LFP tank, dispo le week-end", THURSDAY_NOON, "lfp");

    expect(post.dates).toEqual([]);
    expect(post.availability.days).toEqual(["SAT", "SUN"]);
  });

  it("parseGetiPost_todayAsATurnOfPhraseInRecruitment_hasNoDate", () => {
    expect(parsed("Aujourd'hui, on recrute un tank Master", THURSDAY_NOON, "lfp").dates).toEqual([]);
  });

  it("parseGetiPost_todayInAScrimSearch_isThePostingDay", () => {
    expect(parsed("LFS aujourd'hui 21h", THURSDAY_NOON).dates).toEqual(["2026-11-26"]);
  });

  it("parseGetiPost_tonightInRecruitment_isThePostingDay", () => {
    expect(parsed("Tryouts ce soir 21h pour un tank", THURSDAY_NOON, "lfp").dates).toEqual(["2026-11-26"]);
  });

  it("parseGetiPost_withoutPostingDate_readsNoDate", () => {
    const post = parsed("LFS tonight 8pm UTC", null);

    expect(post.dates).toEqual([]);
    expect(post.availability).toEqual({ days: [], times: [{ from: 1200, to: null }], timezone: "UTC" });
  });
});

describe("parseGetiPost — soirées d'un scrim", () => {
  it("parseGetiPost_timeOnlyPostedBeforeTheSlot_isTheSameDay", () => {
    expect(parsed("LFS 3k5 21-23", THURSDAY_NOON).dates).toEqual(["2026-11-26"]);
  });

  it("parseGetiPost_timeOnlyPostedDuringTheSlot_isTheSameDay", () => {
    expect(parsed("LFS 3k5 21-23", "2026-11-26T21:59:00.000Z").dates).toEqual(["2026-11-26"]);
  });

  it("parseGetiPost_timeOnlyPostedOnceTheSlotIsOver_isTheNextDay", () => {
    // 23 h à Paris : le créneau « 21-23 » vient de finir.
    expect(parsed("LFS 3k5 21-23", "2026-11-26T22:00:00.000Z").dates).toEqual(["2026-11-27"]);
  });

  it("parseGetiPost_nowPostedAfterTheSlot_staysTheSameDay", () => {
    expect(parsed("LFS now 3k5 21-23", "2026-11-26T22:30:00.000Z").dates).toEqual(["2026-11-26"]);
  });

  it("parseGetiPost_namedDays_daysAreThoseOfTheDates", () => {
    const post = parsed("LFS Mardi et Jeudi 21h-23h", WEDNESDAY_NOON);

    expect(post.dates).toEqual(["2026-11-26", "2026-12-01"]);
    expect(post.availability.days).toEqual(["TUE", "THU"]);
  });

  it("parseGetiPost_everyEvening_hasNoDate", () => {
    const post = parsed("LFS tous les soirs 21h-23h", WEDNESDAY_NOON);

    expect(post.dates).toEqual([]);
    expect(post.availability.days).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
  });
});

describe("parseGetiPost — fuseau écrit, converti à l'heure de Paris", () => {
  it("parseGetiPost_noZone_isReadAsParisTime", () => {
    const post = parsed("LFS demain 21h-23h", THURSDAY_NOON);

    expect(post.availability).toEqual({ days: ["FRI"], times: [{ from: 1260, to: 1380 }], timezone: null });
  });

  it("parseGetiPost_utcInWinter_addsOneHour", () => {
    const post = parsed("LFS tomorrow 8pm-10pm UTC", THURSDAY_NOON);

    expect(post.dates).toEqual(["2026-11-27"]);
    expect(post.availability).toEqual({
      days: ["FRI"],
      times: [{ from: 1260, to: 1380 }],
      timezone: "UTC",
      statedTimes: [{ from: 1200, to: 1320 }],
    });
  });

  it("parseGetiPost_utcInSummer_addsTwoHours", () => {
    const post = parsed("LFS tomorrow 8pm-10pm UTC", SUMMER_NOON);

    expect(post.availability.times).toEqual([{ from: 1320, to: 1440 }]);
    expect(post.availability.statedTimes).toEqual([{ from: 1200, to: 1320 }]);
  });

  it("parseGetiPost_utcPlus1InSummer_addsOneHour", () => {
    expect(parsed("LFS tomorrow 20h-22h UTC+1", SUMMER_NOON).availability.times).toEqual([{ from: 1260, to: 1380 }]);
  });

  it("parseGetiPost_cetInSummer_staysParisTime", () => {
    const post = parsed("LFS tonight 21h-23h CET", SUMMER_NOON);

    expect(post.availability).toEqual({ days: ["WED"], times: [{ from: 1260, to: 1380 }], timezone: "CET" });
  });

  it("parseGetiPost_utcTheEveningBeforeTheOctoberChange_addsTwoHours", () => {
    // Samedi 24 octobre 2026 : dernière soirée à l'heure d'été.
    expect(parsed("LFS tonight 8pm UTC", "2026-10-24T10:00:00.000Z").availability.times).toEqual([{ from: 1320, to: null }]);
  });

  it("parseGetiPost_utcTheEveningOfTheOctoberChange_addsOneHour", () => {
    expect(parsed("LFS tonight 8pm UTC", "2026-10-25T10:00:00.000Z").availability.times).toEqual([{ from: 1260, to: null }]);
  });

  it("parseGetiPost_tomorrowAcrossTheMarchChange_usesTheOffsetOfTheTargetDay", () => {
    // Publiée le samedi 28 mars (heure d'hiver) pour le dimanche 29 (heure d'été).
    expect(parsed("LFS tomorrow 8pm UTC", "2026-03-28T10:00:00.000Z").availability.times).toEqual([{ from: 1320, to: null }]);
  });

  it("parseGetiPost_fridayEveningInNewYork_isSaturdayNightInParis", () => {
    const post = parsed("LFS Friday 9pm EST", THURSDAY_NOON);

    expect(post.dates).toEqual(["2026-11-28"]);
    expect(post.availability).toEqual({
      days: ["SAT"],
      times: [{ from: 180, to: null }],
      timezone: "EST",
      statedTimes: [{ from: 1260, to: null }],
    });
  });

  it("parseGetiPost_bst_addsOneHour", () => {
    expect(parsed("LFS tonight 8pm BST", SUMMER_NOON).availability.times).toEqual([{ from: 1260, to: null }]);
  });

  it("parseGetiPost_eetJustAfterMidnight_fallsOnThePreviousParisDay", () => {
    const post = parsed("LFS tomorrow 00:30 EET", THURSDAY_NOON);

    expect(post.dates).toEqual(["2026-11-26"]);
    expect(post.availability.times).toEqual([{ from: 1410, to: null }]);
  });

  it("parseGetiPost_tonightInAStatedZone_countsFromThatZonesDay", () => {
    // Vendredi 3 h à Paris, encore jeudi 18 h à Los Angeles : « tonight » est jeudi soir là-bas.
    const post = parsed("LFS tonight 9pm PST", "2026-11-27T02:00:00.000Z");

    expect(post.dates).toEqual(["2026-11-27"]);
    expect(post.availability.times).toEqual([{ from: 360, to: null }]);
  });

  it("parseGetiPost_habitualDaysInAStatedZone_shiftWithTheTimes", () => {
    const post = parsed("LFT tank, dispo Friday 9pm EST", THURSDAY_NOON, "lft");

    expect(post.dates).toEqual([]);
    expect(post.availability.days).toEqual(["SAT"]);
  });
});
