/**
 * Focus rendu après un geste dont le bouton **disparaît** au retour (fiche
 * d'équipe : « Rejoindre » devient « Retirer ma demande », une invitation
 * retirée quitte la liste, l'envoi d'un logo efface sa rangée) — logique pure
 * de `useFocusRescue` (`lib/shared/hooks/useFocusRescue.ts`).
 *
 * Sans elle, le navigateur rendait le focus au `<body>` : au clavier, il
 * fallait repartir du haut de la page, et un lecteur d'écran perdait sa place.
 */

/** Délai pendant lequel un geste peut encore rendre le focus (relecture lente comprise). */
export const FOCUS_RESCUE_WINDOW_MS = 4_000;

export interface FocusRescueTarget {
  focus(): void;
}

export interface FocusRescueRoot {
  querySelector(selector: string): FocusRescueTarget | null;
}

/** Une demande de secours : avant quelle heure, et vers quoi (par ordre de préférence). */
export interface FocusRescue {
  until: number;
  selectors: readonly string[];
}

/** Le secours est-il encore dû ? Seulement si le focus est **perdu** (jamais repris ailleurs) et à temps. */
export function rescueDue(rescue: FocusRescue | null, now: number, focusLost: boolean): boolean {
  return rescue !== null && now <= rescue.until && focusLost;
}

/** Le secours a-t-il expiré (à oublier, même sans focus perdu) ? */
export function rescueExpired(rescue: FocusRescue | null, now: number): boolean {
  return rescue !== null && now > rescue.until;
}

/** Première cible trouvée dans `root`, dans l'ordre des sélecteurs ; `null` si aucune. */
export function pickRescueTarget(root: FocusRescueRoot | null, selectors: readonly string[]): FocusRescueTarget | null {
  if (root === null) return null;
  for (const selector of selectors) {
    const target = root.querySelector(selector);
    if (target !== null) return target;
  }
  return null;
}
