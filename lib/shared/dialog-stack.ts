/**
 * Cible du verrou de défilement : lecture et écriture d'une valeur de style.
 * Abstraite pour que la pile reste une logique pure, testable hors navigateur —
 * en production elle pointe sur `document.body.style.overflow`.
 */
export interface ScrollLockTarget {
  get(): string;
  set(value: string): void;
}

/** Jeton identifiant une couche ouverte. Un jeton par ouverture de modale. */
export type DialogToken = symbol;

export interface DialogStack {
  /** Ouvre une couche. La première pose le verrou de défilement. */
  push(token: DialogToken): void;
  /** Ferme une couche. La dernière lève le verrou. */
  pop(token: DialogToken): void;
  /** La couche est-elle celle du dessus ? (arbitrage d'`Échap`) */
  isTop(token: DialogToken): boolean;
  /** Nombre de couches ouvertes. */
  readonly size: number;
}

/**
 * Pile des boîtes de dialogue ouvertes. Elle résout deux problèmes que chaque
 * modale ne peut pas régler seule :
 *
 * 1. **Verrou de défilement.** Si chaque couche mémorise puis restaure la valeur
 *    qu'elle a trouvée, le résultat dépend de l'ordre de démontage — et React
 *    nettoie dans l'ordre de l'arbre, pas dans l'ordre d'ouverture. Deux modales
 *    fermées par le même `Échap` pouvaient ainsi laisser `overflow: hidden` en
 *    place, page définitivement bloquée. Ici la valeur d'origine n'est retenue
 *    qu'à l'entrée de la **première** couche et restaurée qu'à la sortie de la
 *    **dernière**, quel que soit l'ordre des fermetures.
 *
 * 2. **Arbitrage du clavier.** Les écouteurs `Échap` sont posés sur `window` ;
 *    `stopPropagation()` n'y coupe pas les voisins attachés au même nœud. Sans
 *    `isTop`, une seule touche fermait toutes les modales ouvertes.
 *
 * Fonction pure vis-à-vis du DOM : tout passe par `target`.
 */
export function createDialogStack(target: ScrollLockTarget): DialogStack {
  const stack: DialogToken[] = [];
  // Valeur trouvée avant la première couche, à remettre après la dernière.
  let restore: string | null = null;

  return {
    push(token) {
      // Un effet rejoué avec le même jeton ne doit pas fausser la profondeur.
      if (stack.includes(token)) return;
      if (stack.length === 0) {
        restore = target.get();
        target.set("hidden");
      }
      stack.push(token);
    },

    pop(token) {
      const index = stack.lastIndexOf(token);
      // Jeton inconnu (double fermeture) : rien à défaire.
      if (index === -1) return;
      stack.splice(index, 1);
      if (stack.length === 0 && restore !== null) {
        target.set(restore);
        restore = null;
      }
    },

    isTop(token) {
      return stack.length > 0 && stack[stack.length - 1] === token;
    },

    get size() {
      return stack.length;
    },
  };
}
