/**
 * Raccourci clavier des champs de recherche (`/tournois`, `/equipes`,
 * `/joueurs`) : une seule règle pour le libellé affiché et pour la touche
 * reconnue. `/equipes` et `/joueurs` affichaient « ⌘K » en dur sans écouter
 * la moindre touche — un raccourci annoncé qui ne faisait rien, et faux hors
 * clavier Apple.
 */

/**
 * Libellé du raccourci selon la plateforme : « ⌘K » n'existe que sur un
 * clavier Apple, `Ctrl+K` fonctionne partout ailleurs (Windows, Linux). Prend
 * une chaîne de plateforme (`navigator.platform` ou, à défaut,
 * `navigator.userAgent`) plutôt que de lire `navigator`, pour rester testable
 * sans DOM.
 */
export function searchShortcutLabel(platform: string): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl+K";
}

/** Libellé avant montage (rendu serveur) : la plateforme ne se lit qu'au client. */
export const DEFAULT_SEARCH_SHORTCUT_LABEL = "Ctrl+K";

/** Valeur d'`aria-keyshortcuts` : les deux combinaisons sont reconnues partout. */
export const SEARCH_ARIA_KEYSHORTCUTS = "Control+K Meta+K";

type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** Vrai pour ⌘K / Ctrl+K (sans Alt ni Maj), quelle que soit la casse de la lettre. */
export function isSearchShortcut(event: ShortcutKeyEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  );
}
