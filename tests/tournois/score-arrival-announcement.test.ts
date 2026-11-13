import { describe, expect, it } from "@jest/globals";
import { arrivalAnnouncement, conflictText, diffZoneTitle, scoreText } from "@/app/(secured)/tournois/[id]/_components/PlayerScoreDialog";
import { tournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import type { MatchScoreReport } from "@/lib/shared/types";

const FR = tournamentDialogsText("fr", frDialogs);
const EN = tournamentDialogsText("en", enDialogs);

describe("modale de score — annonce de la déclaration adverse arrivée", () => {
  it("score identique : la phrase du bandeau, dans les deux langues", () => {
    const state = { sameScoreArrived: true, offerConfirmTheirs: false, differenceCount: 0 };
    expect(arrivalAnnouncement(FR, state, "Les Loups")).toBe(frDialogs.score.player.sameScoreArrived);
    expect(arrivalAnnouncement(EN, state, "Wolves")).toBe(enDialogs.score.player.sameScoreArrived);
  });

  it("version différente avec écarts : annonce nommant l'adversaire", () => {
    const state = { sameScoreArrived: false, offerConfirmTheirs: true, differenceCount: 2 };
    expect(arrivalAnnouncement(FR, state, "Les Loups")).toContain("Les Loups");
    expect(arrivalAnnouncement(EN, state, "Wolves")).toContain("Wolves");
  });

  it("aucune arrivée, ou aucun écart montré : région vide", () => {
    expect(arrivalAnnouncement(FR, { sameScoreArrived: false, offerConfirmTheirs: false, differenceCount: 0 }, "X")).toBe("");
    expect(arrivalAnnouncement(FR, { sameScoreArrived: false, offerConfirmTheirs: true, differenceCount: 0 }, "X")).toBe("");
    expect(arrivalAnnouncement(FR, { sameScoreArrived: false, offerConfirmTheirs: false, differenceCount: 3 }, "X")).toBe("");
  });

  it("titre de la zone : les écarts, ou à défaut la déclaration adverse avec son score", () => {
    expect(diffZoneTitle(FR, true, "Les Loups", null)).toBe("Ce qui diffère de la déclaration de Les Loups");
    expect(diffZoneTitle(EN, true, "Wolves", null)).toBe("What differs from Wolves's report");
    const theirs: MatchScoreReport = { team1Score: 2, team2Score: 1, reportedAt: "2026-09-28T20:00:00.000Z", maps: [] };
    expect(diffZoneTitle(FR, false, "Les Loups", theirs)).toBe("Déclaration de Les Loups : 2 – 1");
    expect(diffZoneTitle(EN, false, "Wolves", theirs)).toBe("Wolves's report: 2 – 1");
    expect(diffZoneTitle(FR, false, "Les Loups", null)).toBe("Déclaration de Les Loups : ");
  });
});

describe("modale de score — match sur une carte (format Duel / Arcade)", () => {
  const BO1 = { type: "BO" as const, value: 1 };
  const report = (team1Points: number, team2Points: number): MatchScoreReport => ({
    team1Score: 1,
    team2Score: 0,
    reportedAt: "2026-09-28T20:00:00.000Z",
    maps: [{ mapNumber: 1, replayCode: "ABC123", team1Score: team1Points, team2Score: team2Points }],
  });

  it("scoreText_bo1SingleMap_returnsMapPoints", () => {
    expect(scoreText(report(5, 3), BO1)).toBe("5 – 3");
  });

  it("scoreText_bo3_returnsMatchScore", () => {
    expect(scoreText(report(5, 3), { type: "BO", value: 3 })).toBe("1 – 0");
  });

  it("conflictText_bo1DifferentPoints_citesBothPoints", () => {
    expect(conflictText(EN, report(5, 3), report(5, 4), "Wolves", BO1)).toBe(
      "The scores contradict each other — you: 5 – 3, Wolves: 5 – 4. The referee has been alerted.",
    );
  });

  it("conflictText_bo1SamePoints_saysTheMapDetailsDiffer", () => {
    expect(conflictText(FR, report(5, 3), report(5, 3), "Les Loups", BO1)).toContain("Même score (5 – 3)");
  });

  it("diffZoneTitle_bo1Theirs_citesPoints", () => {
    expect(diffZoneTitle(FR, false, "Les Loups", report(5, 4), BO1)).toBe("Déclaration de Les Loups : 5 – 4");
  });
});
