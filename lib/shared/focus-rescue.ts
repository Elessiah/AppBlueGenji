/**
 * Focus rendu après un geste dont le bouton **disparaît** au retour (fiche
 * d'équipe : « Rejoindre » devient « Retirer ma demande », une invitation
 * retirée quitte la liste, l'envoi d'un logo efface sa rangée ; barre de
 * modération d'un profil) — logique pure de `useFocusRescue`
 * (`lib/shared/hooks/useFocusRescue.ts`).
 *
 * Sans elle, le navigateur rendait le focus au `<body>` : au clavier, il
 * fallait repartir du haut de la page, et un lecteur d'écran perdait sa place.
 */

/** Délai pendant lequel un geste peut encore rendre le focus (relecture lente comprise). */
export const FOCUS_RESCUE_WINDOW_MS = 4_000;

export interface FocusRescueTarget {
  focus(): void;
}

export interface FocusRescueRoot<T extends FocusRescueTarget = FocusRescueTarget> {
  querySelector(selector: string): T | null;
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
export function pickRescueTarget<T extends FocusRescueTarget = FocusRescueTarget>(
  root: FocusRescueRoot<T> | null,
  selectors: readonly string[],
): T | null {
  if (root === null) return null;
  for (const selector of selectors) {
    const target = root.querySelector(selector);
    if (target !== null) return target;
  }
  return null;
}

/** Les boutons d'un geste encore actifs : un bouton refusé (`aria-disabled`) n'est pas un point de chute. */
export function armedRescueSelector(kind: string): string {
  return `[data-focus-rescue="${kind}"]:not([aria-disabled="true"])`;
}

/**
 * Le **voisin** de la ligne retirée d'une liste, avant le reste : la ligne
 * suivante, sinon la précédente, sinon le premier bouton actif du même genre
 * (`data-focus-rescue`), sinon le premier du genre. Chaque ligne porte
 * `data-focus-rescue-key` ; `keys` est l'ordre affiché **avant** le retrait.
 */
export function neighbourRescueSelectors(kind: string, keys: readonly (string | number)[], removed: string | number): string[] {
  const at = keys.findIndex((key) => String(key) === String(removed));
  const keyed = (key: string | number) => `[data-focus-rescue="${kind}"][data-focus-rescue-key="${String(key)}"]`;
  const neighbours = at === -1 ? [] : [keys[at + 1], keys[at - 1]].filter((key) => key !== undefined);
  return [...neighbours.map(keyed), armedRescueSelector(kind), `[data-focus-rescue="${kind}"]`];
}
