import { describe, expect, it } from "@jest/globals";
import {
  MAX_ENDURANCE_PENALTY_POINTS,
  MAX_ENDURANCE_PENALTY_REASON,
  checkEndurancePenalty,
  endurancePenaltyMessage,
  normalizePenaltyReason,
} from "@/lib/shared/endurance-penalty";

const REASON = "Retard au coup d'envoi";

describe("normalizePenaltyReason", () => {
  it("rogne les bords et replie les suites d'espaces", () => {
    expect(normalizePenaltyReason("  Retard   au \n coup d'envoi  ")).toBe(
      "Retard au coup d'envoi",
    );
  });

  it("laisse un motif déjà propre inchangé", () => {
    expect(normalizePenaltyReason(REASON)).toBe(REASON);
  });

  it("rend la chaîne vide d'un motif fait d'espaces", () => {
    expect(normalizePenaltyReason("   \t \n ")).toBe("");
  });
});

describe("checkEndurancePenalty — points", () => {
  it("accepte une sanction ordinaire", () => {
    expect(checkEndurancePenalty(3, REASON)).toBeNull();
  });

  it("accepte le plancher (1 point) et le plafond", () => {
    expect(checkEndurancePenalty(1, REASON)).toBeNull();
    expect(checkEndurancePenalty(MAX_ENDURANCE_PENALTY_POINTS, REASON)).toBeNull();
  });

  it("refuse zéro : une pénalité qui ne retire rien n'est pas une pénalité", () => {
    expect(checkEndurancePenalty(0, REASON)).toBe("POINTS_NOT_POSITIVE");
  });

  it("refuse une pénalité négative — il n'y a pas de bonus d'endurance", () => {
    expect(checkEndurancePenalty(-2, REASON)).toBe("POINTS_NOT_POSITIVE");
  });

  it("refuse une valeur décimale : le capital se compte en points entiers", () => {
    expect(checkEndurancePenalty(1.5, REASON)).toBe("POINTS_NOT_POSITIVE");
  });

  it("refuse NaN et l'infini, qui arrivent d'un champ mal rempli", () => {
    expect(checkEndurancePenalty(Number.NaN, REASON)).toBe("POINTS_NOT_POSITIVE");
    expect(checkEndurancePenalty(Number.POSITIVE_INFINITY, REASON)).toBe("POINTS_NOT_POSITIVE");
  });

  it("refuse au-delà du plafond", () => {
    expect(checkEndurancePenalty(MAX_ENDURANCE_PENALTY_POINTS + 1, REASON)).toBe(
      "POINTS_TOO_HIGH",
    );
  });

  it("tranche les points avant le motif : le champ le plus haut se corrige d'abord", () => {
    expect(checkEndurancePenalty(0, "")).toBe("POINTS_NOT_POSITIVE");
  });
});

describe("checkEndurancePenalty — motif", () => {
  it("exige un motif", () => {
    expect(checkEndurancePenalty(3, "")).toBe("REASON_REQUIRED");
  });

  it("refuse un motif fait d'espaces, qui n'explique rien", () => {
    expect(checkEndurancePenalty(3, "   ")).toBe("REASON_REQUIRED");
  });

  it("accepte un motif exactement à la longueur maximale", () => {
    expect(checkEndurancePenalty(3, "x".repeat(MAX_ENDURANCE_PENALTY_REASON))).toBeNull();
  });

  it("refuse un motif trop long", () => {
    expect(checkEndurancePenalty(3, "x".repeat(MAX_ENDURANCE_PENALTY_REASON + 1))).toBe(
      "REASON_TOO_LONG",
    );
  });

  it("mesure le motif **après** normalisation", () => {
    // Un motif de deux mots noyé dans des espaces ne doit pas se faire refuser
    // pour sa taille : c'est la forme stockée qui compte.
    const padded = `   ${"x".repeat(MAX_ENDURANCE_PENALTY_REASON)}   `;
    expect(checkEndurancePenalty(3, padded)).toBeNull();
  });
});

describe("endurancePenaltyMessage", () => {
  it("rend une phrase française pour chaque refus", () => {
    for (const violation of [
      "POINTS_NOT_POSITIVE",
      "POINTS_TOO_HIGH",
      "REASON_REQUIRED",
      "REASON_TOO_LONG",
    ] as const) {
      const message = endurancePenaltyMessage(violation);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toBe(violation);
    }
  });

  it("chiffre les bornes plutôt que de les évoquer", () => {
    expect(endurancePenaltyMessage("POINTS_TOO_HIGH")).toContain(
      String(MAX_ENDURANCE_PENALTY_POINTS),
    );
    expect(endurancePenaltyMessage("REASON_TOO_LONG")).toContain(
      String(MAX_ENDURANCE_PENALTY_REASON),
    );
  });
});
