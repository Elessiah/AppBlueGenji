/**
 * Libellés d'un stade de tableau (`stageKey`), rédigés **une seule fois** pour
 * l'arbre de la fiche (`BracketTree`) et pour le nom du tour d'un match
 * (`shareRoundText` : page du match, aperçus partagés) — deux rédactions à
 * part avaient déjà divergé.
 */
import type { StageKey } from "./bracket-stage";
import type { TournamentPageText } from "./tournament-page-text-core";

/**
 * Stades à plusieurs matchs, où le nom seul est ambigu : un match s'y nomme
 * toujours avec son numéro (« Quart de finale 2 »), sur l'arbre comme dans un
 * aperçu partagé.
 */
export const AMBIGUOUS_MATCH_STAGES = ["semis", "quarters", "roundOf16"] as const satisfies readonly StageKey[];

/** Stade à plusieurs matchs ({@link AMBIGUOUS_MATCH_STAGES}). */
export type AmbiguousMatchStage = (typeof AMBIGUOUS_MATCH_STAGES)[number];

/** `stage` est-il un stade à plusieurs matchs ({@link AMBIGUOUS_MATCH_STAGES}) ? */
export function isAmbiguousMatchStage(stage: StageKey): stage is AmbiguousMatchStage {
  return (AMBIGUOUS_MATCH_STAGES as readonly StageKey[]).includes(stage);
}

/**
 * Stades dont un match se nomme avec son numéro (`bracket.matchLabel`) : les
 * stades ambigus, plus les finales que l'arbre numérote aussi (« Finale 1 ») —
 * un aperçu partagé, lui, ne numérote pas une finale (un seul match).
 */
export type NumberedMatchStage = AmbiguousMatchStage | "final" | "lowerFinal";

/**
 * En-tête d'une colonne : « Quarts de finale », « Grande Finale », ou
 * « Manche 2 » pour un premier tour (`roundIndex` : rang du tour dans son
 * tableau, 0 = le premier — jamais le numéro brut du moteur).
 */
export function stageRoundLabel(text: TournamentPageText, key: StageKey, roundIndex: number): string {
  return key === "early" ? text.t("bracket.roundN", { number: String(roundIndex + 1) }) : text.t(`bracket.stage.${key}`);
}

/** Un match d'un stade numéroté : « Quart de finale 2 », « Finale perdants 1 ». */
export function stageMatchLabel(text: TournamentPageText, key: NumberedMatchStage, matchNumber: number): string {
  return text.t(`bracket.matchLabel.${key}`, { number: String(matchNumber) });
}
