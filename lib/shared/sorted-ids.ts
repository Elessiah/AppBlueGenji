/**
 * Recherche dichotomique d'un identifiant dans une liste **triée par ordre
 * croissant** (la liste des comptes sans fiche, `profileless-players.ts`).
 * Une liste non triée rendrait des réponses fausses : l'appelant la trie.
 */
export function sortedIdsInclude(ids: readonly number[], id: number): boolean {
  let low = 0;
  let high = ids.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const current = ids[middle];
    if (current === id) return true;
    if (current < id) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}
