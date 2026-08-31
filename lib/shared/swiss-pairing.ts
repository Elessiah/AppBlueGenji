/**
 * Appariement du mode « Ronde suisse ».
 *
 * Deux règles gouvernent le tirage :
 *  1. **rondes proches** — on affronte une équipe ayant un score identique ou le
 *     plus proche possible du sien (les invaincues entre elles, etc.) ;
 *  2. **pas de rematch** — deux équipes ne se rencontrent normalement jamais
 *     deux fois.
 *
 * Ces deux règles se contredisent régulièrement : dans un groupe de score où
 * tout le monde s'est déjà rencontré, respecter (2) impose de piocher dans le
 * groupe voisin. Un tirage glouton (« je prends le premier adversaire libre »)
 * échoue alors sur les dernières équipes, qui se retrouvent à rejouer un match
 * déjà disputé alors qu'une autre combinaison était possible. L'appariement est
 * donc résolu par **retour sur trace** : on explore les combinaisons dans
 * l'ordre de préférence et on retient la première qui apparie tout le monde sans
 * rematch. Faute de solution, on relâche la contrainte (un rematch vaut mieux
 * qu'une ronde impossible à jouer).
 *
 * Module pur : aucune dépendance base de données.
 */

export type Participant = {
  teamId: number;
  points: number;
  opponentIds: number[];
  hasReceivedBye: boolean;
  /** Seed initial (1 = meilleure équipe). Sert d'ordre stable à la ronde 1. */
  seed?: number;
};

export type Pairing = {
  teamAId: number;
  teamBId: number | null;
};

export type SwissRoundPlan = {
  pairings: Pairing[];
  /** Équipe recevant une victoire d'office (effectif impair), sinon null. */
  byeTeamId: number | null;
};

/**
 * Budget d'exploration du retour sur trace. Au-delà, on rend la meilleure
 * solution partielle : sur un très grand tournoi entièrement « bloqué », une
 * recherche exhaustive coûterait un temps déraisonnable pour un gain nul.
 */
const MAX_SEARCH_STEPS = 20000;

/** Ordre de classement : points décroissants, puis seed, puis identifiant. */
export function compareParticipants(a: Participant, b: Participant): number {
  if (b.points !== a.points) return b.points - a.points;
  const seedA = a.seed ?? Number.MAX_SAFE_INTEGER;
  const seedB = b.seed ?? Number.MAX_SAFE_INTEGER;
  if (seedA !== seedB) return seedA - seedB;
  return a.teamId - b.teamId;
}

/**
 * Ronde 1 : le classement n'existe pas encore, on part du seeding. Moitié haute
 * contre moitié basse (1 vs N/2+1, 2 vs N/2+2, …), l'appariement classique qui
 * évite de faire s'éliminer les têtes de série entre elles d'entrée.
 */
export function planFirstRound(participants: Participant[]): SwissRoundPlan {
  if (participants.length === 0) return { pairings: [], byeTeamId: null };

  const sorted = [...participants].sort(compareParticipants);

  // Effectif impair : la dernière du seeding reçoit la victoire d'office.
  let byeTeamId: number | null = null;
  if (sorted.length % 2 === 1) {
    byeTeamId = sorted[sorted.length - 1].teamId;
    sorted.pop();
  }

  const half = sorted.length / 2;
  const pairings: Pairing[] = [];
  for (let i = 0; i < half; i++) {
    pairings.push({ teamAId: sorted[i].teamId, teamBId: sorted[half + i].teamId });
  }

  return { pairings, byeTeamId };
}

/**
 * Rondes suivantes : classement par points, puis appariement par retour sur
 * trace en évitant les rematchs.
 *
 * Effectif impair : la victoire d'office va à l'équipe **la plus basse du
 * classement n'en ayant pas encore reçu** — un bye vaut des points sans jouer,
 * on ne l'accorde donc pas deux fois tant que c'est évitable, et on l'attribue
 * là où il fausse le moins le haut de tableau.
 */
export function planNextRound(participants: Participant[]): SwissRoundPlan {
  if (participants.length === 0) return { pairings: [], byeTeamId: null };

  const sorted = [...participants].sort(compareParticipants);

  let byeTeamId: number | null = null;
  if (sorted.length % 2 === 1) {
    let byeIndex = sorted.length - 1;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (!sorted[i].hasReceivedBye) {
        byeIndex = i;
        break;
      }
    }
    byeTeamId = sorted[byeIndex].teamId;
    sorted.splice(byeIndex, 1);
  }

  const pairings = solvePairings(sorted, true) ?? solvePairings(sorted, false) ?? [];
  return { pairings, byeTeamId };
}

/**
 * Apparie récursivement la liste déjà classée. `avoidRematches` à `false`
 * correspond au repli : plus aucune contrainte, l'appariement est alors toujours
 * possible (paires adjacentes).
 *
 * Renvoie `null` si aucune combinaison complète n'existe dans le budget imparti.
 */
function solvePairings(sorted: Participant[], avoidRematches: boolean): Pairing[] | null {
  const used = new Array<boolean>(sorted.length).fill(false);
  const result: Pairing[] = [];
  let steps = 0;

  const recurse = (): boolean => {
    if (steps++ > MAX_SEARCH_STEPS) return false;

    const first = used.findIndex((taken) => !taken);
    if (first === -1) return true;

    used[first] = true;
    const a = sorted[first];

    for (let j = first + 1; j < sorted.length; j++) {
      if (used[j]) continue;
      const b = sorted[j];
      if (avoidRematches && a.opponentIds.includes(b.teamId)) continue;

      used[j] = true;
      result.push({ teamAId: a.teamId, teamBId: b.teamId });

      if (recurse()) return true;

      result.pop();
      used[j] = false;
    }

    used[first] = false;
    return false;
  };

  return recurse() ? result : null;
}

/**
 * Compare deux plans sans tenir compte de l'ordre (ni des paires, ni des équipes
 * au sein d'une paire). Sert à décider si une ronde non entamée doit être
 * réappariée après une correction de score.
 */
export function samePlan(a: SwissRoundPlan, b: SwissRoundPlan): boolean {
  if (a.byeTeamId !== b.byeTeamId) return false;
  if (a.pairings.length !== b.pairings.length) return false;
  const key = (p: Pairing): string =>
    [p.teamAId, p.teamBId ?? -1].sort((x, y) => x - y).join("-");
  const left = a.pairings.map(key).sort();
  const right = b.pairings.map(key).sort();
  return left.every((value, index) => value === right[index]);
}
