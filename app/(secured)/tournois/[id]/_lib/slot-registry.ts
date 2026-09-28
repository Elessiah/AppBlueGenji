/**
 * Registre des créneaux mesurés d'un arbre (`_hooks/useSlotHeight.ts`).
 *
 * Il tient trois choses que le hook ne peut pas laisser au rendu :
 *
 * · une `ref` **stable** par créneau. Une fonction neuve à chaque rendu faisait
 *   détacher puis rattacher chaque carte par React — donc `unobserve` puis
 *   `observe` pour toutes, et le `ResizeObserver` rappelait aussitôt la mesure
 *   complète : deux relevés de tout l'arbre par instantané du flux ;
 * · les éléments posés, par match, avec leur round ;
 * · un drapeau « un créneau a été posé ou retiré », seul cas où la mesure est
 *   à refaire avant la peinture — un changement de taille, lui, est l'affaire
 *   de l'observateur.
 *
 * Sans DOM ni React : l'observateur est lu au moment de chaque geste (il naît
 * dans un effet, après les premières `ref`), et l'élément est générique.
 */

export interface SlotObserver<E> {
  observe(element: E): void;
  unobserve(element: E): void;
}

export interface SlotRegistry<E> {
  /** Éléments posés, par identifiant de match. */
  readonly nodes: ReadonlyMap<number, { roundNumber: number; element: E }>;
  /** `ref` du créneau : la même tant que le match reste dans le même round. */
  refFor(roundNumber: number, matchId: number): (element: E | null) => void;
  /** Un créneau a-t-il été posé ou retiré depuis le dernier appel ? */
  takeDirty(): boolean;
}

export function createSlotRegistry<E>(getObserver: () => SlotObserver<E> | null): SlotRegistry<E> {
  const nodes = new Map<number, { roundNumber: number; element: E }>();
  const refs = new Map<number, { roundNumber: number; ref: (element: E | null) => void }>();
  // Rien n'est encore mesuré : le premier passage doit relever.
  let dirty = true;

  function refFor(roundNumber: number, matchId: number): (element: E | null) => void {
    const cached = refs.get(matchId);
    if (cached && cached.roundNumber === roundNumber) return cached.ref;

    let attached: E | null = null;
    const ref = (element: E | null) => {
      if (attached !== null) {
        getObserver()?.unobserve(attached);
        // Une `ref` plus récente a pu enregistrer ce créneau entre-temps
        // (changement de round) : on ne défait que ce qu'on a posé.
        if (nodes.get(matchId)?.element === attached) nodes.delete(matchId);
      }
      attached = element;
      if (element !== null) {
        nodes.set(matchId, { roundNumber, element });
        // Pas encore d'observateur au tout premier rendu : le hook rattrape
        // les créneaux déjà posés en le créant.
        getObserver()?.observe(element);
      } else if (refs.get(matchId)?.ref === ref) {
        refs.delete(matchId);
      }
      dirty = true;
    };
    refs.set(matchId, { roundNumber, ref });
    return ref;
  }

  function takeDirty(): boolean {
    const was = dirty;
    dirty = false;
    return was;
  }

  return { nodes, refFor, takeDirty };
}
