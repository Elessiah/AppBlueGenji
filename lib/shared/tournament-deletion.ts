/**
 * Garde-fou de la suppression définitive d'un tournoi.
 *
 * Effacer un tournoi détruit aussi ses matchs, ses inscriptions et ses
 * classements : un `window.confirm` — le motif employé partout ailleurs dans le
 * projet — se clique par réflexe. La confirmation exige donc de retaper le nom
 * du tournoi, à la manière d'un dépôt supprimé sur une forge.
 *
 * Module pur : l'interface s'en sert pour armer le bouton, les tests pour
 * fixer la règle de comparaison.
 */

/**
 * Normalise une saisie avant comparaison : bords rognés et suites d'espaces
 * réduites à une seule. Un nom de tournoi peut être recopié depuis le titre de
 * la page, où le rendu HTML replie déjà les espaces — refuser la saisie pour
 * cette seule raison serait incompréhensible.
 *
 * La casse et les accents, eux, sont conservés : c'est tout l'intérêt d'une
 * confirmation par recopie.
 */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Vrai lorsque `input` reproduit `tournamentName`. Un nom vide ne confirme
 * jamais rien — sans quoi un champ laissé vide armerait la suppression d'un
 * tournoi dont le nom serait, lui aussi, vide.
 */
export function isDeletionConfirmed(tournamentName: string, input: string): boolean {
  const expected = normalize(tournamentName);
  if (expected.length === 0) return false;
  return normalize(input) === expected;
}
