import { describe, expect, it } from "@jest/globals";
import { arrivalAnnouncement, diffZoneTitle } from "@/app/(secured)/tournois/[id]/_components/PlayerScoreDialog";
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
