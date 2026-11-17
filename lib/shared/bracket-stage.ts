import type { BracketType } from "./types";

/** Nom de stade d'un round, à partir de la fin du tableau (0 = round le plus précoce). */
export type StageKey =
  | "grandFinal"
  | "thirdPlace"
  | "lowerFinal"
  | "final"
  | "semis"
  | "quarters"
  | "roundOf16"
  | "early";

/** Stade d'un tour, par sa distance à la finale (lot 8a-2 : une clé, traduite à l'écran). */
export function stageKey(globalIdx: number, totalRounds: number, bracketType: BracketType): StageKey {
  if (bracketType === "GRAND") return "grandFinal";
  if (bracketType === "THIRD_PLACE") return "thirdPlace";
  const fromEnd = totalRounds - 1 - globalIdx;
  if (fromEnd === 0) return bracketType === "LOWER" ? "lowerFinal" : "final";
  if (fromEnd === 1) return "semis";
  if (fromEnd === 2) return "quarters";
  if (fromEnd === 3) return "roundOf16";
  return "early";
}
