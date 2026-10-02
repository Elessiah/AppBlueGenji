/**
 * Rejeu de la phase qualificative du mode « BlueGenji Survie » (endurance).
 *
 * Chaque équipe démarre avec un capital de points d'endurance (9 par défaut).
 * Le barème se compte **map par map** : chaque map gagnée en rapporte, chaque
 * map perdue en retire — un 3-0 coûte donc trois points au perdant et en
 * rapporte trois au vainqueur, là où un 3-2 n'en déplace qu'un. À 0, l'équipe
 * est éliminée sur-le-champ. Le classement se relit avant chaque manche
 * (`standings.ts`) ; sous plafond de manches, une équipe qui ne peut plus
 * **mathématiquement** rejoindre le plateau des play-offs est écartée sans
 * attendre la fin (`enduranceEliminationCut`, `qualification.ts`). L'arbre
 * final se tire dans `playoffs.ts`.
 *
 * Comme la Survie et la Ronde suisse, **tout est rejoué** depuis l'historique
 * des matchs : l'endurance, les éliminations et le classement sont dérivés, ce
 * qui rend une correction de score idempotente. Seules les **décisions
 * humaines** sont fournies en entrée — le classement initial (classement du
 * site au lancement, ou ordre fixé par l'arbitre), les abandons et les
 * **pénalités d'endurance** (`lib/shared/endurance-penalty.ts`) : rien de tout
 * cela ne se déduit d'un match, et rien de tout cela ne s'accumule ailleurs que
 * dans sa propre table.
 * Retirer une pénalité défait donc la sanction *et* tout ce qu'elle a entraîné,
 * élimination comprise, comme une correction de score défait une coupe.
 *
 * Les gestes élémentaires du rejeu (un match, les pénalités, les abandons et
 * la coupe d'une manche) vivent dans `replay-steps.ts`.
 *
 * Module pur : aucune dépendance base de données, entièrement testable.
 */

import type { MatchFormat } from "../match-format";
import type { EnduranceConfig } from "./config";
import type { EnduranceMatchOutcome } from "./match-outcome";
import {
  applyEnduranceMatch,
  applyRoundCut,
  applyRoundForfeits,
  applyRoundPenalties,
} from "./replay-steps";
import {
  assignRanks,
  compareEndurance,
  type EnduranceStanding,
  type EnduranceStatus,
} from "./standings";

/**
 * Une case du tableau d'endurance, manche par manche — la lecture « feuille de
 * calcul » du classement.
 *
 * Trois natures, et pas une seule valeur numérique tolérant les trous : un
 * capital de 0 ne dit pas si l'équipe a été vidée par ses résultats ou déclarée
 * forfait, et une case vide ne dit pas si la manche reste à jouer ou si
 * l'équipe n'y était plus.
 *
 * - `POINTS` — capital à l'issue de la manche (0 compris : la manche qui vide
 *   le capital affiche bien ce zéro).
 * - `FORFEIT` — manche couverte par un **forfait de tournoi** : l'équipe est
 *   partie, la case porte « FF » en rouge au lieu d'un nombre, et le restera
 *   pour toutes les manches suivantes.
 * - `OUT` — l'équipe était déjà éliminée : elle n'a pas disputé cette manche et
 *   n'a donc aucun capital à y montrer.
 */
export type EnduranceRoundCell = {
  round: number;
  kind: "POINTS" | "FORFEIT" | "OUT";
  /** Capital à l'issue de la manche. `null` hors des cases `POINTS`. */
  points: number | null;
  /**
   * Points retirés par une **pénalité d'arbitrage** au cours de cette manche,
   * absent s'il n'y en a pas eu.
   *
   * Le capital seul ne raconte pas la sanction : une équipe qui passe de 9 à 6
   * a perdu trois maps ou pris une pénalité de trois points, et le tableau
   * d'endurance ne permet pas de les distinguer. La case porte donc la marque
   * en plus du chiffre.
   */
  penalty?: number;
};

/** Abandon déclaré : décision humaine, non déductible des matchs. */
export type EnduranceForfeit = { teamId: number; round: number };

/**
 * Pénalité d'endurance infligée par l'arbitrage (`lib/shared/endurance-penalty.ts`).
 *
 * Comme l'abandon, c'est une **décision humaine** : elle ne se déduit d'aucun
 * match, elle est donc fournie en entrée du rejeu et non recalculée. Elle porte
 * la manche à laquelle elle a été prononcée, ce qui la place dans la
 * chronologie — une pénalité de la manche 3 pèse sur l'appariement de la 4.
 */
export type EndurancePenalty = { teamId: number; round: number; points: number };

export type ReplayEnduranceInput = {
  teams: { teamId: number; seed: number }[];
  matches: EnduranceMatchOutcome[];
  forfeits: EnduranceForfeit[];
  /**
   * Pénalités d'arbitrage, dans n'importe quel ordre (le rejeu les range par
   * manche). Facultatif : un tournoi sans sanction est le cas courant, et son
   * rejeu doit s'écrire exactement comme avant que les pénalités existent.
   */
  penalties?: EndurancePenalty[];
  config: EnduranceConfig;
  /** Dernière manche générée. */
  lastRound: number;
  /**
   * Format de match du tournoi (`null` = score libre). Il ne sert qu'à chiffrer
   * un forfait, seul cas où aucun score n'est saisi.
   */
  matchFormat?: MatchFormat | null;
};

/**
 * État d'une équipe à la fin de la manche qu'on est en train d'enregistrer.
 *
 * Le statut est lu **au moment où la manche se referme**, pas à la fin du
 * rejeu : c'est ce qui rend la case honnête. Une équipe éliminée à la manche 5
 * a bien un capital à montrer pour les manches 1 à 4 ; lire son statut final
 * les blanchirait toutes.
 */
function enduranceRoundCell(
  standing: EnduranceStanding,
  round: number,
  penalty: number,
): EnduranceRoundCell {
  // Le forfait couvre la manche où il est déclaré **et tout le reste** : c'est
  // la case rouge « FF » du tableau, pas un capital tombé à zéro.
  if (standing.status === "FORFEIT") return { round, kind: "FORFEIT", points: null };

  // Sortie lors d'une manche **antérieure** : elle n'a pas joué celle-ci. La
  // manche de sa sortie, elle, affiche son capital — c'est le résultat de la
  // manche, et pour une équipe écartée faute de perspectives ce capital n'est
  // même pas nul.
  if (
    standing.status !== "ACTIVE" &&
    standing.eliminatedRound !== null &&
    standing.eliminatedRound < round
  ) {
    return { round, kind: "OUT", points: null };
  }

  // La marque de pénalité n'est posée que s'il y en a eu une : un `penalty: 0`
  // sur toutes les cases obligerait chaque lecteur à distinguer « pas de
  // sanction » de « sanction nulle », qui n'existe pas.
  return penalty > 0
    ? { round, kind: "POINTS", points: standing.points, penalty }
    : { round, kind: "POINTS", points: standing.points };
}

/** Rejeu complet : classement final **et** capital manche par manche. */
export type EnduranceReplay = {
  standings: EnduranceStanding[];
  /** Manches rejouées, dans l'ordre (1..N). Vide avant la première manche. */
  rounds: number[];
  /** Cases du tableau, par équipe, alignées sur `rounds`. */
  history: Map<number, EnduranceRoundCell[]>;
  /**
   * Points retirés par pénalité, cumulés par équipe — la **baisse réelle** du
   * capital, jamais la sanction demandée (cf. `applyPenalty`). Absent d'une
   * équipe jamais sanctionnée, plutôt qu'un zéro pour tout le plateau.
   */
  penaltyTotals: Map<number, number>;
};

/**
 * Rejoue la phase qualificative et renvoie l'état complet des équipes.
 *
 * L'élimination est **immédiate** : dès que le capital atteint 0 au cours d'une
 * manche, l'équipe est sortie et ne participe plus aux suivantes — même si un
 * match ultérieur la mentionnait (cas d'un score corrigé a posteriori).
 */
export function replayEndurance(input: ReplayEnduranceInput): EnduranceStanding[] {
  return replayEnduranceDetailed(input).standings;
}

/**
 * Même rejeu, avec l'historique manche par manche en plus.
 *
 * Il n'est pas stocké : il se dérive du même parcours que le classement, donc
 * une correction de score le refait comme elle refait tout le reste. C'est la
 * raison d'être de cette variante — recalculer l'historique dans un second
 * passage laisserait deux vérités possibles pour un même tournoi.
 */
export function replayEnduranceDetailed(input: ReplayEnduranceInput): EnduranceReplay {
  const { teams, matches, forfeits, penalties = [], config, lastRound, matchFormat } = input;

  const standings = initialEnduranceStandings(teams, config);
  const forfeitsByRound = groupForfeitsByRound(forfeits);
  const penaltiesByRound = groupPenaltiesByRound(penalties);

  const maxRound = Math.max(
    lastRound,
    ...matches.map((m) => m.round),
    ...forfeits.map((f) => f.round),
    ...penalties.map((p) => p.round),
    0,
  );

  const roundIsClosed = closedRoundPredicate(matches);

  const rounds: number[] = [];
  const history = new Map<number, EnduranceRoundCell[]>(teams.map((team) => [team.teamId, []]));
  const penaltyTotals = new Map<number, number>();

  for (let round = 1; round <= maxRound; round += 1) {
    for (const match of matches) {
      if (match.round !== round || !match.completed) continue;
      applyEnduranceMatch(match, standings, config, round, matchFormat);
    }

    // Les pénalités tombent **après** les matchs de la manche et **avant** les
    // abandons : une sanction qui vide le capital élimine, mais un abandon
    // déclaré la même manche reste ce qui s'écrit au classement (la bascule
    // `eliminatedThisRound` de `applyRoundForfeits` s'en charge, exactement
    // comme pour une élimination venue d'un score).
    const applied = applyRoundPenalties(standings, penaltiesByRound.get(round), round);
    applyRoundForfeits(standings, forfeitsByRound.get(round), round);

    // Coupe de fin de manche — seulement sous plafond de manches, seulement sur
    // une manche close. Les équipes écartées gardent leur capital : c'est
    // l'horizon qui leur manque, pas les points.
    if (config.maxRounds !== null && roundIsClosed(round)) {
      applyRoundCut(standings, config, config.maxRounds - round, round, matchFormat);
    }

    freezePreviousRanks(standings);

    rounds.push(round);
    recordRoundHistory(standings, round, applied, history, penaltyTotals);
  }

  return { standings: assignRanks([...standings.values()]), rounds, history, penaltyTotals };
}

/** Classement de départ : capital plein, rang = seed. */
function initialEnduranceStandings(
  teams: ReplayEnduranceInput["teams"],
  config: EnduranceConfig,
): Map<number, EnduranceStanding> {
  return new Map<number, EnduranceStanding>(
    teams.map((team) => [
      team.teamId,
      {
        teamId: team.teamId,
        seed: team.seed,
        points: config.startPoints,
        wins: 0,
        losses: 0,
        draws: 0,
        status: "ACTIVE" as EnduranceStatus,
        eliminatedRound: null,
        rank: team.seed,
        previousRank: team.seed,
      },
    ]),
  );
}

/** Abandons rangés par manche, dans l'ordre de leur déclaration. */
function groupForfeitsByRound(forfeits: EnduranceForfeit[]): Map<number, number[]> {
  const forfeitsByRound = new Map<number, number[]>();
  for (const forfeit of forfeits) {
    const list = forfeitsByRound.get(forfeit.round) ?? [];
    list.push(forfeit.teamId);
    forfeitsByRound.set(forfeit.round, list);
  }
  return forfeitsByRound;
}

/**
 * Pénalités rangées par manche puis par équipe.
 *
 * Les pénalités d'une manche sont **cumulées** par équipe : rien n'interdit à
 * l'arbitrage d'en prononcer deux dans la même manche, et le tableau doit alors
 * montrer le retrait total, pas la dernière.
 */
function groupPenaltiesByRound(penalties: EndurancePenalty[]): Map<number, Map<number, number>> {
  const penaltiesByRound = new Map<number, Map<number, number>>();
  for (const penalty of penalties) {
    const byTeam = penaltiesByRound.get(penalty.round) ?? new Map<number, number>();
    byTeam.set(penalty.teamId, (byTeam.get(penalty.teamId) ?? 0) + penalty.points);
    penaltiesByRound.set(penalty.round, byTeam);
  }
  return penaltiesByRound;
}

/**
 * Une manche est **close** quand elle a des matchs et qu'ils sont tous joués.
 * La coupe de fin de manche s'y adosse : sur une manche entamée, une équipe qui
 * n'a pas encore disputé la sienne verrait son plafond calculé comme si elle
 * avait déjà tout perdu.
 */
function closedRoundPredicate(matches: EnduranceMatchOutcome[]): (round: number) => boolean {
  const roundProgress = new Map<number, { total: number; done: number }>();
  for (const match of matches) {
    const entry = roundProgress.get(match.round) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (match.completed) entry.done += 1;
    roundProgress.set(match.round, entry);
  }
  return (round: number): boolean => {
    const entry = roundProgress.get(round);
    return entry !== undefined && entry.total > 0 && entry.total === entry.done;
  };
}

/** Fige l'ordre de cette manche : il servira de départage à la suivante. */
function freezePreviousRanks(standings: Map<number, EnduranceStanding>): void {
  const ordered = [...standings.values()].filter((s) => s.status === "ACTIVE").sort(compareEndurance);
  ordered.forEach((standing, index) => {
    standing.previousRank = index + 1;
  });
}

function recordRoundHistory(
  standings: Map<number, EnduranceStanding>,
  round: number,
  applied: Map<number, number>,
  history: Map<number, EnduranceRoundCell[]>,
  penaltyTotals: Map<number, number>,
): void {
  for (const standing of standings.values()) {
    const removed = applied.get(standing.teamId) ?? 0;
    if (removed > 0) {
      penaltyTotals.set(standing.teamId, (penaltyTotals.get(standing.teamId) ?? 0) + removed);
    }
    history.get(standing.teamId)?.push(enduranceRoundCell(standing, round, removed));
  }
}
