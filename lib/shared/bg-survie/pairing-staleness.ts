/**
 * BlueGenji Survie — les appariements posés en base décrivent-ils encore le
 * tirage attendu ? Sert à réapparier une manche qualificative et à réparer
 * l'arbre final après une correction de score (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Module pur : aucune dépendance base de données.
 */

import type { PlayoffRoundPlan } from "./playoffs";
import type { EndurancePairing } from "./standings";

/**
 * Les appariements posés en base décrivent-ils encore le tirage attendu ?
 *
 * Comparaison couple par couple, **sides compris** : l'ordre gauche/droite est
 * lui aussi dérivé du classement, et l'inverser change ce que lisent les
 * engagées. Une liste vide en base n'est pas périmée — il n'y a rien à défaire.
 */
export function pairingsAreStale(
  expected: EndurancePairing[],
  actual: { teamAId: number | null; teamBId: number | null }[],
): boolean {
  if (actual.length === 0) return false;
  if (expected.length !== actual.length) return true;

  return expected.some(
    (pairing, index) =>
      pairing.teamAId !== actual[index].teamAId || pairing.teamBId !== actual[index].teamBId,
  );
}

/**
 * Le tour d'arbre final posé en base correspond-il au plan ?
 *
 * S'ajoute à la comparaison des couples celle des `bracket` : une petite finale
 * et une demi-finale ne sont pas interchangeables, même entre les deux mêmes
 * équipes.
 */
export function playoffRoundIsStale(
  plan: PlayoffRoundPlan,
  actual: { bracket: string; teamAId: number | null; teamBId: number | null }[],
): boolean {
  if (actual.length === 0) return false;
  if (plan.length !== actual.length) return true;
  if (plan.some((entry, index) => entry.bracket !== actual[index].bracket)) return true;

  return pairingsAreStale(
    plan.map((entry) => entry.pairing),
    actual,
  );
}
