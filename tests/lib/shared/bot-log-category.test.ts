import { describe, expect, it } from "@jest/globals";
import { botLogBatchKey } from "@/lib/shared/bot-log-batch";
import {
  BOT_LOG_CATEGORIES,
  BOT_LOG_CATEGORY_HEADERS,
  BOT_LOG_CATEGORY_KINDS,
  botLogHeader,
  botLogKind,
} from "@/lib/shared/bot-log-category";
import { BOT_EVENT_LOG_CATEGORIES } from "@/lib/shared/referee-alerts";

describe("catégories du journal", () => {
  it("botLogKind_everyCategory_logExceptTheRefereeDigest", () => {
    const alerts = BOT_LOG_CATEGORIES.filter((category) => botLogKind(category) === "alert");
    expect(alerts).toEqual(["referee-digest"]);
    for (const category of BOT_LOG_CATEGORIES) expect(["log", "alert"]).toContain(BOT_LOG_CATEGORY_KINDS[category]);
  });

  it("botLogHeader_everyCategory_distinctNonEmptyFrenchLabel", () => {
    const headers = BOT_LOG_CATEGORIES.map(botLogHeader);
    expect(new Set(headers).size).toBe(BOT_LOG_CATEGORIES.length);
    for (const header of headers) expect(header.trim().length).toBeGreaterThan(0);
    expect(Object.keys(BOT_LOG_CATEGORY_HEADERS).sort()).toEqual([...BOT_LOG_CATEGORIES].sort());
  });

  it("botLogHeader_everyCategory_carriesNoPlayerNameNorHandle", () => {
    for (const header of BOT_LOG_CATEGORIES.map(botLogHeader)) expect(header).not.toMatch(/[#@<>]|\d/u);
  });

  it("botLogBatchKey_category_lastSegment", () => {
    expect(botLogBatchKey("log", 12, "casts")).toBe("log:tournament:12:casts");
    expect(botLogBatchKey("log", null, "admin")).toBe("log:global:admin");
    expect(botLogBatchKey("log", 12, "casts")).not.toBe(botLogBatchKey("log", 12, "maps"));
  });

  it("BOT_EVENT_LOG_CATEGORIES_everyEvent_knownCategory", () => {
    for (const category of Object.values(BOT_EVENT_LOG_CATEGORIES)) expect(BOT_LOG_CATEGORIES).toContain(category);
  });

  it("BOT_EVENT_LOG_CATEGORIES_matchResult_notWithTheTournamentLifecycle", () => {
    expect(BOT_EVENT_LOG_CATEGORIES.match_finished).toBe("results");
    expect(BOT_EVENT_LOG_CATEGORIES.tournament_finished).toBe("tournament");
  });
});
