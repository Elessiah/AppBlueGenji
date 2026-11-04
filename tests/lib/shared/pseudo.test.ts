import { describe, expect, it } from "@jest/globals";
import { PSEUDO_MAX_LENGTH, pseudoLength, reactivationPseudoCandidate } from "@/lib/shared/pseudo";
import { readDatabaseSource } from "../../helpers/read-source";

describe("pseudo — bornes de la colonne", () => {
  it("suit la largeur de `bg_users.pseudo`", () => {
    const schema = readDatabaseSource();
    expect(schema).toContain(`pseudo VARCHAR(${PSEUDO_MAX_LENGTH}) NOT NULL UNIQUE`);
  });

  it("compte en caractères, comme MySQL, et non en unités UTF-16", () => {
    expect(pseudoLength("Nova")).toBe(4);
    expect("🎮").toHaveLength(2);
    expect(pseudoLength("🎮")).toBe(1);
    expect(pseudoLength("🎮".repeat(PSEUDO_MAX_LENGTH))).toBe(PSEUDO_MAX_LENGTH);
  });
});

// Décision R3 du 2026-11-04 : pseudo pris entre-temps → « OG » à la réactivation.
describe("reactivationPseudoCandidate", () => {
  it("reactivationPseudoCandidate_firstAttempt_appendsOG", () => {
    expect(reactivationPseudoCandidate("Pseudo", 0)).toBe("PseudoOG");
  });

  it("reactivationPseudoCandidate_laterAttempt_appendsCounter", () => {
    expect(reactivationPseudoCandidate("Pseudo", 1)).toBe("PseudoOG2");
    expect(reactivationPseudoCandidate("Pseudo", 9)).toBe("PseudoOG10");
  });

  it("reactivationPseudoCandidate_longPseudo_truncatedTo40CodePoints", () => {
    const long = `🎮${"a".repeat(PSEUDO_MAX_LENGTH - 1)}`;

    const candidate = reactivationPseudoCandidate(long, 0);

    expect(pseudoLength(candidate)).toBe(PSEUDO_MAX_LENGTH);
    expect(candidate.startsWith("🎮")).toBe(true);
    expect(candidate.endsWith("OG")).toBe(true);
  });
});
