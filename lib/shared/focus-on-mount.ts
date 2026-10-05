/**
 * Ref de rappel qui donne le focus à un champ **au moment où il apparaît**.
 *
 * Remplace `autoFocus` sur un éditeur en ligne qui ne s'affiche qu'au clic
 * (« Modifier ») : le focus suit alors un geste de l'utilisateur, jamais le
 * chargement d'une page — ce que `autoFocus` ne garantit pas, et que Sonar
 * (S9379) signale. Dans une modale, utiliser plutôt `data-autofocus`, lu par
 * `useDialogBehavior` (docs/features/MODAL_DIALOGS.md).
 *
 * Fonction de module, donc d'identité stable : React ne l'appelle qu'au
 * montage (avec l'élément) et au démontage (avec `null`), jamais à chaque
 * rendu — une flèche recréée à chaque rendu reprendrait le focus à chaque
 * frappe ailleurs.
 */
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus();
}
