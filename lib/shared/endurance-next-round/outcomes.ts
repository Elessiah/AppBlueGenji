/**
 * Aperçu de la manche suivante — déroulés possibles de la manche qualificative
 * en cours (`docs/features/ENDURANCE_NEXT_ROUND_PREVIEW.md`).
 *
 * L'état de départ de la manche est **rejoué** (`replayEnduranceDetailed`, le
 * même rejeu que le moteur) ; chaque match restant est remplacé par la liste de
 * **tous** ses résultats enregistrables (`checkMatchScores`, la règle de saisie
 * elle-même, plus le forfait au score plein) ; les équipes dont le match est
 * joué, ou qui chôment, ont un capital déjà écrit.
 *
 * Module pur : aucune dépendance base de données ni interface.
 */

import type { EnduranceConfig } from "../bg-survie/config";
import { enduranceMatchOutcome } from "../bg-survie/match-outcome";
import { enduranceRoundSwing } from "../bg-survie/qualification";
import { replayEnduranceDetailed } from "../bg-survie/replay";
import { PLAYOFF_ROUND_OFFSET } from "../bg-survie/rounds";
import {
  checkMatchScores,
  forfeitMapCount,
  matchWinsRequired,
  type MatchFormat,
} from "../match-format";
import type { EnduranceNextRoundInput, Unit } from "./types";

/**
 * Variations de capital (side 1, side 2) de **tous** les résultats qu'un match
 * restant peut enregistrer.
 *
 * La liste descend de `checkMatchScores`, la règle même qui valide une saisie :
 * un résultat que le serveur refuserait n'a pas à entrer dans le calcul, et un
 * résultat qu'il accepte ne doit pas en être absent. S'y ajoute le forfait,
 * compté au score plein du format, que l'arbitrage pose sans passer par cette
 * règle. Le double forfait n'y figure pas : c'est une décision d'arbitrage,
 * comme l'abandon.
 */
export function pendingMatchDeltas(
  format: MatchFormat,
  config: EnduranceConfig,
): [number, number][] {
  const wins = matchWinsRequired(format);
  const forfeitMaps = forfeitMapCount(format);
  const deltas = new Map<string, [number, number]>();

  const add = (maps1: number, maps2: number) => {
    const delta1 = config.winDelta * maps1 - config.lossDelta * maps2;
    const delta2 = config.winDelta * maps2 - config.lossDelta * maps1;
    deltas.set(`${delta1}:${delta2}`, [delta1, delta2]);
  };

  for (let score1 = 0; score1 <= wins; score1 += 1) {
    for (let score2 = 0; score2 <= wins; score2 += 1) {
      if (checkMatchScores(format, score1, score2, { decisive: true }) === null) add(score1, score2);
    }
  }
  add(forfeitMaps, 0);
  add(0, forfeitMaps);

  return [...deltas.values()];
}

/** Retire les doublons d'une liste de déroulés (même capital pour chacun). */
function uniqueOutcomes(outcomes: (number | null)[][]): (number | null)[][] {
  const seen = new Map<string, (number | null)[]>();
  for (const outcome of outcomes) seen.set(outcome.map(String).join(":"), outcome);
  return [...seen.values()];
}

/**
 * Déroulés possibles de la manche qualificative en cours, et ordre précédent.
 *
 * `null` quand il n'y a rien à prévoir : pas de manche posée, ou plus aucun
 * match à jouer — le moteur pose alors lui-même la suivante.
 */
export function qualificationUnits(input: EnduranceNextRoundInput): {
  units: Unit[];
  previous: Map<number, number>;
  pendingMatches: number;
} | null {
  const { config, format, currentRound: round, teams } = input;
  if (round < 1 || !format) return null;

  const records = input.matches.filter((match) => match.round < PLAYOFF_ROUND_OFFSET);
  const outcomes = records.map(enduranceMatchOutcome);
  const pending = records.filter(
    (match) => match.round === round && match.status !== "COMPLETED",
  );
  if (pending.length === 0) return null;

  // Départ de la manche : capital, statut, et ordre qui départagera les égalités.
  const before = replayEnduranceDetailed({
    teams,
    matches: outcomes.filter((outcome) => outcome.round < round),
    forfeits: input.forfeits.filter((forfeit) => forfeit.round < round),
    penalties: input.penalties.filter((penalty) => penalty.round < round),
    config,
    lastRound: round - 1,
    matchFormat: format,
  }).standings;

  // Les matchs déjà joués de la manche, et eux seuls : la manche n'étant pas
  // close, le rejeu n'y applique aucune coupe. Pénalités et abandons de la
  // manche sont écartés ici — ils s'appliquent **après** les matchs, sur le
  // capital final, et l'ordre compte : une pénalité qui viderait le capital
  // avant une victoire ne le vide plus après.
  const afterPlayed = replayEnduranceDetailed({
    teams,
    matches: outcomes.filter((outcome) => outcome.round <= round),
    forfeits: input.forfeits.filter((forfeit) => forfeit.round < round),
    penalties: input.penalties.filter((penalty) => penalty.round < round),
    config,
    lastRound: round,
    matchFormat: format,
  }).standings;

  const active = before.filter((standing) => standing.status === "ACTIVE");
  const activeIds = new Set(active.map((standing) => standing.teamId));
  const previous = new Map(active.map((standing) => [standing.teamId, standing.previousRank]));
  const afterById = new Map(afterPlayed.map((standing) => [standing.teamId, standing]));

  const penaltyNow = new Map<number, number>();
  for (const penalty of input.penalties) {
    if (penalty.round !== round) continue;
    penaltyNow.set(penalty.teamId, (penaltyNow.get(penalty.teamId) ?? 0) + penalty.points);
  }
  const forfeitNow = new Set(
    input.forfeits.filter((forfeit) => forfeit.round === round).map((forfeit) => forfeit.teamId),
  );

  // Capital de fin de manche, à partir du capital après match : pénalité de la
  // manche, puis abandon. Une sanction ne frappe qu'une équipe encore en lice,
  // et une sortie reste une sortie.
  const settle = (teamId: number, afterMatch: number | null): number | null => {
    if (afterMatch === null || afterMatch <= 0 || forfeitNow.has(teamId)) return null;
    const points = afterMatch - (penaltyNow.get(teamId) ?? 0);
    return points > 0 ? points : null;
  };

  const deltas = pendingMatchDeltas(format, config);
  const units: Unit[] = [];
  const grouped = new Set<number>();

  for (const match of pending) {
    // Un match dont une équipe n'était plus en lice ne compte pour personne
    // (règle du rejeu) : ses équipes restent seules, capital inchangé.
    if (
      match.team1Id === null ||
      match.team2Id === null ||
      !activeIds.has(match.team1Id) ||
      !activeIds.has(match.team2Id)
    ) {
      continue;
    }
    const team1 = match.team1Id;
    const team2 = match.team2Id;
    const base1 = afterById.get(team1)?.points ?? 0;
    const base2 = afterById.get(team2)?.points ?? 0;
    units.push({
      teamIds: [team1, team2],
      outcomes: uniqueOutcomes(
        deltas.map(([delta1, delta2]) => [
          settle(team1, base1 + delta1),
          settle(team2, base2 + delta2),
        ]),
      ),
    });
    grouped.add(team1);
    grouped.add(team2);
  }

  for (const standing of active) {
    if (grouped.has(standing.teamId)) continue;
    const after = afterById.get(standing.teamId);
    const afterMatch = after?.status === "ACTIVE" ? after.points : null;
    units.push({ teamIds: [standing.teamId], outcomes: [[settle(standing.teamId, afterMatch)]] });
  }

  return {
    units: withEliminationCut(units, input, round),
    previous,
    pendingMatches: pending.length,
  };
}

/**
 * Sous plafond de manches, la fin de la manche peut **écarter** des équipes
 * (`enduranceEliminationCut`). La règle regarde tout le plateau à la fois —
 * elle ne se découpe pas match par match —, si bien qu'elle est ici approchée
 * par le haut : toute équipe qu'un déroulé *pourrait* écarter reçoit un déroulé
 * de plus, où elle est absente. Le calcul y perd des rencontres qu'il aurait pu
 * annoncer, jamais il n'en annonce une de trop.
 *
 * La dernière manche n'est pas concernée : la coupe y est un simple trait sous
 * la cible, que l'ordre des équipes suffit à décrire.
 */
function withEliminationCut(
  units: Unit[],
  input: EnduranceNextRoundInput,
  round: number,
): Unit[] {
  const { config, format } = input;
  if (config.maxRounds === null) return units;
  const remaining = config.maxRounds - round;
  if (remaining <= 0) return units;

  const swing = enduranceRoundSwing(config, format);
  if (!swing) return units;
  const gain = swing.gain * remaining;
  const loss = swing.loss * remaining;

  const range = new Map<number, { low: number; high: number }>();
  for (const unit of units) {
    unit.teamIds.forEach((teamId, index) => {
      for (const outcome of unit.outcomes) {
        const points = outcome[index];
        if (points === null) continue;
        const current = range.get(teamId);
        range.set(teamId, {
          low: Math.min(current?.low ?? points, points),
          high: Math.max(current?.high ?? points, points),
        });
      }
    });
  }

  const mayBeCut = new Set<number>();
  for (const [teamId, own] of range) {
    let ahead = 0;
    for (const [otherId, other] of range) {
      if (otherId !== teamId && other.high - loss > own.low + gain) ahead += 1;
    }
    if (ahead >= config.playoffSize) mayBeCut.add(teamId);
  }
  if (mayBeCut.size === 0) return units;

  return units.map((unit) => {
    let outcomes = unit.outcomes;
    unit.teamIds.forEach((teamId, index) => {
      if (!mayBeCut.has(teamId)) return;
      outcomes = outcomes.flatMap((outcome) => {
        if (outcome[index] === null) return [outcome];
        return [outcome, outcome.map((points, i) => (i === index ? null : points))];
      });
    });
    return { teamIds: unit.teamIds, outcomes: uniqueOutcomes(outcomes) };
  });
}
