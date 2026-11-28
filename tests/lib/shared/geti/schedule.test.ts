import { describe, expect, it } from "@jest/globals";
import { getiPostEndsAt, parseGetiPost, type GetiCategory, type GetiParsedPost } from "@/lib/shared/geti";
import { GETI_RETENTION_MAX_DAYS } from "@/lib/shared/geti/ingest";
import { GETI_EDIT_WINDOW_MS } from "@/lib/shared/geti/parse-post";
import { GETI_CATEGORIES, type GetiRawPost } from "@/lib/shared/geti/types";
import { getiRawPost } from "../../../helpers/geti";

/**
 * Dates et horaires d'une annonce : mots relatifs résolus depuis la date de
 * publication (jamais l'heure de lecture), fuseau écrit converti à l'heure de Paris.
 *
 * Repères : le jeudi 26 novembre 2026 ; 12:00Z = 13 h à Paris.
 */

const WEDNESDAY_NOON = "2026-11-25T12:00:00.000Z";
const THURSDAY_NOON = "2026-11-26T12:00:00.000Z";
const SATURDAY_NOON = "2026-11-28T12:00:00.000Z";
const MONDAY_NOON = "2026-11-23T12:00:00.000Z";
const SUMMER_NOON = "2026-07-15T12:00:00.000Z";

function parsed(content: string, postedAt: string | null, category: GetiCategory = "lfs"): GetiParsedPost {
  return parseGetiPost(getiRawPost(content, { category, postedAt }));
}


/**
 * Table de cas « une annonce → ses dates », une ligne par cas :
 * `nom ¦ texte ¦ publication ¦ modification ¦ catégorie ¦ dates` (« - » : absent ou
 * aucune ; dates séparées par des virgules). Une ligne « // … » est un commentaire.
 */
function dateCases(table: string): Array<[string, GetiRawPost, string[]]> {
  return table
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//"))
    .map((line) => {
      const [name, content, postedAt, editedAt, category, dates] = line.split(" ¦ ");
      const known = GETI_CATEGORIES.find((value) => value === category);
      const raw = getiRawPost(content, {
        ...(postedAt === "-" ? { postedAt: null } : { postedAt }),
        ...(editedAt === "-" ? {} : { editedAt }),
        ...(known === undefined ? {} : { category: known }),
      });
      return [name, raw, dates === "-" ? [] : dates.split(",")];
    });
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

  it.each(
    dateCases(`
      parseGetiPost_thisWeekendPostedSaturday_isSaturdayAndSunday ¦ LFS this weekend 9pm ¦ 2026-11-28T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-28,2026-11-29
      parseGetiPost_thisWeekendPostedSunday_isThatSunday ¦ LFS ce we 21h ¦ 2026-11-29T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-29
      parseGetiPost_nextMondayPostedMonday_isAWeekLater ¦ LFS lundi prochain 21h ¦ 2026-11-23T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-30
      parseGetiPost_nextMondayPostedThursday_isTheComingMonday ¦ LFS lundi prochain 21h ¦ 2026-11-26T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-30
      parseGetiPost_nextFridayPostedThursday_isTheNextDay ¦ LFS next friday 9pm ¦ 2026-11-26T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-27
      parseGetiPost_thisFridayPostedFriday_isThatDay ¦ LFS ce vendredi 21h ¦ 2026-11-27T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-27
      parseGetiPost_thisFridayPostedThursday_isTheNextDay ¦ LFS this friday 9pm ¦ 2026-11-26T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-27
    `),
  )("%s", (_name, raw, dates) => {
    expect(parseGetiPost(raw).dates).toEqual(dates);
  });

  it("parseGetiPost_weekendHabitInRecruitment_hasNoDate", () => {
    const post = parsed("LFP tank, dispo le week-end", THURSDAY_NOON, "lfp");

    expect(post.dates).toEqual([]);
    expect(post.availability.days).toEqual(["SAT", "SUN"]);
  });

  it.each(
    dateCases(`
      parseGetiPost_todayAsATurnOfPhraseInRecruitment_hasNoDate ¦ Aujourd'hui, on recrute un tank Master ¦ 2026-11-26T12:00:00.000Z ¦ - ¦ lfp ¦ -
      parseGetiPost_todayInAScrimSearch_isThePostingDay ¦ LFS aujourd'hui 21h ¦ 2026-11-26T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-26
      parseGetiPost_tonightInRecruitment_isThePostingDay ¦ Tryouts ce soir 21h pour un tank ¦ 2026-11-26T12:00:00.000Z ¦ - ¦ lfp ¦ 2026-11-26
    `),
  )("%s", (_name, raw, dates) => {
    expect(parseGetiPost(raw).dates).toEqual(dates);
  });

  it("parseGetiPost_withoutPostingDate_readsNoDate", () => {
    const post = parsed("LFS tonight 8pm UTC", null);

    expect(post.dates).toEqual([]);
    expect(post.availability).toEqual({ days: [], times: [{ from: 1200, to: null }], timezone: "UTC" });
  });
});

describe("parseGetiPost — soirées d'un scrim", () => {
  it.each(
    dateCases(`
      parseGetiPost_timeOnlyPostedBeforeTheSlot_isTheSameDay ¦ LFS 3k5 21-23 ¦ 2026-11-26T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-26
      parseGetiPost_timeOnlyPostedDuringTheSlot_isTheSameDay ¦ LFS 3k5 21-23 ¦ 2026-11-26T21:59:00.000Z ¦ - ¦ lfs ¦ 2026-11-26
      // 23 h à Paris : le créneau « 21-23 » vient de finir.
      parseGetiPost_timeOnlyPostedOnceTheSlotIsOver_isTheNextDay ¦ LFS 3k5 21-23 ¦ 2026-11-26T22:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-27
      parseGetiPost_nowPostedAfterTheSlot_staysTheSameDay ¦ LFS now 3k5 21-23 ¦ 2026-11-26T22:30:00.000Z ¦ - ¦ lfs ¦ 2026-11-26
    `),
  )("%s", (_name, raw, dates) => {
    expect(parseGetiPost(raw).dates).toEqual(dates);
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

  it("parseGetiPost_utcPlus1InSummer_staysParisTime", () => {
    // « UTC+1 » dit l'heure française dans la communauté, été comme hiver (comme « CET »).
    expect(parsed("LFS tomorrow 20h-22h UTC+1", SUMMER_NOON).availability.times).toEqual([{ from: 1200, to: 1320 }]);
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

describe("parseGetiPost — cycle 1 : nuit, fuseaux par horaire, tournures habituelles, modification", () => {
  it.each(
    dateCases(`
      // Vendredi 27, 22 h à Paris : « cette nuit 1h-3h » est la nuit de vendredi à samedi.
      parseGetiPost_tonightAfterMidnightPostedInTheEvening_isTheNextDay ¦ LFS cette nuit 1h-3h ¦ 2026-11-27T21:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-28
      // Samedi 28, 0 h 30 à Paris : 1 h n'est pas encore passée.
      parseGetiPost_tonightAfterMidnightPostedAfterMidnight_isTheSameDay ¦ LFS cette nuit 1h-3h ¦ 2026-11-27T23:30:00.000Z ¦ - ¦ lfs ¦ 2026-11-28
      parseGetiPost_tonightSingleTimeAfterMidnight_isTheNextDay ¦ LFS ce soir 0h30 ¦ 2026-11-27T21:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-28
      parseGetiPost_tonightEveningSlotAcrossMidnight_staysTheSameDay ¦ LFS ce soir 22h-1h ¦ 2026-11-27T20:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-27
    `),
  )("%s", (_name, raw, dates) => {
    expect(parseGetiPost(raw).dates).toEqual(dates);
  });

  it("parseGetiPost_twoSlotsEst_secondSlotWrapsAfterTheFirst", () => {
    const post = parsed("LFS Friday 3pm and 9pm EST", THURSDAY_NOON);

    expect(post.dates).toEqual(["2026-11-27"]);
    expect(post.availability.times).toEqual([
      { from: 1260, to: null },
      { from: 180, to: null },
    ]);
  });

  it("parseGetiPost_twoSlotsEst_endsAfterTheSecondSlotNextDay", () => {
    const post = parsed("LFS Friday 3pm and 9pm EST", THURSDAY_NOON);

    // 9pm EST = 3 h à Paris le samedi, + 2 h pour une heure seule : samedi 5 h Paris = 04:00Z.
    expect(getiPostEndsAt(post)).toBe(Date.parse("2026-11-28T04:00:00.000Z"));
  });

  it.each(
    dateCases(`
      // 6pm EDT le 29/10 = 23 h à Paris ; 6pm EST le 02/11 = minuit à Paris, le 03/11.
      parseGetiPost_datesAcrossTheUsDstChange_eachDateFollowsItsOwnShift ¦ LFS 29/10 et 02/11 6pm EST ¦ 2026-10-28T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-10-29,2026-11-03
      parseGetiPost_duWeekEnd_isAHabitNotADate ¦ LFT dispo en soirée et du week-end ¦ 2026-11-23T12:00:00.000Z ¦ - ¦ lft ¦ -
      parseGetiPost_samediProLeague_isNotNextSaturday ¦ LFT on vise la samedi pro league ¦ 2026-11-23T12:00:00.000Z ¦ - ¦ lft ¦ -
      // Publiée le lundi 23 : le samedi d'après est le 28.
      parseGetiPost_ceSamediProchain_isOnlyNextWeeksSaturday ¦ LFS ce samedi prochain 21h ¦ 2026-11-23T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-28
      parseGetiPost_editedTheNextDay_resolvesTonightFromTheEdit ¦ LFS ce soir 21h-23h ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T17:00:00.000Z ¦ lfs ¦ 2026-11-24
      parseGetiPost_editDateBeforeThePostDate_usesThePostDate ¦ LFS ce soir 21h-23h ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-20T17:00:00.000Z ¦ lfs ¦ 2026-11-23
    `),
  )("%s", (_name, raw, dates) => {
    expect(parseGetiPost(raw).dates).toEqual(dates);
  });
});

describe("parseGetiPost — cycle 2 : changement d'heure, nuit en cours, place prise, « samedi pro »", () => {
  it("parseGetiPost_datesAcrossTheUsDstChange_endsAtTheLastDatesRealEnd", () => {
    const post = parsed("LFS 29/10 et 02/11 6pm EST", "2026-10-28T12:00:00.000Z");

    expect(post.dates).toEqual(["2026-10-29", "2026-11-03"]);
    expect(post.availability.times).toEqual([{ from: 0, to: null }]);
    // 6pm EST le 02/11 = minuit à Paris le 03/11, + 2 h pour une heure seule : 02 h Paris = 01:00Z.
    expect(getiPostEndsAt(post)).toBe(Date.parse("2026-11-03T01:00:00.000Z"));
  });

  it.each(
    dateCases(`
      // Samedi 28, 1 h 30 à Paris : la nuit en cours.
      parseGetiPost_tonightAfterMidnightPostedDuringThatNight_isTheSameDay ¦ LFS cette nuit 1h-3h ¦ 2026-11-28T00:30:00.000Z ¦ - ¦ lfs ¦ 2026-11-28
      parseGetiPost_tonightAfterMidnightPostedAtSixSharp_isTheNextDay ¦ LFS cette nuit 1h-3h ¦ 2026-11-28T05:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-29
      // 5 h 59 à Paris : le créneau 1 h – 3 h de cette nuit-là est fini, l'annonce vise la nuit suivante.
      parseGetiPost_tonightAfterMidnightPostedJustBeforeSixAfterTheSlot_isTheNextNight ¦ LFS cette nuit 1h-3h ¦ 2026-11-28T04:59:00.000Z ¦ - ¦ lfs ¦ 2026-11-29
      parseGetiPost_editMarkingTheSpotFound_keepsThePostDay ¦ LFS ce soir 21h-23h (trouvé merci) ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-23
      parseGetiPost_editSayingNotFoundYet_resolvesFromTheEdit ¦ LFS ce soir 21h-23h, toujours pas trouvé ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-24
      parseGetiPost_lftEditWithFound_resolvesFromTheEdit ¦ LFT dispo ce soir, found nothing yet ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lft ¦ 2026-11-24
      parseGetiPost_samediProPostedThatSaturday_isNextWeek ¦ LFS samedi pro 21h ¦ 2026-11-28T12:00:00.000Z ¦ - ¦ lfs ¦ 2026-12-05
    `),
  )("%s", (_name, raw, dates) => {
    expect(parseGetiPost(raw).dates).toEqual(dates);
  });
});

describe("parseGetiPost — cycle 3 : place prise niée, nuit finie, changement d'heure par date, « pro-league »", () => {
  it.each(
    dateCases(`
      parseGetiPost_editSayingPasEncoreTrouve_resolvesFromTheEdit ¦ LFS ce soir 21h-23h, pas encore trouvé ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-24
      parseGetiPost_editSayingStillNotFound_resolvesFromTheEdit ¦ LFS tonight 9pm-11pm, still not found ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-24
      parseGetiPost_editSayingHaventFound_resolvesFromTheEdit ¦ LFS tonight 9pm-11pm, haven't found anyone ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-24
      parseGetiPost_editWithQuiSeTrouve_resolvesFromTheEdit ¦ LFS ce soir 21h-23h, équipe qui se trouve en EU ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-24
      parseGetiPost_negationInAnEarlierClause_keepsThePostDay ¦ LFS ce soir 21h-23h, pas de souci. Trouvé ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-23
      parseGetiPost_editSayingOnATrouve_keepsThePostDay ¦ LFS ce soir 21h-23h (on a trouvé) ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-23
      // Samedi 28, 4 h à Paris : le créneau 1 h – 3 h est fini.
      parseGetiPost_tonightAfterMidnightPostedAfterTheSlotEnded_isTheNextNight ¦ LFS cette nuit 1h-3h ¦ 2026-11-28T03:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-29
      // Samedi 28, 2 h à Paris : en plein créneau.
      parseGetiPost_tonightAfterMidnightPostedDuringTheSlot_isTheSameNight ¦ LFS cette nuit 1h-3h ¦ 2026-11-28T01:00:00.000Z ¦ - ¦ lfs ¦ 2026-11-28
      // 0 h 30 seule finit à 2 h 30 : écrite à 5 h 30, l'annonce vise la nuit suivante.
      parseGetiPost_ceSoir0h30PostedAt0530_isTheNextNight ¦ LFS ce soir 0h30 ¦ 2026-11-28T04:30:00.000Z ¦ - ¦ lfs ¦ 2026-11-29
    `),
  )("%s", (_name, raw, dates) => {
    expect(parseGetiPost(raw).dates).toEqual(dates);
  });

  it("parseGetiPost_datesAcrossTheUsDstChange_storesTheEarlierDatesShift", () => {
    const post = parsed("LFS 29/10 et 02/11 6pm EST", "2026-10-28T12:00:00.000Z");

    // 29/10 : 6pm EDT = 23 h à Paris, 1 380 minutes après le minuit gardé (0 h, celui du 03/11).
    expect(post.availability.dateShifts).toEqual([1380, 0]);
  });

  it("parseGetiPost_parisPost_hasNoDateShifts", () => {
    expect(parsed("LFS 29/10 et 02/11 21h", "2026-10-28T12:00:00.000Z").availability.dateShifts).toBeUndefined();
  });

  it("parseGetiPost_namedDayAcrossTheUsDstChange_followsTheLastDatesShift", () => {
    const post = parsed("LFT dispo lundi 6pm EST, essais 29/10 et 02/11", "2026-10-28T12:00:00.000Z", "lft");

    // Les horaires gardés sont à 0 h (décalage du 02/11) : lundi 6pm EST tombe le mardi à Paris.
    expect(post.availability.days).toContain("TUE");
    expect(post.availability.days).not.toContain("MON");
  });

  it("parseGetiPost_samediProHyphenLeague_isThatSaturday", () => {
    expect(parsed("LFS samedi pro-league 21h", SATURDAY_NOON).dates).toEqual(["2026-11-28"]);
  });
});

describe("parseGetiPost — revue sécurité 1 : modification qui clôt, horodatages aberrants, récit du matin, dates confondues", () => {
  const TUESDAY_MORNING = "2026-11-24T08:00:00.000Z";

  function editedAt(content: string, editedAt: string): GetiParsedPost {
    return parseGetiPost(getiRawPost(content, { category: "lfs", postedAt: MONDAY_NOON, editedAt }));
  }

  it.each([
    ["LFS ce soir 21h-23h complet merci"],
    ["LFS ce soir 21h-23h, c'est bon pour nous"],
    ["LFS ce soir 21h-23h (plus dispo)"],
    ["LFS ce soir 21h-23h annulé"],
    ["LFS ce soir 21h-23h merci à tous"],
    ["LFS ce soir 21h-23h GG"],
    ["LFS tonight 9pm-11pm booked"],
    ["LFS tonight 9pm-11pm done"],
    ["LFS tonight 9pm-11pm taken"],
    ["LFS tonight 9pm-11pm closed"],
    ["LFS tonight 9pm-11pm cancelled"],
  ])("parseGetiPost_editClosing_%s_keepsThePostDay", (content) => {
    expect(editedAt(content, TUESDAY_MORNING).dates).toEqual(["2026-11-23"]);
  });

  it.each(
    dateCases(`
      parseGetiPost_editWithEquipeComplete_resolvesFromTheEdit ¦ Équipe complète cherche scrim ce soir 21h-23h ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-24
      parseGetiPost_editWithPasComplet_resolvesFromTheEdit ¦ LFS ce soir 21h-23h, pas complet ¦ 2026-11-23T12:00:00.000Z ¦ 2026-11-24T08:00:00.000Z ¦ lfs ¦ 2026-11-24
      // Fenêtre : la plus longue durée de garde (14 jours) plus un jour, soit 15 jours.
      parseGetiPost_editAtTheEndOfTheWindow_resolvesFromTheEdit ¦ LFS ce soir 21h-23h ¦ 2026-11-23T12:00:00.000Z ¦ 2026-12-08T12:00:00.000Z ¦ lfs ¦ 2026-12-08
      parseGetiPost_editJustBeyondTheWindow_keepsThePostDay ¦ LFS ce soir 21h-23h ¦ 2026-11-23T12:00:00.000Z ¦ 2026-12-08T12:00:01.000Z ¦ lfs ¦ 2026-11-23
      parseGetiPost_editAtTheLastJavaScriptDate_doesNotThrowAndKeepsThePostDay ¦ LFS demain 21h-23h ¦ 2026-11-23T12:00:00.000Z ¦ +275760-09-13T00:00:00.000Z ¦ lfs ¦ 2026-11-24
      parseGetiPost_postedAtTheLastJavaScriptDate_readsNoDate ¦ LFS demain 21h-23h ¦ +275760-09-13T00:00:00.000Z ¦ - ¦ lfs ¦ -
    `),
  )("%s", (_name, raw, dates) => {
    expect(parseGetiPost(raw).dates).toEqual(dates);
  });

  it("parseGetiPost_lftStoryCeMatin_readsNoDate", () => {
    const post = parsed("LFT Ce matin j'ai quitté ma team, dispo lundi soir", WEDNESDAY_NOON, "lft");

    expect(post.dates).toEqual([]);
    expect(post.availability.days).toEqual(["MON"]);
  });

  it("parseGetiPost_lfsCeMatin_isThePostingDay", () => {
    expect(parsed("LFS ce matin 10h-12h", WEDNESDAY_NOON).dates).toEqual(["2026-11-25"]);
  });

  it("parseGetiPost_twoDaysOnEitherSideOfTheUsChange_keepsBothEveningsSorted", () => {
    // Vendredi 6 mars 2026 : samedi 6pm EST → dimanche 0 h à Paris, dimanche 6pm EDT → dimanche 23 h.
    const post = parsed("LFS samedi et dimanche 6pm EST", "2026-03-06T12:00:00.000Z");

    expect(post.dates).toEqual(["2026-03-08", "2026-03-08"]);
    expect(post.availability.times).toEqual([{ from: 1380, to: null }]);
    expect(post.availability.dateShifts).toEqual([-1380, 0]);
  });
});

describe("parseGetiPost — revue sécurité 2 : mots de clôture d'une modification du lendemain", () => {
  const TUESDAY_MORNING = "2026-11-24T08:00:00.000Z";

  function editedAt(content: string): GetiParsedPost {
    return parseGetiPost(getiRawPost(content, { category: "lfs", postedAt: MONDAY_NOON, editedAt: TUESDAY_MORNING }));
  }

  it.each([
    ["LFS ce soir 21h-23h, c'est complet"],
    ["LFS ce soir 21h-23h, nous sommes complets"],
    ["LFS tonight 9pm-11pm, we are complete"],
    ["LFS ce soir 21h-23h c'est bon merci"],
    ["LFS ce soir 21h-23h, pas de souci c'est bon merci"],
    ["LFS ce soir 21h-23h pas de souci trouvé"],
  ])("parseGetiPost_editClosing_%s_keepsThePostDay", (content) => {
    expect(editedAt(content).dates).toEqual(["2026-11-23"]);
  });

  it.each([
    ["L'équipe est complète, LFS ce soir 21h-23h"],
    ["LFS complete team ce soir 21h"],
    ["LFS ce soir 21h, complete roster wanted"],
    ["LFS ce soir 21h-23h, merci à tous d'avance"],
    ["LFS ce soir 21h-23h c'est bon niveau"],
    ["LFS tonight 9pm, tank taken, need dps"],
    ["LFS tonight, done by 11pm"],
    ["LFS ce soir 21h-23h, pourvu qu'on trouve vite"],
  ])("parseGetiPost_editStillOpen_%s_resolvesFromTheEdit", (content) => {
    expect(editedAt(content).dates).toEqual(["2026-11-24"]);
  });

  it("GETI_EDIT_WINDOW_MS_coversTheLongestRetention", () => {
    expect(GETI_EDIT_WINDOW_MS).toBeGreaterThanOrEqual(GETI_RETENTION_MAX_DAYS * 24 * 60 * 60 * 1000);
  });

  it("parseGetiPost_utc0100InSummer_addsOneHour", () => {
    // Écrit aux minutes près, « UTC+01:00 » est un vrai décalage fixe (pas l'heure française).
    expect(parsed("LFS tomorrow 20h-22h UTC+01:00", SUMMER_NOON).availability.times).toEqual([{ from: 1260, to: 1380 }]);
  });
});
