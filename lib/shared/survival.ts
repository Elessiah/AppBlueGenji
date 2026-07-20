/**
 * Logique pure du mode de tournoi « Survie ».
 *
 * Toutes les équipes évoluent dans un unique groupe. Au départ, le classement
 * est fixé par le seeding issu du classement du site (seed = 1 pour la meilleure
 * équipe). Ensuite, à chaque round, le classement est recalculé en fonction des
 * victoires puis des défaites (la meilleure équipe en haut) et les équipes sont
 * appariées par paires adjacentes (1 vs 2, 3 vs 4, …).
 *
 * Après chaque bloc de `roundsPerCut` rounds, les deux dernières équipes encore
 * en lice sont éliminées (une seule lorsqu'il ne resterait sinon plus personne),
 * et ainsi de suite jusqu'à ce qu'il ne reste qu'une équipe championne.
 *
 * Ce module ne dépend d'aucune base de données : il est entièrement testable.
 */

export type SurvivalStatus = "ACTIVE" | "ELIMINATED" | "FORFEIT";

export type SurvivalStanding = {
  teamId: number;
  /** Seed initial (1 = meilleure équipe au classement du site). */
  seed: number;
  wins: number;
  losses: number;
  status: SurvivalStatus;
  /** Round auquel l'équipe a été éliminée ou a déclaré forfait (null si active). */
  eliminatedRound: number | null;
  /** Vrai si l'équipe a déjà bénéficié d'une victoire d'office (bye). */
  hasBye: boolean;
};

export type SurvivalPairing = {
  teamAId: number;
  teamBId: number | null;
};

export type SurvivalRoundPlan = {
  pairings: SurvivalPairing[];
  /** Équipe recevant une victoire d'office ce round (nombre impair), sinon null. */
  byeTeamId: number | null;
};

/**
 * Ordre de classement : victoires décroissantes, puis défaites croissantes, puis
 * seed croissant (départage stable par le classement du site). La meilleure
 * équipe se retrouve en tête du tableau.
 */
export function compareStanding(a: SurvivalStanding, b: SurvivalStanding): number {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (a.losses !== b.losses) return a.losses - b.losses;
  return a.seed - b.seed;
}

/** Renvoie les équipes encore en lice, triées par classement courant (meilleure en tête). */
export function rankActiveTeams(standings: SurvivalStanding[]): SurvivalStanding[] {
  return standings.filter((s) => s.status === "ACTIVE").sort(compareStanding);
}

/**
 * Construit l'appariement d'un round à partir des équipes actives déjà classées.
 * Paires adjacentes (1 vs 2, 3 vs 4, …). Si le nombre est impair, l'équipe la
 * plus basse n'ayant pas encore eu de bye reçoit une victoire d'office afin de
 * ne pas la pénaliser ; à défaut, la dernière du classement.
 */
export function planSurvivalRound(orderedActive: SurvivalStanding[]): SurvivalRoundPlan {
  const teams = [...orderedActive];
  let byeTeamId: number | null = null;

  if (teams.length % 2 === 1) {
    let byeIndex = teams.length - 1;
    for (let i = teams.length - 1; i >= 0; i--) {
      if (!teams[i].hasBye) {
        byeIndex = i;
        break;
      }
    }
    byeTeamId = teams[byeIndex].teamId;
    teams.splice(byeIndex, 1);
  }

  const pairings: SurvivalPairing[] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    pairings.push({ teamAId: teams[i].teamId, teamBId: teams[i + 1].teamId });
  }

  return { pairings, byeTeamId };
}

/**
 * Nombre d'équipes à éliminer lors d'une coupe : deux par défaut, réduit à une
 * seule quand il ne resterait sinon plus aucune équipe (garantit un vainqueur
 * unique). Zéro s'il reste au plus une équipe.
 */
export function teamsToEliminate(activeCount: number): number {
  if (activeCount <= 1) return 0;
  return Math.min(2, activeCount - 1);
}

/** Vrai lorsque le round courant clôt un bloc de `roundsPerCut` rounds. */
export function isCutRound(round: number, roundsPerCut: number): boolean {
  return roundsPerCut > 0 && round > 0 && round % roundsPerCut === 0;
}

/**
 * Sélectionne les équipes éliminées à la fin d'un round de coupe : les plus
 * basses du classement courant parmi les équipes actives.
 */
export function selectEliminatedTeamIds(
  orderedActive: SurvivalStanding[],
  count: number,
): number[] {
  if (count <= 0) return [];
  return orderedActive.slice(orderedActive.length - count).map((s) => s.teamId);
}

/**
 * Attribue le classement final. La championne (dernière équipe active, ou à
 * défaut la mieux classée) obtient le rang 1 ; les autres sont ordonnées par
 * round d'élimination décroissant (éliminées tard = mieux classées), puis par
 * victoires/défaites/seed.
 */
export function computeFinalRanks(standings: SurvivalStanding[]): Map<number, number> {
  const active = standings.filter((s) => s.status === "ACTIVE").sort(compareStanding);
  const others = standings.filter((s) => s.status !== "ACTIVE");

  others.sort((a, b) => {
    const ra = a.eliminatedRound ?? 0;
    const rb = b.eliminatedRound ?? 0;
    if (rb !== ra) return rb - ra;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.seed - b.seed;
  });

  const ordered = [...active, ...others];
  const ranks = new Map<number, number>();
  ordered.forEach((s, idx) => ranks.set(s.teamId, idx + 1));
  return ranks;
}
