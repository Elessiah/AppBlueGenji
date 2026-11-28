import { describe, expect, it } from "@jest/globals";
import { prepareGetiText } from "@/lib/shared/geti/normalize";
import {
  getiCivilDay,
  getiParisOffsetMinutes,
  getiParisShiftMinutes,
  getiWallInstant,
  getiWrapMinutes,
  getiZoneOffsetMinutes,
  getiZoneRule,
  parseGetiTimezone,
} from "@/lib/shared/geti/zones";

/** Fuseaux des annonces GETI : heure de Paris sans `Intl`, sigles lus, conversion (heure d'été comprise). */

const NEW_YORK = { iana: "America/New_York" };

function zoneOf(text: string): string | null {
  return parseGetiTimezone(prepareGetiText(text));
}

/** Décalage de Paris selon `Intl`, pour vérifier la règle arithmétique. */
function intlParisOffset(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return (Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) - instant) / 60_000;
}

describe("getiParisOffsetMinutes", () => {
  it("getiParisOffsetMinutes_winterInstant_returns60", () => {
    expect(getiParisOffsetMinutes(Date.parse("2026-11-27T12:00:00.000Z"))).toBe(60);
  });

  it("getiParisOffsetMinutes_summerInstant_returns120", () => {
    expect(getiParisOffsetMinutes(Date.parse("2026-07-15T12:00:00.000Z"))).toBe(120);
  });

  it("getiParisOffsetMinutes_lastSundayOfMarch_switchesAt0100Utc", () => {
    expect(getiParisOffsetMinutes(Date.parse("2026-03-29T00:59:59.999Z"))).toBe(60);
    expect(getiParisOffsetMinutes(Date.parse("2026-03-29T01:00:00.000Z"))).toBe(120);
  });

  it("getiParisOffsetMinutes_lastSundayOfOctober_switchesAt0100Utc", () => {
    expect(getiParisOffsetMinutes(Date.parse("2026-10-25T00:59:59.999Z"))).toBe(120);
    expect(getiParisOffsetMinutes(Date.parse("2026-10-25T01:00:00.000Z"))).toBe(60);
  });

  it.each([
    "2025-03-30T00:30:00.000Z",
    "2025-03-30T01:30:00.000Z",
    "2025-10-26T00:30:00.000Z",
    "2025-10-26T01:30:00.000Z",
    "2027-03-28T00:30:00.000Z",
    "2027-03-28T01:30:00.000Z",
    "2027-10-31T00:30:00.000Z",
    "2027-10-31T01:30:00.000Z",
    "2028-01-01T00:00:00.000Z",
    "2028-12-31T23:30:00.000Z",
  ])("getiParisOffsetMinutes_%s_matchesIntl", (iso) => {
    const instant = Date.parse(iso);

    expect(getiParisOffsetMinutes(instant)).toBe(intlParisOffset(instant));
  });
});

describe("getiZoneRule", () => {
  it.each([
    ["Europe/Paris", { iana: "Europe/Paris" }],
    ["CET", { iana: "Europe/Paris" }],
    ["CEST", { iana: "Europe/Paris" }],
    ["BST", { iana: "Europe/London" }],
    ["EET", { iana: "Europe/Helsinki" }],
    ["EST", { iana: "America/New_York" }],
    ["EDT", { iana: "America/New_York" }],
    ["CST", { iana: "America/Chicago" }],
    ["PST", { iana: "America/Los_Angeles" }],
    ["cet", { iana: "Europe/Paris" }],
    ["UTC", { offset: 0 }],
    ["GMT", { offset: 0 }],
    ["UTC+1", { iana: "Europe/Paris" }],
    ["GMT+1", { iana: "Europe/Paris" }],
    ["UTC+01:00", { iana: "Europe/Paris" }],
    ["UTC+2", { offset: 120 }],
    ["GMT-5", { offset: -300 }],
    ["UTC+5:30", { offset: 330 }],
    ["UTC+14", { offset: 840 }],
    ["UTC-12", { offset: -720 }],
  ])("getiZoneRule_%s_returnsItsRule", (label, rule) => {
    expect(getiZoneRule(label)).toEqual(rule);
  });

  it.each([[null], [undefined], ["XYZ"], [""], ["UTC+15"], ["UTC-13"], ["UTC+1:75"], ["Europe/Berlin"]])(
    "getiZoneRule_%s_returnsNull",
    (label) => {
      expect(getiZoneRule(label)).toBeNull();
    },
  );
});

describe("getiZoneOffsetMinutes", () => {
  it("getiZoneOffsetMinutes_fixedOffset_returnsIt", () => {
    expect(getiZoneOffsetMinutes({ offset: 330 }, Date.parse("2026-07-15T12:00:00.000Z"))).toBe(330);
  });

  it("getiZoneOffsetMinutes_newYorkWinter_returnsMinus300", () => {
    expect(getiZoneOffsetMinutes(NEW_YORK, Date.parse("2026-11-27T12:00:00.000Z"))).toBe(-300);
  });

  it("getiZoneOffsetMinutes_newYorkSummer_returnsMinus240", () => {
    expect(getiZoneOffsetMinutes(NEW_YORK, Date.parse("2026-07-15T12:00:00.000Z"))).toBe(-240);
  });

  it("getiZoneOffsetMinutes_londonSummer_returns60", () => {
    expect(getiZoneOffsetMinutes({ iana: "Europe/London" }, Date.parse("2026-07-15T12:00:00.000Z"))).toBe(60);
  });
});

describe("getiWallInstant", () => {
  const DAY = Date.parse("2026-11-27T00:00:00.000Z");

  it("getiWallInstant_parisWinter_returnsUtcInstant", () => {
    expect(new Date(getiWallInstant(DAY, 23 * 60)).toISOString()).toBe("2026-11-27T22:00:00.000Z");
  });

  it("getiWallInstant_parisSummer_returnsUtcInstant", () => {
    const day = Date.parse("2026-07-15T00:00:00.000Z");

    expect(new Date(getiWallInstant(day, 23 * 60)).toISOString()).toBe("2026-07-15T21:00:00.000Z");
  });

  it("getiWallInstant_minutesBeyondMidnight_landsNextDay", () => {
    expect(new Date(getiWallInstant(DAY, 25 * 60)).toISOString()).toBe("2026-11-28T00:00:00.000Z");
  });

  it("getiWallInstant_fixedOffset_subtractsOffset", () => {
    expect(new Date(getiWallInstant(DAY, 20 * 60, { offset: -300 })).toISOString()).toBe("2026-11-28T01:00:00.000Z");
  });

  it("getiWallInstant_eveningOfTheOctoberChange_usesWinterTime", () => {
    const day = Date.parse("2026-10-25T00:00:00.000Z");

    expect(new Date(getiWallInstant(day, 21 * 60)).toISOString()).toBe("2026-10-25T20:00:00.000Z");
  });

  it("getiWallInstant_eveningBeforeTheOctoberChange_usesSummerTime", () => {
    const day = Date.parse("2026-10-24T00:00:00.000Z");

    expect(new Date(getiWallInstant(day, 21 * 60)).toISOString()).toBe("2026-10-24T19:00:00.000Z");
  });

  it("getiWallInstant_eveningOfTheMarchChange_usesSummerTime", () => {
    const day = Date.parse("2026-03-29T00:00:00.000Z");

    expect(new Date(getiWallInstant(day, 21 * 60)).toISOString()).toBe("2026-03-29T19:00:00.000Z");
  });
});

describe("getiCivilDay", () => {
  const LATE = Date.parse("2026-11-26T23:30:00.000Z");

  it("getiCivilDay_lateEveningUtc_isNextDayInParis", () => {
    expect(new Date(getiCivilDay(LATE)).toISOString()).toBe("2026-11-27T00:00:00.000Z");
  });

  it("getiCivilDay_fixedUtc_isSameDay", () => {
    expect(new Date(getiCivilDay(LATE, { offset: 0 })).toISOString()).toBe("2026-11-26T00:00:00.000Z");
  });

  it("getiCivilDay_earlyMorningUtc_isPreviousDayInNewYork", () => {
    const early = Date.parse("2026-11-27T02:00:00.000Z");

    expect(new Date(getiCivilDay(early, NEW_YORK)).toISOString()).toBe("2026-11-26T00:00:00.000Z");
  });
});

describe("getiParisShiftMinutes", () => {
  const WINTER = Date.parse("2026-11-27T00:00:00.000Z");
  const SUMMER = Date.parse("2026-07-15T00:00:00.000Z");

  it("getiParisShiftMinutes_paris_returns0", () => {
    expect(getiParisShiftMinutes({ iana: "Europe/Paris" }, SUMMER, 21 * 60)).toBe(0);
  });

  it("getiParisShiftMinutes_utcWinter_returns60", () => {
    expect(getiParisShiftMinutes({ offset: 0 }, WINTER, 20 * 60)).toBe(60);
  });

  it("getiParisShiftMinutes_utcSummer_returns120", () => {
    expect(getiParisShiftMinutes({ offset: 0 }, SUMMER, 20 * 60)).toBe(120);
  });

  it("getiParisShiftMinutes_utcPlus1Summer_returns60", () => {
    expect(getiParisShiftMinutes({ offset: 60 }, SUMMER, 20 * 60)).toBe(60);
  });

  it("getiParisShiftMinutes_newYorkWinter_returns360", () => {
    expect(getiParisShiftMinutes(NEW_YORK, WINTER, 21 * 60)).toBe(360);
  });

  it("getiParisShiftMinutes_newYorkWeekUsChangedFirst_returns300", () => {
    // Les États-Unis passent à l'heure d'été le 8 mars 2026, Paris le 29.
    const day = Date.parse("2026-03-15T00:00:00.000Z");

    expect(getiParisShiftMinutes(NEW_YORK, day, 21 * 60)).toBe(300);
  });

  it("getiParisShiftMinutes_newYorkWeekParisChangedFirst_returns300", () => {
    // Paris revient à l'heure d'hiver le 25 octobre 2026, les États-Unis le 1er novembre.
    const day = Date.parse("2026-10-28T00:00:00.000Z");

    expect(getiParisShiftMinutes(NEW_YORK, day, 21 * 60)).toBe(300);
  });

  it("getiParisShiftMinutes_london_returns60", () => {
    expect(getiParisShiftMinutes({ iana: "Europe/London" }, SUMMER, 20 * 60)).toBe(60);
  });

  it("getiParisShiftMinutes_helsinki_returnsMinus60", () => {
    expect(getiParisShiftMinutes({ iana: "Europe/Helsinki" }, WINTER, 20 * 60)).toBe(-60);
  });
});

describe("getiWrapMinutes", () => {
  it("getiWrapMinutes_overTheDay_wraps", () => {
    expect(getiWrapMinutes(1500)).toBe(60);
  });

  it("getiWrapMinutes_negative_wraps", () => {
    expect(getiWrapMinutes(-30)).toBe(1410);
  });

  it("getiWrapMinutes_startAtMidnight_returns0", () => {
    expect(getiWrapMinutes(1440)).toBe(0);
  });

  it("getiWrapMinutes_endAtMidnight_stays1440", () => {
    expect(getiWrapMinutes(1440, true)).toBe(1440);
  });
});

describe("parseGetiTimezone", () => {
  it.each([
    ["LFS 3k5 20-22 CET", "CET"],
    ["LFS 21h-23h CEST", "CEST"],
    ["lfs 20-22 cet eu pc", "CET"],
    ["lfs 21h cest", "CEST"],
    ["LFS 20h UTC+1", "UTC+1"],
    ["LFS 20h UTC +2", "UTC+2"],
    ["LFS 8pm GMT-5", "GMT-5"],
    ["lfs 20-22 utc", "UTC"],
    ["LFS 8pm BST", "BST"],
    ["LFS 9pm EST", "EST"],
    ["lfs 9pm est", "EST"],
    ["LFS 6pm PST", "PST"],
    ["LFS 22h EET", "EET"],
    ["Scrim 21h heure française", "Europe/Paris"],
    ["Scrim 21h (heure FR)", "Europe/Paris"],
    ["LF Sub 3k3 PC tank 21h FR", "Europe/Paris"],
    ["Scrim 9pm Paris time", "Europe/Paris"],
    ["Scrim 20h heure du Québec", "EST"],
  ])("parseGetiTimezone_%s_returnsItsLabel", (text, zone) => {
    expect(zoneOf(text)).toBe(zone);
  });

  it.each([
    ["LFS 3k5 21h-23h ce soir"],
    ["Dispo 15h cet après-midi"],
    ["RDV 15H CET APRÈS-MIDI"],
    ["On joue 18 cet été"],
    ["Dispo à 20h cet horaire me va"],
    ["Le scrim de 21h est bien passé"],
    ["Notre support est dispo, west coast"],
    ["LFS 20h UTC+15"],
    ["LFS CE SOIR 21H-23H, NOTRE ÉQUIPE EST PRÊTE"],
    ["LFS 21H EST BON POUR NOUS"],
    ["LFS EU WEST CE SOIR"],
  ])("parseGetiTimezone_%s_returnsNull", (text) => {
    expect(zoneOf(text)).toBeNull();
  });

  it("parseGetiTimezone_euWestThenCet_returnsCet", () => {
    expect(zoneOf("LFS EU WEST 21h CET")).toBe("CET");
  });

  it.each([
    ["LFS 9PM EST", "EST"],
    ["LFS 21:00 EST", "EST"],
    ["LFS 21H BST", "BST"],
    ["LFS 8PM WEST", "WEST"],
  ])("parseGetiTimezone_capitalCodeAfterATime_%s_returnsIt", (text, zone) => {
    expect(zoneOf(text)).toBe(zone);
  });
});

describe("parseGetiTimezone — cycle 2 : sigles-mots en capitales", () => {
  it.each([
    ["LFT dps, available 8pm-11pm. Timezone: EST", "EST"],
    ["LFS TZ PST", "PST"],
    ["LFS fuseau : CST", "CST"],
    ["LFT playing in EST", "EST"],
    ["LFS tonight (EDT)", "EDT"],
    ["LFS EST 9PM", "EST"],
    ["LFS 8-10 EST", "EST"],
    ["LFS 20-22 BST", "BST"],
  ])("parseGetiTimezone_%s_returnsIt", (text, zone) => {
    expect(zoneOf(text)).toBe(zone);
  });

  it.each([
    ["LFS 3K5 WEST 21h-23h"],
    ["LFT DPS 4500 WEST EU dispo 21h"],
    ["LFS C'EST 9PM"],
    ["LFT playing in WEST EU"],
  ])("parseGetiTimezone_%s_returnsNull", (text) => {
    expect(zoneOf(text)).toBeNull();
  });
});

describe("parseGetiTimezone — cycle 3 : paliers de rang, régions, « EST » français", () => {
  it("parseGetiTimezone_rankTierBeforeWest_isNull", () => {
    expect(zoneOf("LFT Diamond 1-3 WEST EU")).toBeNull();
  });

  it("parseGetiTimezone_rankTierBeforeEst_isNull", () => {
    expect(zoneOf("LFS Master 1-2 EST")).toBeNull();
  });

  it("parseGetiTimezone_scoreBeforeEst_isNull", () => {
    expect(zoneOf("LFS on a gagné 2-1 EST")).toBeNull();
  });

  it("parseGetiTimezone_bareHourRangeBeforeEst_isEst", () => {
    expect(zoneOf("LFS 8-10 EST")).toBe("EST");
  });

  it("parseGetiTimezone_euWestInParentheses_isNull", () => {
    expect(zoneOf("LFS EU (WEST)")).toBeNull();
  });

  it("parseGetiTimezone_quiEstBefore8pm_isNull", () => {
    expect(zoneOf("LFS QUI EST 8PM")).toBeNull();
  });
});
