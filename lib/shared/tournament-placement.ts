/**
 * **Points de parcours** : ce qu'un tournoi rapporte pour le rang qu'on y a
 * atteint, indépendamment des rencontres qui y ont mené.
 *
 * ## Ce que le transfert match par match ne pouvait pas dire
 *
 * La cote du site (`lib/shared/ranking.ts`) ne connaît que des rencontres, et
 * chacune ne paie qu'à hauteur de sa **surprise** : une équipe forte qui gagne
 * un tournoi en battant quatre équipes plus faibles qu'elle empoche quelques
 * points à peine, là où une équipe faible sortie au deuxième tour sur une
 * seule victoire improbable en encaisse trois fois plus. Le classement se
 * retrouvait alors à dire qu'aller au bout coûte moins qu'être éliminé tôt —
 * ce qui est cohérent avec l'espérance, et faux pour qui lit un classement
 * d'esport.
 *
 * Un tournoi n'est pourtant pas la somme de ses matchs : il désigne un
 * **classement final**, et ce classement est précisément l'information qu'aucun
 * transfert pris isolément ne porte.
 *
 * ## La cagnotte
 *
 * Chaque tournoi terminé met en jeu une **cagnotte** que toutes ses engagées
 * alimentent **à parts égales** et que le classement final **redistribue** :
 * chacune mise `cagnotte / effectif` et reçoit `cagnotte × part(rang)`. Le gain
 * net d'une équipe est la différence.
 *
 * Trois propriétés en découlent, et ce sont elles qu'il faut retenir :
 *
 * 1. **Somme nulle.** Ce que les mieux classées gagnent, les autres le perdent,
 *    au point près — l'arrondi compris ({@link placementDeltas} le corrige à la
 *    plus forte décimale). Le classement du site reste donc une hiérarchie et ne
 *    devient pas un compteur d'assiduité : entrer dans un tournoi et y finir
 *    dernière **coûte**, exactement comme perdre un match.
 * 2. **Le rang paie, pas l'exploit.** La part ne dépend **que** du rang final,
 *    jamais de la cote de l'équipe qui l'atteint. C'est la différence
 *    revendiquée avec le transfert de match : gagner un tournoi qu'on était
 *    censé gagner rapporte autant que le gagner en surprise. L'espérance a déjà
 *    son mot à dire, match par match ; ici, seul le parcours compte.
 * 3. **La difficulté fixe l'enjeu.** La cagnotte grandit avec la **cote moyenne
 *    du plateau** ({@link placementDifficulty}) : un tournoi couru par le haut
 *    du classement vaut le double d'un tournoi de fond de tableau, à effectif
 *    égal.
 *
 * Module **pur**, sans le moindre lien avec le classement du site : il reçoit
 * des cotes et une cote de référence, il rend des écarts. C'est
 * `lib/shared/ranking.ts` qui l'appelle pendant son rejeu, et lui seul.
 *
 * Voir `docs/features/TOURNAMENT_PLACEMENT_POINTS.md`.
 */

/**
 * Amplitude de référence d'un tournoi : ce que pèse la cagnotte d'un plateau
 * d'une seule engagée, avant d'être multipliée par la racine de l'effectif.
 *
 * Le nombre n'a pas de sens pris seul — c'est le gain de la championne qui en a
 * un. Avec cette valeur, gagner un tournoi de difficulté moyenne rapporte
 * environ 29 points à 4 engagées, 60 à 16, 100 à 64 : plus qu'un match gagné
 * (au plus 32 points, l'amplitude d'une rencontre), jamais assez pour qu'une seule
 * soirée réécrive le haut du classement.
 */
export const PLACEMENT_AMPLITUDE = 64;

/**
 * Bornes du multiplicateur de difficulté.
 *
 * Un plateau ne peut donc ni valoir moins de la moitié ni plus du double d'un
 * plateau moyen. Le plancher protège d'un tournoi de remplissage qui ne
 * vaudrait plus rien ; le plafond, du cas inverse — la cote moyenne n'a pas de
 * maximum, et sans borne un tournoi entre les huit meilleures équipes finirait
 * par peser plus que tout le reste de la saison.
 */
export const PLACEMENT_MIN_DIFFICULTY = 0.5;
export const PLACEMENT_MAX_DIFFICULTY = 2;

/**
 * En deçà, il n'y a rien à redistribuer : une seule engagée classée ne peut ni
 * gagner sur les autres ni leur payer quoi que ce soit. C'est le cas du tournoi
 * clos faute d'adversaires, qui déclare pourtant son unique inscrite première.
 */
export const MIN_PLACEMENT_ENTRANTS = 2;

/** Un engagé au classement final d'un tournoi, avec sa cote du moment. */
export type PlacementEntrant = {
  teamId: number;
  /**
   * Rang final tel que le moteur l'a écrit. Seul l'**ordre** compte : des rangs
   * non contigus se lisent exactement comme 1, 2, 3…, et deux rangs égaux sont
   * traités comme un ex æquo.
   */
  rank: number;
  /** Cote de l'équipe **à l'instant de la clôture**, telle que le rejeu la voit. */
  rating: number;
};

/**
 * Poids d'une place au classement final, avant normalisation : l'inverse de la
 * place.
 *
 * La courbe est délibérément **raide** — la deuxième vaut la moitié de la
 * première, la quatrième le quart — parce que c'est ce qu'un classement
 * d'esport dit : la finale n'est pas un tour de plus, c'est le tournoi. Une
 * courbe plate rendrait la mesure indolore et ne corrigerait rien.
 *
 * Conséquence chiffrée : le seuil de rentabilité tombe autour de
 * `effectif / H(effectif)` — le tiers supérieur d'un petit plateau, le sixième
 * d'un grand. Au-delà, on paie sa place.
 */
export function placementPositionWeight(position: number): number {
  return 1 / position;
}

/**
 * Parts du classement final, **dans l'ordre des engagés reçus**, de somme 1.
 *
 * Les ex æquo se partagent les places qu'ils occupent **ensemble** : deux
 * équipes à égalité de rang 3 se partagent les poids des 3ᵉ et 4ᵉ places, et la
 * suivante prend la 5ᵉ. C'est la seule façon de garder la somme à 1 quel que
 * soit le classement reçu — donc la somme nulle des attributions, dont tout le
 * reste dépend.
 */
export function placementShares(ranks: number[]): number[] {
  const count = ranks.length;
  if (count === 0) return [];

  let total = 0;
  for (let position = 1; position <= count; position += 1) {
    total += placementPositionWeight(position);
  }

  return ranks.map((rank) => {
    let ahead = 0;
    let tied = 0;
    for (const other of ranks) {
      if (other < rank) ahead += 1;
      else if (other === rank) tied += 1;
    }

    // Le groupe d'ex æquo occupe les places `ahead + 1` … `ahead + tied` : on
    // en fait la moyenne, si bien que la somme du groupe vaut exactement la
    // somme des places qu'il occupe.
    let group = 0;
    for (let position = ahead + 1; position <= ahead + tied; position += 1) {
      group += placementPositionWeight(position);
    }

    return group / tied / total;
  });
}

/**
 * Multiplicateur de difficulté d'un plateau : sa cote moyenne rapportée à la
 * cote de départ du site, borné.
 *
 * La **moyenne**, et non la meilleure cote présente : ce qui rend un tournoi
 * difficile, c'est d'avoir à battre tout le monde, pas d'avoir une grosse
 * équipe quelque part dans le tableau. Une équipe encore sans match vaut la cote
 * de départ, donc un plateau de nouvelles est un plateau moyen — ni bonus ni
 * malus pour un tournoi d'inconnues.
 */
export function placementDifficulty(ratings: number[], baseRating: number): number {
  if (ratings.length === 0 || baseRating <= 0) return 1;

  const mean = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  return Math.min(PLACEMENT_MAX_DIFFICULTY, Math.max(PLACEMENT_MIN_DIFFICULTY, mean / baseRating));
}

/**
 * Cagnotte d'un tournoi : ce que son classement final redistribue en tout.
 *
 * Elle croît en **racine** de l'effectif, et non proportionnellement : un
 * plateau quatre fois plus grand vaut deux fois plus. Une croissance linéaire
 * ferait d'un tournoi à 128 équipes un évènement qui, à lui seul, réécrirait
 * tout le classement — alors qu'il est d'abord un tournoi de plus.
 */
export function placementPot(entrantCount: number, difficulty: number): number {
  if (entrantCount < MIN_PLACEMENT_ENTRANTS) return 0;
  return PLACEMENT_AMPLITUDE * Math.sqrt(entrantCount) * difficulty;
}

/**
 * **Le** calcul : ce que le classement final d'un tournoi ajoute ou retire à
 * chaque engagée, en points entiers dont la somme est **exactement** nulle.
 *
 * L'arrondi est fait à la plus forte décimale (méthode du plus fort reste) et
 * non équipe par équipe : arrondir chacun de son côté laisserait dériver le
 * total du site d'un tournoi à l'autre, ce que le module refuse au même titre
 * que `ratingTransfer` refuse deux arrondis pour une même rencontre. Les ex
 * æquo de décimale sont départagés par l'identifiant d'équipe : deux calculs du
 * même tournoi rendent le même tableau.
 *
 * Rend une carte vide sous {@link MIN_PLACEMENT_ENTRANTS} engagés.
 */
export function placementDeltas(
  entrants: PlacementEntrant[],
  baseRating: number,
): Map<number, number> {
  const deltas = new Map<number, number>();
  if (entrants.length < MIN_PLACEMENT_ENTRANTS) return deltas;

  const difficulty = placementDifficulty(
    entrants.map((entrant) => entrant.rating),
    baseRating,
  );
  const pot = placementPot(entrants.length, difficulty);
  const shares = placementShares(entrants.map((entrant) => entrant.rank));
  const stake = 1 / entrants.length;

  const exact = shares.map((share) => pot * (share - stake));
  const floored = exact.map((value) => Math.floor(value));

  // La somme exacte est nulle par construction : ce qui reste après troncature
  // est donc le nombre de points d'arrondi à rendre, jamais un solde.
  let remaining = Math.round(-floored.reduce((sum, value) => sum + value, 0));

  const order = exact
    .map((value, index) => ({ index, fraction: value - floored[index] }))
    .sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return entrants[a.index].teamId - entrants[b.index].teamId;
    });

  const bonuses = new Set<number>();
  for (const candidate of order) {
    if (remaining <= 0) break;
    bonuses.add(candidate.index);
    remaining -= 1;
  }

  entrants.forEach((entrant, index) => {
    deltas.set(entrant.teamId, floored[index] + (bonuses.has(index) ? 1 : 0));
  });

  return deltas;
}
