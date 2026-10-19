import { describe, expect, it } from "@jest/globals";
import { autoValidateTimeText, isScoreDisputed, reportPresent } from "@/lib/shared/score-dispute";
import { scoreAutoValidatedPush } from "@/lib/shared/push-messages";
import frPush from "@/messages/fr/pushMessages.json";
import enPush from "@/messages/en/pushMessages.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frErrors from "@/messages/fr/tournamentErrors.json";
import enErrors from "@/messages/en/tournamentErrors.json";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";

/** Litige de score et validation d'office (`docs/features/SCORE_DISPUTE_LOCK.md`). */
describe("isScoreDisputed", () => {
  it("deux propositions sur un match ouvert font un litige", () => {
    expect(isScoreDisputed({ status: "AWAITING_CONFIRMATION", team1Reported: true, team2Reported: true })).toBe(true);
  });

  it("une seule proposition, ou aucune, n'en fait pas", () => {
    expect(isScoreDisputed({ status: "AWAITING_CONFIRMATION", team1Reported: true, team2Reported: false })).toBe(false);
    expect(isScoreDisputed({ status: "AWAITING_CONFIRMATION", team1Reported: false, team2Reported: true })).toBe(false);
    expect(isScoreDisputed({ status: "READY", team1Reported: false, team2Reported: false })).toBe(false);
  });

  it("un match tranché n'est plus en litige", () => {
    expect(isScoreDisputed({ status: "COMPLETED", team1Reported: true, team2Reported: true })).toBe(false);
  });

  it("une colonne vide ne compte pas comme une proposition", () => {
    expect(reportPresent(null)).toBe(false);
    expect(reportPresent(undefined)).toBe(false);
    expect(reportPresent(0)).toBe(true);
  });
});

describe("autoValidateTimeText", () => {
  // Instants absolus : l'heure dite est celle de Paris, quel que soit le fuseau
  // du processus (Node sous Windows ignore les fuseaux IANA de `TZ`).
  it("donne l'heure de Paris, en 24 h, dans les deux langues", () => {
    // 2026-10-20 18:05 UTC = 20:05 à Paris (heure d'été).
    expect(autoValidateTimeText("2026-10-20T18:05:00.000Z", "fr")).toBe("20:05");
    expect(autoValidateTimeText("2026-10-20T18:05:00.000Z", "en")).toBe("20:05");
    // 2026-12-01 22:30 UTC = 23:30 à Paris (heure d'hiver).
    expect(autoValidateTimeText("2026-12-01T22:30:00.000Z", "fr")).toBe("23:30");
  });

  it("se tait sans échéance lisible", () => {
    expect(autoValidateTimeText(null, "fr")).toBeNull();
    expect(autoValidateTimeText(undefined, "en")).toBeNull();
    expect(autoValidateTimeText("pas une date", "fr")).toBeNull();
  });
});

describe("textes FR + EN", () => {
  it("la notification de validation d'office existe dans les deux langues et ne nomme personne", () => {
    const input = { tournamentId: 4, tournamentName: "Coupe", matchId: 9 };
    const fr = scoreAutoValidatedPush(input, "fr");
    const en = scoreAutoValidatedPush(input, "en");
    expect(fr.title).toBe(frPush.scoreAutoValidated.title);
    expect(en.title).toBe(enPush.scoreAutoValidated.title);
    expect(fr.body).toContain("Coupe");
    expect(en.body).toContain("Coupe");
    expect(fr.url).not.toMatch(/^\/en/);
    expect(en.url).toMatch(/^\/en\//);
    // Même étiquette que « score à confirmer » : elle le remplace sur l'appareil.
    expect(fr.tag).toBe(en.tag);
  });

  it("le verrou, l'échéance et le refus sont traduits", () => {
    expect(frDialogs.score.player.locked).toMatch(/arbitre ou un administrateur/);
    expect(enDialogs.score.player.locked).toMatch(/referee or a tournament administrator/);
    expect(frDialogs.score.player.autoValidateAt).toContain("{deadline}");
    expect(enDialogs.score.player.autoValidateAt).toContain("{deadline}");
    expect(frErrors.codes.SCORE_LOCKED_DISPUTE).toBeTruthy();
    expect(enErrors.codes.SCORE_LOCKED_DISPUTE).toBeTruthy();
    expect(frActions.cardActions.reportPendingDeadline).toContain("{deadline}");
    expect(enActions.cardActions.reportPendingDeadline).toContain("{deadline}");
    // Plus d'invitation à « corriger » une proposition en litige.
    expect(frDialogs.score.player.conflictScores).not.toMatch(/corriger/);
    expect(enDialogs.score.player.conflictScores).not.toMatch(/correct/);
  });
});
