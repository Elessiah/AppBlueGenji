/**
 * BlueGenji Survie — tirage de l'arbre final : tableau imposé des quarts
 * (8v4, 6v2, 1v5, 3v7), repli haut contre bas pour un autre effectif, tour
 * suivant et petite finale (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Module pur : aucune dépendance base de données.
 */

import type { EnduranceConfig } from "./config";
import type { EndurancePairing } from "./standings";

/**
 * Tableau des quarts de finale, en rangs de qualification (1 = meilleure).
 *
 * Volontairement différent d'un seeding classique : le règlement impose
 * 8v4, 6v2, 1v5 puis 3v7, dans cet ordre d'affichage. L'équipe du haut prend le
 * side gauche, celle du bas le side droite.
 */
export const PLAYOFF_QUARTER_PAIRINGS: readonly (readonly [number, number])[] = [
  [8, 4],
  [6, 2],
  [1, 5],
  [3, 7],
];

/**
 * Convertit les rangs de qualification en identifiants d'équipes pour les
 * quarts de finale. `qualified` est ordonné du 1ᵉʳ au dernier qualifié.
 *
 * @throws INVALID_PLAYOFF_FIELD si l'effectif n'est pas celui attendu.
 */
export function buildPlayoffPairings(qualified: number[]): EndurancePairing[] {
  if (qualified.length !== PLAYOFF_QUARTER_PAIRINGS.length * 2) {
    throw new Error("INVALID_PLAYOFF_FIELD");
  }

  return PLAYOFF_QUARTER_PAIRINGS.map(([topRank, bottomRank]) => ({
    teamAId: qualified[topRank - 1],
    teamBId: qualified[bottomRank - 1],
  }));
}

/**
 * Une rencontre de l'arbre final, telle qu'elle doit être posée.
 *
 * Le `bracket` distingue la petite finale (`THIRD_PLACE`) des rencontres
 * décisives (`UPPER`) — seules ces dernières qualifient pour le tour suivant.
 */
export type PlayoffMatchPlan = {
  bracket: "UPPER" | "THIRD_PLACE";
  pairing: EndurancePairing;
};

/** Un tour d'arbre final, dans l'ordre d'affichage (décisives puis petite finale). */
export type PlayoffRoundPlan = PlayoffMatchPlan[];

/**
 * Appariement de repli haut contre bas, pour un plateau autre que huit
 * (tournoi sous-rempli), faute de tableau imposé pour cet effectif.
 */
export function planPlayoffFallbackRound(qualified: number[]): EndurancePairing[] {
  const pairings: EndurancePairing[] = [];
  let left = 0;
  let right = qualified.length - 1;

  while (left < right) {
    pairings.push({ teamAId: qualified[left], teamBId: qualified[right] });
    left += 1;
    right -= 1;
  }

  // Effectif impair : la mieux classée restante passe le tour.
  if (left === right) pairings.push({ teamAId: qualified[left], teamBId: null });

  return pairings;
}

/**
 * Premier tour de l'arbre final : le tableau imposé à l'effectif prévu, un
 * appariement haut contre bas en dessous.
 *
 * Cette fonction est la **seule** description du tirage : la création de
 * l'arbre et sa relecture après une correction de score en descendent toutes
 * les deux, faute de quoi une réparation pourrait poser un autre tableau que
 * celui qu'un lancement aurait produit.
 */
export function planPlayoffFirstRound(
  qualified: number[],
  config: EnduranceConfig,
): PlayoffRoundPlan {
  const pairings =
    qualified.length === config.playoffSize && config.playoffSize === PLAYOFF_QUARTER_PAIRINGS.length * 2
      ? buildPlayoffPairings(qualified)
      : planPlayoffFallbackRound(qualified);

  return pairings.map((pairing) => ({ bracket: "UPPER" as const, pairing }));
}

/**
 * Tour suivant de l'arbre final, dérivé des rencontres **décisives** du tour
 * courant — la petite finale n'en fait pas partie, elle ne qualifie personne.
 *
 * Les vainqueurs s'apparient deux à deux dans l'ordre du tour ; un nombre impair
 * (plateau qui n'est pas une puissance de deux) fait passer le dernier. Aux
 * demi-finales — deux rencontres décisives — la petite finale se joue en
 * parallèle de la finale.
 *
 * Un tour incomplet ne planifie rien : un vainqueur manquant vaudrait une
 * rencontre sans engagée, et il vaut mieux ne rien poser que poser un match
 * vide qui ne se refermerait jamais.
 *
 * **Double forfait** (`lib/shared/double-forfeit.ts`) : la rencontre est jouée
 * mais ne qualifie personne. Son créneau reste **vacant**, et l'appariement
 * garde sa position — le vainqueur du i-ᵉ match joue toujours le (i/2)-ᵉ du tour
 * suivant, règle dont l'arbre dessiné dépend (`endurancePlayoffLinks`) :
 *
 * - un seul créneau vacant dans une paire → l'autre passe le tour
 *   (exemption, posée comme le repli d'un effectif impair) ;
 * - deux créneaux vacants → aucune rencontre, et la cascade continue : la
 *   paire suivante décale d'autant. Le cas est rare (deux doubles forfaits
 *   voisins), et poser un match sans engagée ne se refermerait jamais.
 *
 * La petite finale ne réunit que des demi-finalistes **battues** : une
 * demi-finale close sur un double forfait n'en fournit aucune. S'il n'en reste
 * qu'une, elle prend la 3ᵉ place par exemption ; s'il n'en reste aucune, il n'y
 * a pas de petite finale.
 */
export function planNextPlayoffRound(
  decisive: {
    winnerTeamId: number | null;
    loserTeamId: number | null;
    doubleForfeit?: boolean;
  }[],
): PlayoffRoundPlan {
  if (decisive.length < 2) return [];
  // Un vainqueur manquant hors double forfait = tour pas encore joué.
  if (decisive.some((match) => match.winnerTeamId === null && !match.doubleForfeit)) return [];

  const winners = decisive.map((match) => (match.doubleForfeit ? null : match.winnerTeamId));

  const plan: PlayoffRoundPlan = [];
  for (let index = 0; index < winners.length; index += 2) {
    const pair = [winners[index], index + 1 < winners.length ? winners[index + 1] : null].filter(
      (teamId): teamId is number => teamId !== null,
    );
    if (pair.length === 0) continue;
    plan.push({
      bracket: "UPPER",
      pairing: { teamAId: pair[0], teamBId: pair[1] ?? null },
    });
  }

  if (decisive.length === 2) {
    const losers = decisive
      .filter((match) => !match.doubleForfeit)
      .map((match) => match.loserTeamId)
      .filter((teamId): teamId is number => teamId !== null);
    // Une seule battue ne reçoit la 3ᵉ place par exemption que si l'autre
    // créneau a été vidé par un double forfait. Une demi-finale gagnée par
    // exemption (effectif impair) n'a pas de battue, et ne donnait déjà pas de
    // petite finale : ce comportement-là ne change pas.
    const vacatedByDoubleForfeit = decisive.some((match) => match.doubleForfeit);
    if (losers.length === 2 || (losers.length === 1 && vacatedByDoubleForfeit)) {
      plan.push({
        bracket: "THIRD_PLACE",
        pairing: { teamAId: losers[0], teamBId: losers[1] ?? null },
      });
    }
  }

  return plan;
}
