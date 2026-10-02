/**
 * Aperçu de la manche suivante d'un tournoi « BlueGenji Survie » — types
 * partagés par le calcul (`preview.ts`) et par l'interface
 * (`docs/features/ENDURANCE_NEXT_ROUND_PREVIEW.md`).
 */

import type { EnduranceConfig } from "../bg-survie/config";
import type { EnduranceMatchRecord } from "../bg-survie/match-outcome";
import type { EnduranceForfeit, EndurancePenalty } from "../bg-survie/replay";
import type { MatchFormat } from "../match-format";

/** Un match du tournoi, tel que l'aperçu le lit. */
export type EnduranceNextRoundMatchRecord = EnduranceMatchRecord & {
  /** `UPPER` pour la qualification et l'arbre, `THIRD_PLACE` pour la petite finale. */
  bracket: string;
  /** Ordre du match dans sa manche — celui des appariements du moteur. */
  matchNumber: number;
};

export type EnduranceNextRoundInput = {
  config: EnduranceConfig;
  /** Format de la **qualification** (`null` = saisie libre). */
  format: MatchFormat | null;
  /** Dernière manche qualificative posée. */
  currentRound: number;
  playoffsStarted: boolean;
  teams: { teamId: number; seed: number }[];
  forfeits: EnduranceForfeit[];
  penalties: EndurancePenalty[];
  matches: EnduranceNextRoundMatchRecord[];
};

/** Une rencontre de la manche suivante, acquise quoi qu'il arrive. */
export type EnduranceNextRoundMatch = {
  /** Équipe de gauche (la mieux classée) quand `sidesKnown`. */
  teamAId: number;
  /** `null` = l'équipe ne joue pas cette manche (effectif impair, exemption). */
  teamBId: number | null;
  /**
   * Les côtés sont-ils acquis eux aussi ? Deux équipes certaines de s'affronter
   * peuvent encore se disputer la meilleure des deux places — celle qui part à
   * gauche, et qui accueille la partie par défaut.
   */
  sidesKnown: boolean;
  bracket: "UPPER" | "THIRD_PLACE";
};

export type EnduranceNextRoundPreview = {
  /** Ce qui suit la manche en cours : une manche qualificative ou un tour d'arbre. */
  stage: "QUALIFICATION" | "PLAYOFFS";
  /** Numéro de la manche à venir (≥ `PLAYOFF_ROUND_OFFSET` pour l'arbre). */
  round: number;
  /**
   * L'étape elle-même est-elle acquise ? Faux quand la phase qualificative peut
   * encore s'achever sur la manche en cours — les rencontres annoncées ne se
   * joueront alors que si elle continue.
   */
  stageCertain: boolean;
  /** Saisie libre : rien ne se prévoit avant la fin de la manche. */
  freeScore: boolean;
  /** Rencontres de la manche courante encore à trancher. */
  pendingMatches: number;
  /**
   * Nombre de rencontres (exemptions exclues) que comptera l'étape suivante,
   * `null` tant que l'effectif n'est pas acquis.
   */
  expectedMatches: number | null;
  /**
   * Play-offs : rencontres **décisives** du tour à venir, exemptions comprises
   * — ce qui le nomme (4 → quarts, 2 → demies, 1 → finale). `null` en
   * qualification, ou tant que l'effectif n'est pas acquis.
   */
  decisiveSlots: number | null;
  matches: EnduranceNextRoundMatch[];
};

/** Place possible d'une équipe au classement de fin de manche. */
export type EnduranceRoundPosition = {
  teamId: number;
  /** Présente quoi qu'il arrive, ou seulement dans certains déroulés. */
  presence: "ALWAYS" | "SOMETIMES";
  /** Meilleure et pire place, 1 = tête, sur les déroulés où elle est présente. */
  best: number;
  worst: number;
};

export type EnduranceRoundAnalysis = {
  positions: Map<number, EnduranceRoundPosition>;
  /** Bornes du nombre d'équipes encore en lice à la fin de la manche. */
  minActive: number;
  maxActive: number;
};

/**
 * Capitaux possibles à l'issue de la manche : `null` = sortie (capital vidé,
 * abandon, coupe). Un « groupe » est un match restant (deux équipes liées) ou
 * une équipe dont la manche est déjà écrite.
 */
export type Unit = { teamIds: number[]; outcomes: (number | null)[][] };
