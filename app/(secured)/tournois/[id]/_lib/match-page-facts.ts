import type { BracketMatch } from "@/lib/shared/types";
import type { MatchPageSide } from "@/lib/shared/match-page";
import { resolveMatchMaps, roundMapsOf, type TournamentMapRules } from "@/lib/shared/round-maps";
import { visibleText } from "@/lib/shared/visible-text";
import { matchSideViews } from "./match-row-sides";

/**
 * Faits de la page d'un match (`docs/features/MATCH_PAGE.md`), en module pur :
 * le score de l'en-tête dans l'ordre des côtés (hôte à gauche) et les maps
 * des faits clés. Rien de nouveau n'est lu : ce sont les champs de
 * l'instantané que la carte montrait déjà.
 */

/** Score de l'en-tête, côté gauche puis côté droit ; `null` tant qu'aucun score ni forfait n'est posé. */
export type MatchPageHeaderScore = { left: string; right: string };

/**
 * Score de l'en-tête, rangé comme les côtés (`matchPageSides`, hôte à gauche) :
 * le même que la carte (`matchSideViews` — « FF » sur forfait enregistré),
 * `null` quand rien n'est encore joué (le tableau d'affichage dit « VS »).
 */
export function matchPageHeaderScore(
  match: Pick<BracketMatch, "team1Id" | "team2Id" | "team1Score" | "team2Score" | "winnerTeamId" | "forfeitTeamId" | "roundNumber">,
  sides: readonly [Pick<MatchPageSide, "slot">, Pick<MatchPageSide, "slot">],
  doubleForfeit: boolean,
): MatchPageHeaderScore | null {
  const views = matchSideViews(match, match.roundNumber, doubleForfeit);
  const [left, right] = sides.map((side) => views[side.slot - 1]);
  if (left.score === "-" && right.score === "-") return null;
  return { left: String(left.score), right: String(right.score) };
}

/** Une map des faits clés : jouée (imposée ou choisie), ou à choisir dans un pool. */
export type MatchPageMapFact = {
  number: number;
  /** Map jouée (texte visible, `visibleText`) ; `null` = à choisir. */
  map: string | null;
  /** Imposée par le réglage du tour (seule map de sa case). */
  imposed: boolean;
  /** Pool encore ouvert (vide quand la map est connue). */
  candidates: string[];
};

/**
 * Maps du match selon le réglage de son tour (`ROUND_MAPS.md`) : « Map 1 :
 * Ilios », ou le pool à choisir — vide sans réglage (la page dit alors la
 * première map saisie match par match). La règle « choisie par le perdant »
 * n'est pas dite : elle n'est pas appliquée tant que les scores par carte
 * n'existent pas (`NextPickRule`).
 */
export function matchPageMapFacts(
  rules: Pick<TournamentMapRules, "rounds">,
  match: Pick<BracketMatch, "phaseId" | "bracket" | "roundNumber" | "firstMap" | "mapPicks">,
): MatchPageMapFact[] {
  const round = roundMapsOf(rules.rounds, match);
  if (!round) return [];
  return resolveMatchMaps(round.slots, match.firstMap, match.mapPicks).map((slot) => {
    // Saisie libre (première map, choix) : texte visible seulement, comme `matchMapNames`.
    const map = slot.map === null ? "" : visibleText(slot.map).trim();
    const known = map === "" ? null : map;
    return {
      number: slot.number,
      map: known,
      imposed: slot.kind === "IMPOSED",
      candidates: known === null ? slot.candidates : [],
    };
  });
}
