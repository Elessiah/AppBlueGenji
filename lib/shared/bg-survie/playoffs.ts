/**
 * BlueGenji Survie — tirage de l'arbre final : tableau imposé des quarts
 * (8v4, 6v2, 1v5, 3v7), repli haut contre bas pour un autre effectif, tour
 * suivant et petite finale (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Module pur : aucune dépendance base de données.
 */

import type { EnduranceConfig } from "./config";
import type { EndurancePairing } from "./standings";
import { isMatchDoubleForfeit, type MatchOutcomeShape } from "../match-outcome";

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

/** Rencontre décisive telle que la projection la lit (sous-ensemble de `BracketMatch`). */
export type ProjectablePlayoffMatch = {
  roundNumber: number;
  matchNumber: number;
  status: MatchOutcomeShape["status"];
  winnerTeamId: number | null;
  team1Id: number | null;
  team2Id: number | null;
  team1Name: string | null;
  team2Name: string | null;
  /**
   * Battue enregistrée — c'est elle que le moteur lit pour la petite finale.
   * Absente (`undefined`) : déduite des deux engagées.
   */
  loserTeamId?: number | null;
  doubleForfeit?: boolean;
};

/** Créneau d'un tour pas encore posé. */
export type ProjectableGhostSlot = { id: number; roundNumber: number; matchNumber: number };

/** Engagé déjà qualifié pour un créneau du tour suivant. */
export type ProjectedEntrant = { teamId: number; name: string | null };

/**
 * Côté d'un créneau dont on sait qu'il restera **sans engagée** : l'adversaire
 * passe le tour (effectif impair, ou créneau vidé par un double forfait).
 */
export const PROJECTED_BYE = "BYE";

/** Un côté d'un créneau à venir ; `null` = pas encore connu (TBD). */
export type ProjectedSide = ProjectedEntrant | typeof PROJECTED_BYE | null;

/** Les deux côtés d'un créneau à venir, haut puis bas. */
export type ProjectedGhostEntrants = [ProjectedSide, ProjectedSide];

/** Ce qu'une rencontre apporte au tour suivant : rien encore, personne, ou une engagée. */
type FeedState = "OPEN" | "VACANT" | ProjectedEntrant;

/**
 * Place, dans le tour suivant, de la rencontre que chaque match d'un tour
 * alimente (0 = première) — `null` pour une paire dont les **deux** créneaux
 * ont été vidés par un double forfait : le moteur n'y pose rien
 * (`planNextPlayoffRound`, `pair.length === 0`) et les paires suivantes
 * remontent d'autant. Le dernier d'un effectif impair forme une paire à lui seul.
 *
 * **Seule** description de cette règle pour l'affichage : les noms projetés,
 * les traits de l'arbre et le compte des cases à pourvoir en descendent tous,
 * faute de quoi un nom pourrait s'afficher dans une case que son trait n'atteint pas.
 *
 * @param feeding les rencontres décisives d'un tour, dans l'ordre des numéros.
 */
export function playoffNextRoundPositions(
  feeding: readonly Pick<MatchOutcomeShape, "status" | "doubleForfeit">[],
): (number | null)[] {
  const vacated = (index: number) => index >= feeding.length || isMatchDoubleForfeit(feeding[index]);
  const positions: (number | null)[] = [];
  let next = 0;
  for (let index = 0; index < feeding.length; index += 2) {
    const position = vacated(index) && vacated(index + 1) ? null : next;
    if (position !== null) next += 1;
    positions.push(position);
    if (index + 1 < feeding.length) positions.push(position);
  }
  return positions;
}

/** Nom d'une engagée de la rencontre ; `null` si elle n'y figure pas (repli « Engagé #id »). */
function entrantOf(match: ProjectablePlayoffMatch, teamId: number): ProjectedEntrant {
  if (teamId === match.team1Id) return { teamId, name: match.team1Name };
  if (teamId === match.team2Id) return { teamId, name: match.team2Name };
  return { teamId, name: null };
}

function winnerState(match: ProjectablePlayoffMatch | undefined): FeedState {
  // Pas de rencontre du tout : le dernier d'un effectif impair n'a pas de voisine.
  if (match === undefined || isMatchDoubleForfeit(match)) return "VACANT";
  if (match.status !== "COMPLETED" || match.winnerTeamId === null) return "OPEN";
  return entrantOf(match, match.winnerTeamId);
}

/**
 * Les deux côtés d'un créneau, d'après ce que ses deux rencontres amont
 * apportent — la règle de `planNextPlayoffRound` : les engagées connues se
 * **tassent vers le haut**, un créneau vacant vaut une exemption pour l'autre.
 * `null` quand rien n'est encore connu.
 */
function pairSides(first: FeedState, second: FeedState): ProjectedGhostEntrants | null {
  if (first === "VACANT" || second === "VACANT") {
    const other = first === "VACANT" ? second : first;
    return [other === "OPEN" || other === "VACANT" ? null : other, PROJECTED_BYE];
  }
  if (first === "OPEN" && second === "OPEN") return null;
  return [first === "OPEN" ? null : first, second === "OPEN" ? null : second];
}

/**
 * Affichage seul : le vainqueur d'une rencontre **déjà close** d'un tour est
 * montré dans son créneau du tour suivant, avant même que le moteur ne pose ce
 * tour (il attend que le tour entier soit joué, `finalizePlayoffsIfDone`).
 *
 * Même tirage que `planNextPlayoffRound`, rejoué sur un tour **incomplet** :
 * les rencontres vont par paires dans l'ordre des numéros, la première en haut,
 * la seconde en bas. Un match pas encore clos laisse son côté vide (TBD). Un
 * **double forfait** ne qualifie personne : sa voisine passe en haut et le bas
 * devient une exemption ({@link PROJECTED_BYE}) ; il en va de même du dernier
 * vainqueur d'un effectif impair. Une paire vidée par **deux** doubles forfaits
 * ne donne aucune rencontre, et les paires suivantes remontent d'un créneau —
 * comme dans le moteur. Seul le tour immédiatement suivant est alimenté.
 *
 * @returns créneau à venir (`id`) → ses deux côtés ; les créneaux dont rien
 *   n'est encore connu sont absents.
 */
export function projectPlayoffGhostEntrants(
  decisive: readonly ProjectablePlayoffMatch[],
  ghostSlots: readonly ProjectableGhostSlot[],
): Map<number, ProjectedGhostEntrants> {
  const projected = new Map<number, ProjectedGhostEntrants>();
  if (decisive.length === 0 || ghostSlots.length === 0) return projected;

  const lastRound = Math.max(...decisive.map((match) => match.roundNumber));
  const feeding = decisive
    .filter((match) => match.roundNumber === lastRound)
    .sort((a, b) => a.matchNumber - b.matchNumber);
  const nextRound = ghostSlots
    .filter((slot) => slot.roundNumber === lastRound + 1)
    .sort((a, b) => a.matchNumber - b.matchNumber);

  const positions = playoffNextRoundPositions(feeding);
  for (let index = 0; index < feeding.length; index += 2) {
    // Paire entièrement vacante : le moteur ne pose rien, la suite remonte.
    const position = positions[index];
    if (position === null) continue;
    const target = nextRound[position];
    const sides = pairSides(winnerState(feeding[index]), winnerState(feeding[index + 1]));
    if (target && sides) projected.set(target.id, sides);
  }

  return projected;
}

/**
 * Affichage seul : les deux côtés de la **petite finale** avant que le moteur ne
 * la pose (il attend les deux demi-finales), d'après ce que les demi-finales
 * ont déjà donné — la battue de la première en haut, celle de la seconde en bas.
 *
 * Mêmes cas que `planNextPlayoffRound` (`THIRD_PLACE`) :
 *
 * - une demi-finale close sur un **double forfait** ne fournit aucune battue :
 *   l'autre battue prend la 3ᵉ place par exemption (en haut, bas
 *   {@link PROJECTED_BYE}) ; deux doubles forfaits → pas de petite finale ;
 * - une demi-finale **sans adversaire** (exemption d'un effectif impair) n'a pas
 *   de battue non plus, et il n'y a alors jamais de petite finale ;
 * - une demi-finale close **sans battue enregistrée** (`loserTeamId` à `null`)
 *   n'en fournit pas davantage au moteur : pas de petite finale.
 *
 * @param semis les rencontres décisives du tour à deux matchs.
 * @returns `null` quand aucune petite finale ne se jouera ; sinon ses deux
 *   côtés, `[null, null]` tant qu'aucune demi-finale n'est close.
 */
export function projectThirdPlaceEntrants(
  semis: readonly ProjectablePlayoffMatch[],
): ProjectedGhostEntrants | null {
  if (semis.length !== 2) return null;
  if (semis.some((match) => match.team1Id === null || match.team2Id === null)) return null;

  const closedWithoutLoser = (match: ProjectablePlayoffMatch) =>
    match.status === "COMPLETED" && !isMatchDoubleForfeit(match) && match.winnerTeamId !== null && match.loserTeamId === null;
  if (semis.some(closedWithoutLoser)) return null;

  const [first, second] = [...semis]
    .sort((a, b) => a.matchNumber - b.matchNumber)
    .map((match): FeedState => {
      if (isMatchDoubleForfeit(match)) return "VACANT";
      if (match.status !== "COMPLETED" || match.winnerTeamId === null) return "OPEN";
      if (match.loserTeamId != null) return entrantOf(match, match.loserTeamId);
      // Un vainqueur étranger à la rencontre (ligne en cours de réécriture) ne
      // désigne aucune battue : mieux vaut TBD qu'un nom faux.
      if (match.winnerTeamId === match.team1Id && match.team2Id !== null) return entrantOf(match, match.team2Id);
      if (match.winnerTeamId === match.team2Id && match.team1Id !== null) return entrantOf(match, match.team1Id);
      return "OPEN";
    });

  if (first === "VACANT" && second === "VACANT") return null;
  return pairSides(first, second) ?? [null, null];
}
