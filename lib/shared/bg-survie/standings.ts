/**
 * BlueGenji Survie — le classement d'endurance : ses lignes, son ordre
 * (endurance décroissante, puis ordre du classement précédent) et
 * l'appariement d'une manche qualificative (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Module pur : aucune dépendance base de données.
 */

/**
 * Sortie d'une équipe de la phase qualificative.
 *
 * `ELIMINATED` et `OUT_OF_CONTENTION` ne se confondent pas, et c'est tout
 * l'intérêt de les nommer séparément : la première a **vidé son capital**
 * (0 point, elle est tombée), la seconde en a encore mais **ne peut plus
 * atteindre le plateau des play-offs** dans les manches qui restent. Afficher
 * « Éliminée » à côté d'un capital de 6 points ne se lit pas.
 */
export type EnduranceStatus = "ACTIVE" | "ELIMINATED" | "OUT_OF_CONTENTION" | "FORFEIT";

export type EnduranceStanding = {
  teamId: number;
  /** Rang initial, fixé par l'ordre de seeding (1 = tête de classement). */
  seed: number;
  points: number;
  wins: number;
  losses: number;
  /**
   * Matchs clos sans vainqueur.
   *
   * Ni une demi-victoire ni une demi-défaite : le capital, lui, a déjà bougé
   * map par map — un 2-2 en barème ±1 ne déplace rien, un barème asymétrique le
   * fera bouger. Compté à part pour que « matchs joués » reste juste.
   */
  draws: number;
  status: EnduranceStatus;
  /** Manche à laquelle l'équipe est tombée à 0 (ou a abandonné). */
  eliminatedRound: number | null;
  /** Rang courant, 1 = meilleure. Les éliminées suivent les actives. */
  rank: number;
  /**
   * Position au classement **précédent**, seul départage prévu par le règlement
   * en cas d'égalité de points. Initialisée au seed (classement de départ),
   * puis réécrite après chaque manche.
   */
  previousRank: number;
};

export type EndurancePairing = {
  /** Équipe la mieux classée du couple → side GAUCHE. */
  teamAId: number;
  /** Side DROITE. `null` = effectif impair, la dernière ne joue pas. */
  teamBId: number | null;
};

/**
 * Ordre de classement : endurance décroissante, puis — à égalité — l'ordre du
 * classement précédent, comme l'impose le règlement.
 *
 * Attention, ce n'est **pas** équivalent à départager par le seed initial : deux
 * équipes qui se croisent en cours de route conservent leur ordre relatif du
 * moment, pas celui du départ.
 */
export function compareEndurance(a: EnduranceStanding, b: EnduranceStanding): number {
  if (b.points !== a.points) return b.points - a.points;
  return a.previousRank - b.previousRank;
}

/** Équipes encore en lice, de la meilleure à la moins bonne. */
export function rankActiveTeams(standings: EnduranceStanding[]): EnduranceStanding[] {
  return standings.filter((s) => s.status === "ACTIVE").sort(compareEndurance);
}

/**
 * Appariement d'une manche : couples adjacents du classement courant. Sur un
 * effectif impair, la dernière équipe ne joue pas — elle ne perd ni ne gagne
 * de point (la règle ne prévoit aucune victoire d'office).
 */
export function planEnduranceRound(standings: EnduranceStanding[]): EndurancePairing[] {
  const ordered = rankActiveTeams(standings);
  const pairings: EndurancePairing[] = [];

  for (let index = 0; index + 1 < ordered.length; index += 2) {
    pairings.push({ teamAId: ordered[index].teamId, teamBId: ordered[index + 1].teamId });
  }

  if (ordered.length % 2 === 1) {
    pairings.push({ teamAId: ordered.at(-1)!.teamId, teamBId: null });
  }

  return pairings;
}

/**
 * Classe les équipes : les actives d'abord (endurance puis ordre précédent),
 * ensuite les sorties, de la dernière éliminée à la première — une équipe qui a
 * tenu plus longtemps finit devant.
 */
export function assignRanks(standings: EnduranceStanding[]): EnduranceStanding[] {
  const active = standings.filter((s) => s.status === "ACTIVE").sort(compareEndurance);

  const out = standings
    .filter((s) => s.status !== "ACTIVE")
    .sort((a, b) => {
      const roundA = a.eliminatedRound ?? 0;
      const roundB = b.eliminatedRound ?? 0;
      if (roundB !== roundA) return roundB - roundA;
      if (b.points !== a.points) return b.points - a.points;
      return a.previousRank - b.previousRank;
    });

  return [...active, ...out].map((standing, index) => ({ ...standing, rank: index + 1 }));
}
