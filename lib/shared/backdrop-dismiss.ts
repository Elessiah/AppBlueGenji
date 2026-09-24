/**
 * Fermeture d'une modale par un clic sur son voile.
 *
 * Un `click` part vers l'**ancêtre commun** de l'appui et du relâchement : une
 * sélection de texte commencée dans un champ de la modale et relâchée sur le
 * voile produit donc un clic… sur le voile, qui refermait la modale et jetait
 * la saisie — et un appui sur le voile relâché dans le panneau aussi. La cible
 * du clic ne dit donc rien : le clic ne vaut fermeture que si l'appui **et** le
 * relâchement ont eu lieu sur le voile lui-même, jamais sur l'un de ses
 * descendants.
 */
export function isBackdropDismiss(
  pressTarget: EventTarget | null,
  releaseTarget: EventTarget | null,
  backdrop: EventTarget | null,
): boolean {
  return backdrop !== null && pressTarget === backdrop && releaseTarget === backdrop;
}

/** Mémoire du geste en cours : cibles de l'appui et du relâchement. */
export interface BackdropGesture {
  press: EventTarget | null;
  release: EventTarget | null;
}

/** Ce que les gestionnaires lisent d'un évènement — un évènement React suffit. */
interface TargetedEvent {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}

/**
 * Gestionnaires du voile, sans React : `useBackdropDismiss` ne fait que leur
 * fournir une mémoire qui survit aux rendus. Séparés pour être testés tels
 * qu'un navigateur les appelle — appui, relâchement, puis clic.
 *
 * `onDismiss` et `disabled` sont relus à chaque clic par l'appelant, qui
 * reconstruit les gestionnaires à chaque rendu.
 */
export function backdropHandlers(gesture: BackdropGesture, onDismiss: () => void, disabled: boolean) {
  return {
    onPointerDown: (event: TargetedEvent) => {
      gesture.press = event.target;
      gesture.release = null;
    },
    onPointerUp: (event: TargetedEvent) => {
      gesture.release = event.target;
    },
    onClick: (event: TargetedEvent) => {
      const dismiss = isBackdropDismiss(gesture.press, gesture.release, event.currentTarget);
      gesture.press = null;
      gesture.release = null;
      if (dismiss && !disabled) onDismiss();
    },
  };
}
