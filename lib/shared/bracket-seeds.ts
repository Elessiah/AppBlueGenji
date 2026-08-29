/**
 * Placement des têtes de série dans un plateau à élimination — logique pure,
 * partagée client/serveur.
 *
 * Ces deux fonctions décrivaient déjà la génération des brackets côté serveur
 * (`lib/server/tournaments/bracket-single.ts` et `bracket-double.ts`) ; elles
 * vivent ici pour que l'**aperçu du plateau** (`tournament-preview.ts`), qui
 * doit tourner aussi bien dans le navigateur que sur le serveur, produise
 * exactement le même appariement que le moteur. Toute divergence rendrait
 * l'aperçu mensonger.
 *
 * `lib/server/serialization.ts` les réexporte : les appelants historiques n'ont
 * pas à changer d'import.
 */

/** Plus petite puissance de deux supérieure ou égale à `n` (taille du plateau). */
export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

/**
 * Ordre des seeds le long du plateau, de haut en bas.
 *
 * Construction classique par miroir : `[1, 2]` devient `[1, 4, 2, 3]`, puis
 * `[1, 8, 4, 5, 2, 7, 3, 6]`… La tête de série 1 rencontre la dernière, et deux
 * favorites ne peuvent se croiser qu'au plus tard possible.
 */
export function generateSeedOrder(size: number): number[] {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];
  const previous = generateSeedOrder(size / 2);
  const result: number[] = [];
  for (const seed of previous) {
    result.push(seed);
    result.push(size + 1 - seed);
  }
  return result;
}

/**
 * Répartit des engagés (déjà dans l'ordre de seeding) sur les `bracketSize`
 * emplacements du premier tour. Les emplacements sans engagé restent `null` :
 * ce sont les exemptions (byes) que le moteur résout d'office.
 */
export function seedSlots<T>(entrants: readonly T[], bracketSize: number): (T | null)[] {
  const seedOrder = generateSeedOrder(bracketSize);
  const slots = new Array<T | null>(bracketSize).fill(null);

  seedOrder.forEach((seed, position) => {
    const entrant = entrants[seed - 1];
    if (entrant !== undefined) slots[position] = entrant;
  });

  return slots;
}
