import { describe, expect, it } from "@jest/globals";

import type { GetiCategory, GetiFilter } from "@/lib/shared/geti";
import {
  GETI_ALERT_FRESH_MINUTES,
  GETI_ALERT_NAME_MAX,
  GETI_ALERT_SEARCH_MAX,
  getiAlertFilter,
  getiAlertName,
  isGetiAlertNameInput,
  getiAlertSearch,
  isFreshGetiPost,
  matchingGetiAlerts,
} from "@/lib/shared/geti/alerts";
import { parsedGetiPost } from "../../../helpers/geti";

/** Alertes GETI : recherche gardée, nom, fraîcheur d'une annonce, correspondance. */

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const MINUTE_MS = 60_000;

describe("getiAlertSearch", () => {
  // Une recherche de scrim (`lfs`) n'a pas de filtre de rôle.
  it.each<[string, GetiCategory, string, string]>([
    ["pageSearchWithAgePageAndClosed_keepsFiltersOnly", "lfp", "?role=tank&age=3&p=2&closed=1", "?role=tank"],
    ["unorderedAndUnknownParams_returnsCanonicalForm", "lfp", "?reg=eu&inconnu=1&role=tank", "?role=tank&reg=eu"],
    ["noFilter_returnsEmptySearch", "lft", "", ""],
    ["filterNotOfferedByCategory_dropsIt", "lfs", "?role=tank", ""],
  ])("getiAlertSearch_%s", (_case, category, input, expected) => {
    expect(getiAlertSearch(category, input)).toBe(expected);
  });

  it("getiAlertSearch_oversizedInput_returnsNull", () => {
    const search = getiAlertSearch("lfp", `?role=${"x".repeat(GETI_ALERT_SEARCH_MAX * 4)}`);

    expect(search).toBeNull();
  });
});

describe("getiAlertFilter", () => {
  it("getiAlertFilter_storedSearch_neverShowsClosedNorLimitsAge", () => {
    const filter = getiAlertFilter("lfp", "?role=tank");

    expect(filter).toMatchObject({ category: "lfp", roles: ["TANK"], hideClosed: true, maxAgeHours: null });
  });
});

describe("getiAlertName", () => {
  it("getiAlertName_nameAtMaxLength_isKept", () => {
    const name = "a".repeat(GETI_ALERT_NAME_MAX);

    expect(getiAlertName(name)).toBe(name);
  });

  it("getiAlertName_nameOverMaxLength_returnsUndefined", () => {
    expect(getiAlertName("a".repeat(GETI_ALERT_NAME_MAX + 1))).toBeUndefined();
  });

  it("getiAlertName_blankName_returnsNull", () => {
    expect(getiAlertName("   ")).toBeNull();
  });

  it("getiAlertName_missingName_returnsNull", () => {
    expect(getiAlertName(undefined)).toBeNull();
  });

  it("getiAlertName_onlyHangulFillers_returnsNull", () => {
    expect(getiAlertName("ㅤㅤᅟ")).toBeNull();
  });

  it("getiAlertName_fullwidthLetters_areNormalizedByNfkc", () => {
    expect(getiAlertName("Ｔａｎｋ")).toBe("Tank");
  });

  it("getiAlertName_tagCharacters_areRemoved", () => {
    expect(getiAlertName("Tank\u{E0041}\u{E0042} EU")).toBe("Tank EU");
  });

  it("isGetiAlertNameInput_stringNullOrMissing_isAccepted", () => {
    expect([isGetiAlertNameInput("Tank"), isGetiAlertNameInput(null), isGetiAlertNameInput(undefined)]).toEqual([true, true, true]);
  });

  it("isGetiAlertNameInput_number_isRefused", () => {
    expect(isGetiAlertNameInput(5)).toBe(false);
  });

  it("getiAlertName_notAString_returnsUndefined", () => {
    expect(getiAlertName(42)).toBeUndefined();
  });

  it("getiAlertName_controlAndDirectionCharacters_areReplacedBySingleSpaces", () => {
    expect(getiAlertName("  Tank\u202E\n\u200BEU  ")).toBe("Tank EU");
  });
});

describe("isFreshGetiPost", () => {
  it("isFreshGetiPost_postedExactlyAtTheLimit_isFresh", () => {
    expect(isFreshGetiPost(NOW - GETI_ALERT_FRESH_MINUTES * MINUTE_MS, null, NOW)).toBe(true);
  });

  it("isFreshGetiPost_postedJustOverTheLimit_isStale", () => {
    expect(isFreshGetiPost(NOW - GETI_ALERT_FRESH_MINUTES * MINUTE_MS - 1, null, NOW)).toBe(false);
  });

  it("isFreshGetiPost_oldPostEditedRecently_isFresh", () => {
    expect(isFreshGetiPost(NOW - 5 * 24 * 60 * MINUTE_MS, NOW - MINUTE_MS, NOW)).toBe(true);
  });
});

describe("matchingGetiAlerts", () => {
  const tankAlert = { id: 1, category: "lfp" as const, search: "?role=tank" };

  it("matchingGetiAlerts_postMatchingTheFilter_returnsTheAlert", () => {
    const post = parsedGetiPost({ category: "lfp", roles: ["TANK"] });

    expect(matchingGetiAlerts(post, "lfp", [tankAlert], new Map(), NOW)).toEqual([tankAlert]);
  });

  it("matchingGetiAlerts_alertOfAnotherCategory_returnsNothing", () => {
    const post = parsedGetiPost({ category: "lft", roles: ["TANK"] });

    expect(matchingGetiAlerts(post, "lft", [tankAlert], new Map(), NOW)).toEqual([]);
  });

  it("matchingGetiAlerts_postWithAnotherRole_returnsNothing", () => {
    const post = parsedGetiPost({ category: "lfp", roles: ["SUPPORT"] });

    expect(matchingGetiAlerts(post, "lfp", [tankAlert], new Map(), NOW)).toEqual([]);
  });

  it("matchingGetiAlerts_closedPost_returnsNothing", () => {
    const post = parsedGetiPost({ category: "lfp", roles: ["TANK"], closed: true });

    expect(matchingGetiAlerts(post, "lfp", [tankAlert], new Map(), NOW)).toEqual([]);
  });

  it("matchingGetiAlerts_alertWithoutFilter_matchesEveryOpenPostOfItsCategory", () => {
    const everything = { id: 2, category: "lfp" as const, search: "" };
    const post = parsedGetiPost({ category: "lfp" });

    expect(matchingGetiAlerts(post, "lfp", [everything], new Map(), NOW)).toEqual([everything]);
  });

  it("matchingGetiAlerts_sharedFilterCache_keepsTheFilterOfEachAlert", () => {
    const filters = new Map<number, GetiFilter>();
    const post = parsedGetiPost({ category: "lfp", roles: ["TANK"] });

    matchingGetiAlerts(post, "lfp", [tankAlert], filters, NOW);

    expect(filters.get(1)).toMatchObject({ roles: ["TANK"] });
  });
});
