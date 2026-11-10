import { describe, expect, it } from "@jest/globals";
import { contestOutcomeMessage, isContestOutcome, removalBlocksHash } from "@/lib/shared/logo-quarantine";

/*
 * Décisions D18, D22, D23 (2026-11-10) : l'issue écrite d'une contestation
 * décide du blocage de l'empreinte d'un avatar supprimé.
 */

describe("removalBlocksHash", () => {
  it("removalBlocksHash_overturnedByStaff_returnsFalse", () => {
    expect(removalBlocksHash({ byStaff: true, outcome: "OVERTURNED", contested: false })).toBe(false);
  });

  it("removalBlocksHash_overturnedAutomatic_returnsFalse", () => {
    expect(removalBlocksHash({ byStaff: false, outcome: "OVERTURNED", contested: false })).toBe(false);
  });

  it("removalBlocksHash_upheldContestedAutomatic_returnsTrue", () => {
    expect(removalBlocksHash({ byStaff: false, outcome: "UPHELD", contested: true })).toBe(true);
  });

  it("removalBlocksHash_noOutcomeByStaff_returnsTrue", () => {
    expect(removalBlocksHash({ byStaff: true, outcome: null, contested: true })).toBe(true);
  });

  it("removalBlocksHash_noOutcomeAutomaticContested_returnsFalse", () => {
    expect(removalBlocksHash({ byStaff: false, outcome: null, contested: true })).toBe(false);
  });

  it("removalBlocksHash_noOutcomeAutomaticUncontested_returnsTrue", () => {
    expect(removalBlocksHash({ byStaff: false, outcome: null, contested: false })).toBe(true);
  });
});

describe("isContestOutcome", () => {
  it("isContestOutcome_knownValues_true", () => {
    expect(isContestOutcome("UPHELD")).toBe(true);
    expect(isContestOutcome("OVERTURNED")).toBe(true);
  });

  it("isContestOutcome_otherValues_false", () => {
    expect(isContestOutcome("upheld")).toBe(false);
    expect(isContestOutcome(null)).toBe(false);
    expect(isContestOutcome(1)).toBe(false);
  });
});

describe("contestOutcomeMessage", () => {
  it("contestOutcomeMessage_overturnedLifted_saysResendable", () => {
    expect(contestOutcomeMessage("OVERTURNED", false)).toBe(
      "Contestation acceptée. L'image n'est plus bloquée : elle peut être renvoyée.",
    );
  });

  it("contestOutcomeMessage_overturnedStillBlocked_saysOtherRemoval", () => {
    expect(contestOutcomeMessage("OVERTURNED", true)).toContain("une autre suppression de la modération");
  });

  it("contestOutcomeMessage_upheldBlocked_saysBlocked", () => {
    expect(contestOutcomeMessage("UPHELD", true)).toBe("Contestation rejetée : décision maintenue. L'image est bloquée.");
  });

  it("contestOutcomeMessage_hashUnknown_saysUnchanged", () => {
    expect(contestOutcomeMessage("OVERTURNED", null, true)).toContain("son blocage n'a pas pu changer");
  });

  it("contestOutcomeMessage_hiddenImage_headOnly", () => {
    expect(contestOutcomeMessage("UPHELD", null)).toBe("Contestation rejetée : décision maintenue.");
  });
});
