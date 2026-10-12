import { describe, expect, it } from "@jest/globals";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { REPORT_CATEGORIES } from "@/lib/shared/content-reports";
import { matchRoundLabel } from "@/lib/shared/discord-notifications";
import type { Locale } from "@/lib/shared/locales";
import {
  contentReportPush,
  issueReportPush,
  matchReminderPush,
  matchStartPush,
  moderationPush,
  privacyChangePush,
  pushRoundLabel,
  refereeAlertPush,
  scoreToConfirmPush,
  staffReportPush,
  staffReportSaturatedPush,
  suspensionPush,
  teamJoinRequestPush,
  tournamentStartPush,
  type MatchReminderOffsetKey,
} from "@/lib/shared/push-messages";
import type { PushContent } from "@/lib/shared/push-notifications";
import FR_BEFORE from "../../fixtures/push-messages-fr-before-lot9.json";

/**
 * Lot 9-3 : chaque rédacteur de notification push écrit dans la langue du
 * destinataire. Le français doit rester **à l'octet près** celui d'avant le
 * lot — la fixture a été produite par les rédacteurs d'avant (et, pour le
 * signalement d'un problème et l'afflux de signalements, par le texte alors
 * écrit en ligne dans `issue-reports.ts` et `content-reports.ts`).
 */

const SIDE = { tournamentId: 7, tournamentName: "Coupe BlueGenji", matchId: 31, teamName: "Les Renards", opponentName: "Team Nova" };
const SOLO = { ...SIDE, teamName: "Kiro", opponentName: "Nova", solo: true };
const START = "2026-09-10T18:00:00Z";
const ROUNDS: [string, number][] = [
  ["UPPER", 1],
  ["LOWER", 2],
  ["GRAND", 1],
  ["THIRD_PLACE", 1],
  ["UPPER", PLAYOFF_ROUND_OFFSET + 1],
];
const OFFSETS: (MatchReminderOffsetKey | null)[] = ["P7D", "P1D", "PT1H", null];
const REFEREE_LINE = "**Conflit** de score · <@123> https://site.test/tournois/7#match-31";

/** Les mêmes cas que la fixture, rédigés dans `locale`. */
function allCases(locale: Locale): Record<string, PushContent> {
  const out: Record<string, PushContent> = {};
  out["matchStart.lobby"] = matchStartPush(SIDE, "LOBBY", locale);
  out["matchStart.launched"] = matchStartPush(SIDE, "LAUNCHED", locale);
  out["matchStart.solo"] = matchStartPush(SOLO, "LOBBY", locale);
  for (const [bracket, roundNumber] of ROUNDS) {
    for (const key of OFFSETS) {
      out[`reminder.${bracket}.${roundNumber}.${key}`] = matchReminderPush(
        { ...SIDE, bracket, roundNumber, startAt: START },
        key,
        locale,
      );
    }
  }
  out["reminder.solo"] = matchReminderPush({ ...SOLO, bracket: "UPPER", roundNumber: 1, startAt: START }, "PT1H", locale);
  out["scoreToConfirm.team"] = scoreToConfirmPush(SIDE, locale);
  out["scoreToConfirm.solo"] = scoreToConfirmPush(SOLO, locale);
  out["tournamentStart"] = tournamentStartPush({ tournamentId: 7, tournamentName: "Coupe" }, locale);
  out["teamJoinRequest"] = teamJoinRequestPush({ teamId: 5, teamName: "Les Renards" }, locale);
  for (const category of REPORT_CATEGORIES) out[`contentReport.${category}`] = contentReportPush({ reportId: 12, category }, locale);
  for (const kind of ["HIDDEN", "REMOVED", "RESTORED"] as const) {
    for (const reportId of [12, null]) {
      out[`moderation.logo.${kind}.${reportId}`] = moderationPush({ kind, teamName: "Les Renards", teamId: 5, reportId }, locale);
      out[`moderation.avatar.${kind}.${reportId}`] = moderationPush({ kind, reportId }, locale);
    }
  }
  out["suspension.SUSPENDED"] = suspensionPush("SUSPENDED", locale);
  out["suspension.LIFTED"] = suspensionPush("LIFTED", locale);
  out["privacyChange.0"] = privacyChangePush([], locale);
  out["privacyChange.1"] = privacyChangePush(["A"], locale);
  out["privacyChange.2"] = privacyChangePush(["A", "B"], locale);
  out["privacyChange.3"] = privacyChangePush(["A", "B", "C"], locale);
  out["refereeAlert.url"] = refereeAlertPush(REFEREE_LINE, "score_conflict-31", locale, "score_conflict");
  out["refereeAlert.nourl"] = refereeAlertPush("_Score_ en attente", "score_report_stalled", locale, "score_report_stalled");
  out["staffReport.report"] = staffReportPush({ reportId: 12, contest: false }, locale);
  out["staffReport.contest"] = staffReportPush({ reportId: 12, contest: true }, locale);
  out["staffReport.saturated"] = staffReportSaturatedPush(locale);
  for (const [bracket, roundNumber] of ROUNDS) {
    out[`issueReport.${bracket}.${roundNumber}`] = issueReportPush(
      { tournamentId: 7, tournamentName: "Coupe", match: { id: 31, bracket, roundNumber } },
      locale,
    );
  }
  out["issueReport.none"] = issueReportPush({ tournamentId: 7, tournamentName: "Coupe", match: null }, locale);
  return out;
}

describe("notifications push — français inchangé", () => {
  it("rend chaque cas à l'identique de la version d'avant le lot 9-3", () => {
    expect(allCases("fr")).toEqual(FR_BEFORE);
  });

  it("le français est la langue par défaut de chaque rédacteur", () => {
    expect(matchStartPush(SIDE, "LOBBY")).toEqual(matchStartPush(SIDE, "LOBBY", "fr"));
    expect(suspensionPush("LIFTED")).toEqual(suspensionPush("LIFTED", "fr"));
    expect(refereeAlertPush(REFEREE_LINE, "k")).toEqual(refereeAlertPush(REFEREE_LINE, "k", "fr", "other"));
  });

  it("nomme la manche comme le journal Discord", () => {
    for (const [bracket, roundNumber] of ROUNDS) {
      expect(pushRoundLabel(bracket, roundNumber, "fr")).toBe(matchRoundLabel(bracket, roundNumber));
    }
  });
});

describe("notifications push — anglais", () => {
  const en = allCases("en");
  const fr = allCases("fr");

  it("couvre les mêmes cas, chacun rédigé autrement qu'en français", () => {
    expect(Object.keys(en)).toEqual(Object.keys(fr));
    for (const [name, content] of Object.entries(en)) {
      expect({ name, title: content.title === fr[name].title && content.body === fr[name].body }).toEqual({
        name,
        title: false,
      });
    }
  });

  it("mène aux pages anglaises, sauf le panneau du staff resté français (D4)", () => {
    for (const [name, content] of Object.entries(en)) {
      if (name.startsWith("staffReport.")) expect(content.url).toBe("/admin/signalements");
      else if (name === "refereeAlert.url") expect(content.url).toBe("https://site.test/tournois/7#match-31");
      else expect({ name, url: content.url.startsWith("/en/") }).toEqual({ name, url: true });
    }
  });

  it("garde les étiquettes du français : une notification remplace la même, quelle que soit la langue", () => {
    for (const [name, content] of Object.entries(en)) expect({ name, tag: content.tag }).toEqual({ name, tag: fr[name].tag });
  });

  it("ne nomme aucun joueur d'un tournoi individuel", () => {
    for (const content of [en["matchStart.solo"], en["reminder.solo"], en["scoreToConfirm.solo"]]) {
      expect(`${content.title} ${content.body}`).not.toMatch(/Kiro|Nova/);
    }
    expect(en["scoreToConfirm.solo"].body).toContain("Your opponent entered");
  });

  it("rédige les cas principaux", () => {
    expect(en["matchStart.lobby"]).toMatchObject({
      title: "Your match is starting",
      body: "Les Renards vs Team Nova · Coupe BlueGenji. Mark yourself ready.",
      url: "/en/tournois/7#match-31",
    });
    expect(en["reminder.LOWER.2.P1D"].title).toBe("Match in 24 hours");
    expect(en["reminder.LOWER.2.P1D"].body).toContain("Lower bracket · round 2");
    expect(en["reminder.LOWER.2.P1D"].body).toContain("(Paris time)");
    expect(en["reminder.UPPER.1.null"].title).toBe("Match scheduled");
    expect(en[`reminder.UPPER.${PLAYOFF_ROUND_OFFSET + 1}.PT1H`].body).toContain("Play-offs · round 2");
    expect(en["privacyChange.1"].body).toBe("A. The details are waiting for you on your next visit.");
    expect(en["privacyChange.2"].body).toContain("(and 1 other)");
    expect(en["privacyChange.3"].body).toContain("(and 2 others)");
    expect(en["moderation.logo.HIDDEN.12"].body).toBe("Les Renards's logo has been hidden. You can contest the decision.");
    expect(en["issueReport.GRAND.1"].body).toBe("Problem reported · Coupe, Grand final.");
  });

  it("donne l'heure de coup d'envoi en anglais, heure de Paris, sur 24 heures", () => {
    // 18:00 UTC le 10 septembre 2026 = 20:00 à Paris (heure d'été).
    expect(en["reminder.UPPER.1.PT1H"].body).toContain("Thursday, September 10 at 20:00");
  });

  it("ne reprend pas en anglais le texte Discord, resté français (D6)", () => {
    expect(en["refereeAlert.url"].body).toBe("A score conflict is waiting for a referee.");
    expect(en["refereeAlert.nourl"].body).toBe("A score has been waiting too long for confirmation: a referee needs to decide.");
    expect(refereeAlertPush(REFEREE_LINE, "k", "en").body).toBe("An alert is waiting for a referee.");
  });
});
