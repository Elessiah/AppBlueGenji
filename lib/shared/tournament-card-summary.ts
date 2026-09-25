/**
 * Résumé d'un tournoi pour sa **carte** de liste : ce qu'on vient y chercher,
 * et que ni l'état ni les dates ne disent.
 *
 * Un tournoi terminé se résume à qui l'a gagné ; un tournoi en cours à où il en
 * est. Les cartes de `/tournois` répétaient à la place l'état du tournoi trois
 * ou quatre fois (ruban, sous-titre, case « État », pied « Statut »).
 *
 * Module pur : le serveur fournit des lignes (`lib/server/tournaments/
 * list-summary.ts` pour la liste, l'instantané pour la fiche), et c'est ici que
 * la règle se décide, une seule fois pour les deux.
 */
import { computeRunningRatio } from "./tournament-progress";
import type {
  EnduranceStandingRow,
  MatchStatus,
  PhaseFormat,
  PhaseState,
  SurvivalStandingRow,
  TournamentChampion,
  TournamentFormat,
} from "./types";

/** Un engagé et son rang final, tel que les inscriptions le portent. */
export type ChampionCandidate = {
  teamId: number;
  name: string;
  finalRank: number | null;
};

/**
 * Le vainqueur d'un tournoi : l'**unique** engagé classé premier.
 *
 * Aucun, ou plusieurs, ne désigne personne — une finale en double forfait ne
 * sacre aucune équipe (`podiumRanks`), et nommer l'une de deux premières ex
 * æquo serait choisir à la place du classement.
 */
export function pickChampion(candidates: readonly ChampionCandidate[]): TournamentChampion | null {
  const first = candidates.filter((candidate) => candidate.finalRank === 1);
  if (first.length !== 1) return null;
  return { teamId: first[0].teamId, name: first[0].name };
}

/**
 * Matchs d'un tournoi comptés par manche : `total` rencontres, dont `completed`
 * terminées. La liste ne lit que ces comptes — relire chaque ligne de chaque
 * plateau en cours à chaque reconstruction coûterait des milliers de lignes
 * pour en tirer un pourcentage.
 */
export type MatchCountRow = {
  phaseId: number;
  roundNumber: number;
  total: number;
  completed: number;
};

/** Ce qu'il faut d'un tournoi en cours pour situer son déroulement. */
export type RunningProgressSource = {
  format: TournamentFormat;
  swissTotalRounds: number | null;
  swissCurrentRound: number;
  currentPhaseId: number | null;
  matchCounts: readonly MatchCountRow[];
  survivalStatuses: readonly SurvivalStandingRow["status"][];
  enduranceStatuses: readonly EnduranceStandingRow["status"][];
  phases: readonly {
    id: number;
    state: PhaseState;
    format: PhaseFormat;
    swissTotalRounds: number | null;
  }[];
};

/**
 * Déroule les comptes en rencontres, pour les confier tels quels à
 * `computeRunningRatio` : la mesure reste celle de la frise de la fiche, écrite
 * une seule fois, et la carte ne peut pas annoncer un autre pourcentage.
 */
function expandMatchCounts(counts: readonly MatchCountRow[]) {
  const matches: { status: MatchStatus; roundNumber: number; phaseId: number }[] = [];
  for (const row of counts) {
    const total = Math.max(0, Math.floor(row.total));
    const completed = Math.min(total, Math.max(0, Math.floor(row.completed)));
    for (let i = 0; i < total; i += 1) {
      matches.push({
        status: i < completed ? "COMPLETED" : "PENDING",
        roundNumber: row.roundNumber,
        phaseId: row.phaseId,
      });
    }
  }
  return matches;
}

/**
 * Avancement interne d'un tournoi en cours, de 0 à 1 — même mesure, par
 * famille de formats, que `computeRunningRatio` sur la fiche. `null` quand
 * rien ne permet encore de le situer.
 */
export function runningProgressFrom(source: RunningProgressSource): number | null {
  return computeRunningRatio({
    format: source.format,
    matches: expandMatchCounts(source.matchCounts),
    swiss:
      source.format === "SWISS"
        ? {
            totalRounds: Number(source.swissTotalRounds ?? 0),
            currentRound: Number(source.swissCurrentRound),
          }
        : null,
    survivalStandings: source.survivalStatuses.map((status) => ({ status })),
    enduranceStandings: source.enduranceStatuses.map((status) => ({ status })),
    phases: source.phases.map((phase) => ({ ...phase })),
    currentPhaseId: source.currentPhaseId,
  });
}
