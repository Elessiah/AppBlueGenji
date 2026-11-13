import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canToggleMatchCheckIn, checkInSendable, readMatchCheckIn } from "@/lib/shared/match-check-in";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { canToggleLiveTournamentOption } from "@/lib/shared/tournament-state";

const due = new Date("2026-11-13T20:00:00Z");

describe("readMatchCheckIn", () => {
  it("readMatchCheckIn_absentColumns_enabledWithoutResume", () => {
    expect(readMatchCheckIn(undefined, undefined)).toEqual({ enabled: true, resumedAt: null });
  });

  it("readMatchCheckIn_nullFlag_enabled", () => {
    expect(readMatchCheckIn(null, null).enabled).toBe(true);
  });

  it("readMatchCheckIn_zeroFlag_disabled", () => {
    expect(readMatchCheckIn(0, null).enabled).toBe(false);
  });

  it("readMatchCheckIn_stringDate_parsed", () => {
    expect(readMatchCheckIn(1, "2026-11-13T19:00:00Z").resumedAt).toEqual(new Date("2026-11-13T19:00:00Z"));
  });

  it("readMatchCheckIn_unreadableDate_nullResume", () => {
    expect(readMatchCheckIn(1, "pas une date").resumedAt).toBeNull();
  });
});

describe("checkInSendable", () => {
  it("checkInSendable_disabled_false", () => {
    expect(checkInSendable({ enabled: false, resumedAt: null }, due)).toBe(false);
  });

  it("checkInSendable_enabledNeverResumed_true", () => {
    expect(checkInSendable({ enabled: true, resumedAt: null }, due)).toBe(true);
  });

  it("checkInSendable_resumedAfterDue_false", () => {
    expect(checkInSendable({ enabled: true, resumedAt: new Date("2026-11-13T20:00:01Z") }, due)).toBe(false);
  });

  it("checkInSendable_resumedExactlyAtDue_true", () => {
    expect(checkInSendable({ enabled: true, resumedAt: new Date("2026-11-13T20:00:00Z") }, due)).toBe(true);
  });
});

describe("canToggleMatchCheckIn", () => {
  it("canToggleMatchCheckIn_running_true", () => {
    expect(canToggleMatchCheckIn("RUNNING")).toBe(true);
  });

  it("canToggleMatchCheckIn_finished_false", () => {
    expect(canToggleMatchCheckIn("FINISHED")).toBe(false);
  });
});

describe("canToggleLiveTournamentOption", () => {
  it("canToggleLiveTournamentOption_running_true", () => {
    expect(canToggleLiveTournamentOption("RUNNING")).toBe(true);
  });

  it("canToggleLiveTournamentOption_finished_false", () => {
    expect(canToggleLiveTournamentOption("FINISHED")).toBe(false);
  });
});

describe("textes légaux — tournoi sans check-in", () => {
  const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("register_matchDms_tenHourReminderExceptionFrAndEn", () => {
    const fr = JSON.stringify(PROCESSING_ACTIVITIES.find((a) => a.ref === "T04"));
    const en = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T04"));
    expect(fr).toContain("dans un tournoi sans check-in, option de chaque tournoi, seul le rappel 24 h part");
    expect(fr).toContain("ni dans un tournoi sans check-in), 15 minutes avant");
    expect(en).toContain("in a tournament without check-in, an option of each tournament, only the 24 h reminder is sent");
    expect(en).toContain("nor in a tournament without check-in), 15 minutes before");
  });

  it("rgpd_matchDms_tenHourReminderExceptionFrAndEn", () => {
    expect(source("app/rgpd/page.tsx")).toContain("rappels (24 h et 10 h avant ; 24 h seulement dans un tournoi sans check-in)");
    expect(source("app/rgpd/RgpdEn.tsx")).toContain("reminders (24 h and 10 h before; 24 h only in a tournament without check-in)");
  });
});
