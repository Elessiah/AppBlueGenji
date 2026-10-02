/**
 * Aperçu de la manche suivante — rencontres **acquises** tirées des places
 * bornées : couples de la manche qualificative suivante, ou premier tour de
 * l'arbre final quand la qualification s'achève sur la manche en cours
 * (`docs/features/ENDURANCE_NEXT_ROUND_PREVIEW.md`).
 *
 * Module pur : aucune dépendance base de données ni interface.
 */

import type { EnduranceConfig } from "../bg-survie/config";
import { planPlayoffFirstRound } from "../bg-survie/playoffs";
import type {
  EnduranceNextRoundMatch,
  EnduranceRoundAnalysis,
  EnduranceRoundPosition,
} from "./types";

/** Équipe présente quoi qu'il arrive, à une place et une seule. */
function fixedAtPositions(analysis: EnduranceRoundAnalysis): Map<number, number> {
  const fixed = new Map<number, number>();
  for (const position of analysis.positions.values()) {
    if (position.presence === "ALWAYS" && position.best === position.worst) {
      fixed.set(position.best, position.teamId);
    }
  }
  return fixed;
}

/**
 * Couples de la manche qualificative suivante : places 1-2, 3-4… du classement
 * (`planEnduranceRound`). Un couple est acquis quand deux équipes présentes
 * quoi qu'il arrive ne peuvent occuper que ses deux places.
 */
export function qualificationMatches(
  analysis: EnduranceRoundAnalysis,
  previous: Map<number, number>,
): EnduranceNextRoundMatch[] {
  const slots = new Map<number, EnduranceRoundPosition[]>();
  for (const position of analysis.positions.values()) {
    if (position.presence !== "ALWAYS") continue;
    const slot = Math.ceil(position.best / 2);
    if (Math.ceil(position.worst / 2) !== slot) continue;
    slots.set(slot, [...(slots.get(slot) ?? []), position]);
  }

  const matches: { slot: number; match: EnduranceNextRoundMatch }[] = [];
  for (const [slot, members] of slots) {
    // Deux équipes enfermées dans les deux mêmes places les occupent forcément
    // toutes les deux. Une troisième ne peut pas s'y trouver ; le garde-fou
    // ne coûte rien.
    if (members.length !== 2) continue;
    const [a, b] = [...members].sort(
      (x, y) =>
        x.best - y.best ||
        x.worst - y.worst ||
        (previous.get(x.teamId) ?? 0) - (previous.get(y.teamId) ?? 0),
    );
    matches.push({
      slot,
      match: {
        teamAId: a.teamId,
        teamBId: b.teamId,
        sidesKnown: a.best === a.worst && b.best === b.worst,
        bracket: "UPPER",
      },
    });
  }

  // Effectif impair et acquis : la dernière ne joue pas. Elle n'est annoncée
  // que si elle est connue — sinon, c'est une place et non une équipe.
  if (analysis.minActive === analysis.maxActive && analysis.minActive % 2 === 1) {
    const last = fixedAtPositions(analysis).get(analysis.minActive);
    if (last !== undefined) {
      matches.push({
        slot: Math.ceil(analysis.minActive / 2),
        match: { teamAId: last, teamBId: null, sidesKnown: true, bracket: "UPPER" },
      });
    }
  }

  matches.sort((x, y) => x.slot - y.slot);
  return matches.map((entry) => entry.match);
}

/**
 * Premier tour de l'arbre final, quand la qualification s'achève sur la manche
 * en cours. Le tableau dépend de l'effectif qualifié : tant qu'il n'est pas
 * acquis, rien ne l'est. Le tirage est celui du moteur, `planPlayoffFirstRound`,
 * appliqué aux **places** plutôt qu'aux équipes.
 */
export function firstPlayoffMatches(
  analysis: EnduranceRoundAnalysis,
  config: EnduranceConfig,
): {
  matches: EnduranceNextRoundMatch[];
  expectedMatches: number | null;
  decisiveSlots: number | null;
} {
  let qualified: number | null = null;
  if (analysis.minActive >= config.playoffSize) {
    qualified = config.playoffSize;
  } else if (analysis.minActive === analysis.maxActive) {
    qualified = analysis.minActive;
  }

  if (qualified === null) return { matches: [], expectedMatches: null, decisiveSlots: null };
  // Une qualifiée ou moins : le tournoi se clôt sans arbre.
  if (qualified <= 1) return { matches: [], expectedMatches: 0, decisiveSlots: 0 };

  const places = Array.from({ length: qualified }, (_, index) => index + 1);
  const plan = planPlayoffFirstRound(places, config);
  const fixed = fixedAtPositions(analysis);

  const matches: EnduranceNextRoundMatch[] = [];
  for (const { pairing } of plan) {
    const teamA = fixed.get(pairing.teamAId);
    const teamB = pairing.teamBId === null ? null : fixed.get(pairing.teamBId);
    if (teamA === undefined || teamB === undefined) continue;
    matches.push({ teamAId: teamA, teamBId: teamB, sidesKnown: true, bracket: "UPPER" });
  }

  return {
    matches,
    expectedMatches: plan.filter((entry) => entry.pairing.teamBId !== null).length,
    decisiveSlots: plan.length,
  };
}
