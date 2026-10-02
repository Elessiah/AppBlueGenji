/**
 * Aperçu de la manche suivante — place possible de chaque équipe au classement
 * de fin de manche, bornée **exactement** sur les déroulés de `outcomes.ts`
 * (`docs/features/ENDURANCE_NEXT_ROUND_PREVIEW.md`).
 *
 * Module pur : aucune dépendance base de données ni interface.
 */

import { qualificationUnits } from "./outcomes";
import type {
  EnduranceNextRoundInput,
  EnduranceRoundAnalysis,
  EnduranceRoundPosition,
  Unit,
} from "./types";

/**
 * Nombre d'équipes d'un groupe classées devant un seuil, au mieux et au pire,
 * selon l'intervalle où tombe le seuil entre les clés du groupe.
 */
type Step = { breaks: number[]; low: number[]; high: number[] };

/** Nombre d'éléments de `sorted` strictement inférieurs à `value`. */
function countBelow(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Place possible de chaque équipe à la fin de la manche.
 *
 * Exact sur les groupes fournis : fixer le déroulé du groupe de l'équipe rend
 * les autres groupes indépendants, et le nombre d'équipes devant elle se borne
 * alors groupe par groupe.
 *
 * L'ordre de classement — capital décroissant, puis ordre précédent
 * (`compareEndurance`) — devient une **clé** numérique unique par équipe :
 * `capital × échelle − ordre précédent`. « Devant » s'écrit alors « clé plus
 * grande », et chaque groupe se résume à une fonction en escalier du seuil : au
 * mieux et au pire, combien de ses équipes dépassent-il ? Ces fonctions sont
 * sommées une fois pour tout le plateau, si bien qu'une équipe se situe par une
 * recherche dichotomique, dont on retire la part de son propre groupe. Sans ce
 * détour, cent vingt-huit équipes en BO15 coûtaient près d'une seconde au fil
 * principal, à chaque score reçu.
 */
export function analysePositions(units: Unit[], previous: Map<number, number>): EnduranceRoundAnalysis {
  // Deux équipes n'ont jamais le même ordre précédent : la clé est unique, et un
  // seuil (la clé d'une équipe) ne tombe jamais sur la clé d'une autre.
  const scale = Math.max(0, ...previous.values()) + 1;
  const keyOf = (teamId: number, points: number | null): number | null =>
    points === null ? null : points * scale - (previous.get(teamId) ?? 0);

  const keyed = units.map((unit) =>
    unit.outcomes.map((outcome) => outcome.map((points, index) => keyOf(unit.teamIds[index], points))),
  );

  const steps: Step[] = keyed.map((outcomes) => {
    const breaks = [
      ...new Set(outcomes.flat().filter((key): key is number => key !== null)),
    ].sort((x, y) => x - y);
    const low: number[] = [];
    const high: number[] = [];
    // Intervalle i : seuil entre breaks[i − 1] et breaks[i], donc les clés
    // qui le dépassent sont celles ≥ breaks[i].
    for (let i = 0; i <= breaks.length; i += 1) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const outcome of outcomes) {
        const count =
          i === breaks.length ? 0 : outcome.filter((key) => key !== null && key >= breaks[i]).length;
        min = Math.min(min, count);
        max = Math.max(max, count);
      }
      low.push(min);
      high.push(max);
    }
    return { breaks, low, high };
  });

  // Somme des escaliers sur les intervalles de toutes les clés du plateau, par
  // différences : chaque palier d'un groupe couvre une plage d'intervalles.
  const all = [...new Set(steps.flatMap((step) => step.breaks))].sort((x, y) => x - y);
  const lowDiff = new Array<number>(all.length + 2).fill(0);
  const highDiff = new Array<number>(all.length + 2).fill(0);
  for (const step of steps) {
    for (let i = 0; i <= step.breaks.length; i += 1) {
      const start = i === 0 ? 0 : countBelow(all, step.breaks[i - 1]) + 1;
      const end = i === step.breaks.length ? all.length : countBelow(all, step.breaks[i]);
      lowDiff[start] += step.low[i];
      lowDiff[end + 1] -= step.low[i];
      highDiff[start] += step.high[i];
      highDiff[end + 1] -= step.high[i];
    }
  }
  const lowSum: number[] = [];
  const highSum: number[] = [];
  let lowRun = 0;
  let highRun = 0;
  for (let g = 0; g <= all.length; g += 1) {
    lowRun += lowDiff[g];
    highRun += highDiff[g];
    lowSum.push(lowRun);
    highSum.push(highRun);
  }

  const positions = new Map<number, EnduranceRoundPosition>();

  units.forEach((unit, unitIndex) => {
    const own = steps[unitIndex];
    const outcomes = keyed[unitIndex];

    unit.teamIds.forEach((teamId, index) => {
      let best = Number.POSITIVE_INFINITY;
      let worst = Number.NEGATIVE_INFINITY;
      let present = 0;

      for (const outcome of outcomes) {
        const key = outcome[index];
        if (key === null) continue;
        present += 1;

        // Le reste du plateau : la somme de tous les groupes, moins le sien.
        const global = countBelow(all, key);
        const local = countBelow(own.breaks, key);
        const restLow = lowSum[global] - own.low[local];
        const restHigh = highSum[global] - own.high[local];
        // Son propre groupe, dans **ce** déroulé.
        const partners = outcome.filter(
          (other, otherIndex) => otherIndex !== index && other !== null && other > key,
        ).length;

        best = Math.min(best, 1 + partners + restLow);
        worst = Math.max(worst, 1 + partners + restHigh);
      }

      if (present === 0) return;
      positions.set(teamId, {
        teamId,
        presence: present === outcomes.length ? "ALWAYS" : "SOMETIMES",
        best,
        worst,
      });
    });
  });

  let minActive = 0;
  let maxActive = 0;
  for (const unit of units) {
    const counts = unit.outcomes.map((outcome) => outcome.filter((points) => points !== null).length);
    minActive += Math.min(...counts);
    maxActive += Math.max(...counts);
  }

  return { positions, minActive, maxActive };
}

/**
 * Place possible de chaque équipe en lice à la fin de la manche qualificative
 * en cours. `null` hors d'une manche qualificative ouverte, ou en saisie libre.
 *
 * Exposée pour les tests : c'est elle qui porte la preuve, l'aperçu n'en tire
 * que les couples.
 */
export function analyseEnduranceRound(input: EnduranceNextRoundInput): EnduranceRoundAnalysis | null {
  if (input.playoffsStarted) return null;
  const prepared = qualificationUnits(input);
  if (!prepared) return null;
  return analysePositions(prepared.units, prepared.previous);
}
