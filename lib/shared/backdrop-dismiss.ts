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
