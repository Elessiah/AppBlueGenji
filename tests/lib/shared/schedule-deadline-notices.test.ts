import { describe, expect, it } from "@jest/globals";
import { scheduleDeadlinePush } from "@/lib/shared/push-messages";
import { formatScheduleDeadlineDm, type DeadlineNotice } from "@/lib/shared/schedule-deadline-notices";

/**
 * Avis de date butoir (`docs/features/SCHEDULE_DEADLINE.md` § Avis aux équipes) :
 * noms d'équipe seulement, aucun pseudo en individuel, heure de Paris, lien du match.
 */

const SITE = "https://bluegenji.test";

function notice(overrides: Partial<DeadlineNotice> = {}): DeadlineNotice {
  return {
    key: "SET",
    matchId: 40,
    tournamentId: 12,
    tournamentName: "Coupe",
    teamName: "Renards",
    opponentName: "Nova",
    solo: false,
    deadlineAt: "2026-11-17T20:00:00.000Z",
    ...overrides,
  };
}

describe("formatScheduleDeadlineDm", () => {
  it("formatScheduleDeadlineDm_setFr_namesTeamsDeadlineAndLink", () => {
    const text = formatScheduleDeadlineDm(notice(), SITE, "fr");

    expect(text).toContain("Date butoir de planification : Renards contre Nova (Coupe)");
    expect(text).toContain("21:00");
    expect(text).toContain("heure de Paris");
    expect(text).toContain(`${SITE}/tournois/12#match-40`);
  });

  it("formatScheduleDeadlineDm_reminderEn_saysReminderWithEnglishLink", () => {
    const text = formatScheduleDeadlineDm(notice({ key: "DL24" }), SITE, "en");

    expect(text).toContain("Reminder: Renards vs Nova (Coupe) still has no time");
    expect(text).toContain(`${SITE}/en/tournois/12#match-40`);
  });

  it("formatScheduleDeadlineDm_forfeitFr_saysDoubleForfeit", () => {
    expect(formatScheduleDeadlineDm(notice({ key: "FORFEIT" }), SITE, "fr")).toContain("Le match est clos en double forfait.");
  });

  it("formatScheduleDeadlineDm_soloFr_namesNoPlayer", () => {
    const text = formatScheduleDeadlineDm(notice({ solo: true, teamName: "Pseudo1", opponentName: "Pseudo2" }), SITE, "fr");

    expect(text).toContain("Ton match (Coupe)");
    expect(text).not.toContain("Pseudo1");
    expect(text).not.toContain("Pseudo2");
  });

  it("formatScheduleDeadlineDm_untrustedTeamName_mentionNeutralised", () => {
    const text = formatScheduleDeadlineDm(notice({ teamName: "@everyone" }), SITE, "fr");

    expect(text).not.toContain("@everyone");
  });
});

describe("scheduleDeadlinePush", () => {
  it("scheduleDeadlinePush_setFr_titleBodyUrlAndTag", () => {
    const push = scheduleDeadlinePush(notice(), "fr");

    expect(push.title).toBe("Date butoir de planification");
    expect(push.body).toMatch(/^Renards contre Nova \(Coupe\) : à programmer avant le .*21:00.*, sinon double forfait\.$/);
    expect(push.url).toBe("/tournois/12#match-40");
    expect(push.tag).toBe("rencontre-40-deadline");
  });

  it("scheduleDeadlinePush_reminderEn_reminderTitleAndEnglishUrl", () => {
    const push = scheduleDeadlinePush(notice({ key: "DL3" }), "en");

    expect(push.title).toBe("Match still to be scheduled");
    expect(push.url).toBe("/en/tournois/12#match-40");
  });

  it("scheduleDeadlinePush_forfeitFr_forfeitTitle", () => {
    expect(scheduleDeadlinePush(notice({ key: "FORFEIT" }), "fr").title).toBe("Double forfait");
  });

  it("scheduleDeadlinePush_solo_namesNoPlayer", () => {
    const push = scheduleDeadlinePush(notice({ solo: true, teamName: "Pseudo1", opponentName: "Pseudo2" }), "fr");

    expect(push.body).toMatch(/^Ton match \(Coupe\)/);
    expect(push.body).not.toContain("Pseudo1");
  });
});
