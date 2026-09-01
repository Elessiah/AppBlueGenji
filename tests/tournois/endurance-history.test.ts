import { describe, expect, it } from "@jest/globals";
import {
  enduranceCellLabel,
  enduranceCellTitle,
  enduranceCellTone,
  enduranceHistoryColumns,
} from "@/app/(secured)/tournois/[id]/_lib/endurance-history";
import type { EnduranceRoundCell } from "@/lib/shared/bg-survie";

const points = (round: number, value: number): EnduranceRoundCell => ({
  round,
  kind: "POINTS",
  points: value,
});
const forfeit = (round: number): EnduranceRoundCell => ({ round, kind: "FORFEIT", points: null });
const out = (round: number): EnduranceRoundCell => ({ round, kind: "OUT", points: null });

describe("enduranceCellTone", () => {
  it("distingue un capital vidé d'un forfait — même 0 à l'écran, deux récits", () => {
    expect(enduranceCellTone(points(3, 0))).toBe("ZERO");
    expect(enduranceCellTone(forfeit(3))).toBe("FORFEIT");
  });

  it("range un capital ordinaire et une manche non disputée", () => {
    expect(enduranceCellTone(points(1, 9))).toBe("POINTS");
    expect(enduranceCellTone(out(4))).toBe("OUT");
  });
});

describe("enduranceCellLabel", () => {
  it("écrit « FF » pour un forfait, jamais un capital", () => {
    expect(enduranceCellLabel(forfeit(2))).toBe("FF");
  });

  it("affiche le capital, zéro compris", () => {
    expect(enduranceCellLabel(points(2, 7))).toBe("7");
    expect(enduranceCellLabel(points(2, 0))).toBe("0");
  });

  it("laisse un tiret là où l'équipe n'était plus en lice", () => {
    expect(enduranceCellLabel(out(5))).toBe("—");
  });
});

describe("enduranceCellTitle", () => {
  it("dit la manche et ce qui s'y est passé", () => {
    expect(enduranceCellTitle("Alpha", points(3, 5))).toBe(
      "Alpha · manche 3 : 5 points d'endurance",
    );
    expect(enduranceCellTitle("Alpha", points(3, 1))).toBe("Alpha · manche 3 : 1 point d'endurance");
  });

  it("nomme le forfait pour ce qu'il est : un retrait du reste du tournoi", () => {
    expect(enduranceCellTitle("Bravo", forfeit(4))).toBe(
      "Bravo · manche 4 : forfait sur le reste du tournoi",
    );
  });

  it("distingue une équipe déjà éliminée", () => {
    expect(enduranceCellTitle("Charlie", out(6))).toBe("Charlie · manche 6 : déjà éliminée");
  });
});

describe("enduranceHistoryColumns", () => {
  it("pose une colonne fixe par manche, derrière le nom de l'équipe", () => {
    expect(enduranceHistoryColumns(3)).toBe("minmax(140px, 1fr) repeat(3, 40px)");
  });

  it("reste un gabarit valide sans aucune manche", () => {
    expect(enduranceHistoryColumns(0)).toBe("minmax(140px, 1fr) repeat(0, 40px)");
    expect(enduranceHistoryColumns(-2)).toBe("minmax(140px, 1fr) repeat(0, 40px)");
  });
});
