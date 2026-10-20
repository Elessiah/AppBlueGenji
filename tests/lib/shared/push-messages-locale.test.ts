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
import EN_PUSH from "@/messages/en/pushMessages.json";

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
const OFFSETS: (MatchReminderOffsetKey | null)[] = ["P1D", null];
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
  out["reminder.solo"] = matchReminderPush({ ...SOLO, bracket: "UPPER", roundNumber: 1, startAt: START }, "P1D", locale);
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
    // Seule différence voulue (revue sécurité) : le lien d'une alerte d'arbitrage
    // n'est plus la première URL de la ligne Discord — le texte, lui, est inchangé.
    // Les rappels « 1 h avant » (`PT1H`) et « une semaine » (`P7D`) ont depuis
    // été retirés : leurs cas sortent de la comparaison. Le rappel restant ne
    // promet plus un délai exact (le balayage peut l'envoyer tard dans sa
    // fenêtre) : « Match dans moins de 24 heures », cas solo compris.
    const kept = Object.fromEntries(
      Object.entries(FR_BEFORE)
        .filter(([name]) => !name.endsWith(".PT1H") && !name.endsWith(".P7D"))
        // Le tableau des perdants porte le nom que lui donne le site
        // (« Tableau perdants »), plus l'anglicisme « Loser bracket ».
        .map(([name, content]): [string, PushContent] => {
          const renamed = { ...content, body: content.body.replace("Loser bracket", "Tableau perdants") };
          // Un rappel remplace l'annonce en sonnant (`renotify`, revue performance #443) : texte inchangé.
          return [
            name,
            name.endsWith(".P1D") ? { ...renamed, title: "Match dans moins de 24 heures", renotify: true } : renamed,
          ];
        }),
    );
    const before = {
      ...kept,
      "refereeAlert.url": { ...FR_BEFORE["refereeAlert.url"], url: "/tournois" },
      "reminder.solo": { ...FR_BEFORE["reminder.solo"], title: "Match dans moins de 24 heures", renotify: true },
    };
    expect(allCases("fr")).toEqual(before);
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
    expect(en["reminder.LOWER.2.P1D"].title).toBe("Match in less than 24 hours");
    expect(en["reminder.LOWER.2.P1D"].body).toContain("Lower bracket · round 2");
    expect(en["reminder.LOWER.2.P1D"].body).toContain("(Paris time)");
    expect(en["reminder.UPPER.1.null"].title).toBe("Match scheduled");
    expect(en[`reminder.UPPER.${PLAYOFF_ROUND_OFFSET + 1}.P1D`].body).toContain("Playoffs · round 2");
    expect(en["privacyChange.1"].body).toBe("A. The details are waiting for you on your next visit.");
    expect(en["privacyChange.2"].body).toContain("(and 1 other)");
    expect(en["privacyChange.3"].body).toContain("(and 2 others)");
    expect(en["moderation.logo.HIDDEN.12"].body).toBe("The logo of Les Renards has been hidden. You can appeal the decision.");
    expect(en["issueReport.GRAND.1"].body).toBe("Problem reported · Coupe, Grand final.");
  });

  it("parle le vocabulaire de l'écran anglais : appeal, jamais contest ; pas de possessif sur un nom d'équipe", () => {
    const leaves = (node: unknown): string[] =>
      typeof node === "string" ? [node] : Object.values(node as Record<string, unknown>).flatMap(leaves);
    const values = leaves(EN_PUSH).join(" | ");
    expect(values).not.toMatch(/contest/i);
    expect(values).not.toContain("{team}'s");
    expect(en["moderation.logo.HIDDEN.12"].body).toContain("appeal");
  });

  it("donne l'heure de coup d'envoi en anglais, heure de Paris, sur 24 heures", () => {
    // 18:00 UTC le 10 septembre 2026 = 20:00 à Paris (heure d'été).
    expect(en["reminder.UPPER.1.P1D"].body).toContain("Thursday, September 10 at 20:00");
  });

  it("ne reprend pas en anglais le texte Discord, resté français (D6)", () => {
    expect(en["refereeAlert.url"].body).toBe("Conflicting scores are waiting for a referee.");
    expect(en["refereeAlert.nourl"].body).toBe("A disputed score has been waiting too long for a referee: score entry stays locked for both opponents, a referee needs to decide.");
    expect(refereeAlertPush(REFEREE_LINE, "k", "en").body).toBe("An alert is waiting for a referee.");
  });

  it("sans manche connue : mène à la liste des tournois, jamais au chemin d'une URL lue dans la ligne", () => {
    expect(en["refereeAlert.url"].url).toBe("/en/tournois");
    expect(en["refereeAlert.nourl"].url).toBe("/en/tournois");
    expect(fr["refereeAlert.url"].url).toBe("/tournois");
    // Une URL du site glissée dans un nom de tournoi ou d'équipe ne choisit le lien dans aucune langue.
    const forged = "Conflit · Coupe https://site.test/connexion?redirect=//evil.test vs Nova https://site.test/tournois/7";
    expect(refereeAlertPush(forged, "k", "en").url).toBe("/en/tournois");
    expect(refereeAlertPush(forged, "k", "fr").url).toBe("/tournois");
    expect(refereeAlertPush("Conflit · https://site.test/api/profile/locale", "k").url).toBe("/tournois");
  });

  it("avec la manche : nomme le tournoi et la manche en anglais, et mène à la manche dans la langue du destinataire", () => {
    const match = { tournamentId: 7, tournamentName: "Spring Cup", matchId: 31, bracket: "LOWER", roundNumber: 2 };
    const conflict = refereeAlertPush(REFEREE_LINE, "score_conflict-31", "en", "score_conflict", match);
    expect(conflict.body).toBe("Conflicting scores · Spring Cup, Lower bracket · round 2: a referee is needed.");
    expect(conflict.url).toBe("/en/tournois/7#match-31");
    expect(refereeAlertPush(REFEREE_LINE, "k", "en", "score_report_stalled", match).body).toBe(
      "Dispute without a referee for too long · Spring Cup, Lower bracket · round 2: entry locked, a referee needs to decide.",
    );
    expect(refereeAlertPush(REFEREE_LINE, "k", "en", "other", match).body).toBe("Alert · Spring Cup, Lower bracket · round 2: a referee is needed.");
    // Le français garde la ligne Discord, et mène à la manche.
    const fr31 = refereeAlertPush(REFEREE_LINE, "score_conflict-31", "fr", "score_conflict", match);
    expect(fr31.body).toBe(refereeAlertPush(REFEREE_LINE, "score_conflict-31", "fr", "score_conflict").body);
    expect(fr31.url).toBe("/tournois/7#match-31");
  });

  it("nomme une ronde suisse « Ronde N » / \"Round N\", comme la vue suisse du site", () => {
    expect(pushRoundLabel("UPPER", 4, "fr", true)).toBe("Ronde 4");
    expect(pushRoundLabel("UPPER", 4, "fr", true)).toBe(matchRoundLabel("UPPER", 4, true));
    expect(pushRoundLabel("UPPER", 4, "en", true)).toBe("Round 4");
    expect(pushRoundLabel("UPPER", 4, "fr")).toBe("Manche 4");
  });

  it("écrit « Playoffs » comme le reste du site anglais", () => {
    expect(pushRoundLabel("UPPER", PLAYOFF_ROUND_OFFSET, "en")).toBe("Playoffs · round 1");
  });
});
