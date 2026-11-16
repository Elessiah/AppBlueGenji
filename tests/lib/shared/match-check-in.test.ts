import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkInReminderFate, readDbInstant, readMatchCheckIn } from "@/lib/shared/match-check-in";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { canToggleLiveTournamentOption } from "@/lib/shared/tournament-state";

const pausedAt = new Date("2026-11-13T20:00:00Z");
const off = { enabled: false, pausedAt };

describe("readDbInstant", () => {
  it("readDbInstant_null_returnsNull", () => {
    expect(readDbInstant(null)).toBeNull();
  });

  it("readDbInstant_unreadableString_returnsNull", () => {
    expect(readDbInstant("pas une date")).toBeNull();
  });

  it("readDbInstant_isoString_parsed", () => {
    expect(readDbInstant("2026-11-13T19:00:00Z")).toEqual(new Date("2026-11-13T19:00:00Z"));
  });
});

describe("readMatchCheckIn", () => {
  it("readMatchCheckIn_absentColumns_enabledNoPause", () => {
    expect(readMatchCheckIn(undefined, undefined)).toEqual({ enabled: true, pausedAt: null });
  });

  it("readMatchCheckIn_nullFlag_enabled", () => {
    expect(readMatchCheckIn(null, null).enabled).toBe(true);
  });

  it("readMatchCheckIn_zeroFlagWithPause_disabledWithPause", () => {
    expect(readMatchCheckIn(0, "2026-11-13T20:00:00Z")).toEqual({ enabled: false, pausedAt });
  });
});

describe("checkInReminderFate", () => {
  it("checkInReminderFate_enabled_send", () => {
    expect(checkInReminderFate({ enabled: true, pausedAt }, new Date("2026-11-13T21:00:00Z"))).toBe("send");
  });

  it("checkInReminderFate_disabledNoPause_silence", () => {
    // Créé sans check-in : tout l'avant compte pour l'arrêt.
    expect(checkInReminderFate({ enabled: false, pausedAt: null }, new Date("2020-01-01T00:00:00Z"))).toBe("silence");
  });

  it("checkInReminderFate_dueBeforePause_hold", () => {
    expect(checkInReminderFate(off, new Date("2026-11-13T19:59:59Z"))).toBe("hold");
  });

  it("checkInReminderFate_dueExactlyAtPause_silence", () => {
    expect(checkInReminderFate(off, pausedAt)).toBe("silence");
  });
});

describe("canToggleLiveTournamentOption", () => {
  it("canToggleLiveTournamentOption_running_true", () => {
    expect(canToggleLiveTournamentOption("RUNNING")).toBe(true);
  });

  it("canToggleLiveTournamentOption_beforeStart_true", () => {
    expect(canToggleLiveTournamentOption("UPCOMING")).toBe(true);
    expect(canToggleLiveTournamentOption("REGISTRATION")).toBe(true);
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
