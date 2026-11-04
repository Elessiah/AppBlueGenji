/**
 * Porte d'affichage de `/tournois` : la page montre son squelette tant que les
 * lectures qui décident de sa mise en page n'ont pas toutes répondu.
 *
 * - la **liste publique** ;
 * - **« Mes tournois »** — sa section naissait sinon au sommet, une fois la
 *   liste affichée, et poussait tout le reste vers le bas ;
 * - la **première lecture des invisibles** (staff seulement) — même raison.
 *
 * Chaque lecture compte pour réglée à son premier résultat, échec compris : un
 * incident sur un complément ne doit pas garder la liste sous le squelette. Les
 * trois drapeaux ne dépendent pas de l'ordre d'arrivée des réponses.
 */
export type ListGateState = {
  /** La première liste publique est arrivée. */
  listFetched: boolean;
  /** « Mes tournois » a répondu (ou son délai maximal est passé). */
  mineSettled: boolean;
  /** Les invisibles ont répondu — vrai d'office pour qui n'est pas staff. */
  hiddenSettled: boolean;
};

export function isListGateOpen({ listFetched, mineSettled, hiddenSettled }: Readonly<ListGateState>): boolean {
  return listFetched && mineSettled && hiddenSettled;
}
