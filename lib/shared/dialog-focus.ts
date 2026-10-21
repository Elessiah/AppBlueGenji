/**
 * Décisions clavier des boîtes de dialogue modales (`useDialogBehavior`),
 * extraites de l'écouteur pour se tester sans DOM : elles ne lisent que ce
 * qu'on leur passe.
 */

/** Ce que `Échap` consulte d'une couche exemptée (`data-dialog-exempt`). */
export interface EscapeLayer {
  querySelector(selector: string): unknown;
}

/** Ce que `Échap` consulte de l'élément qui a reçu la touche. */
export interface EscapeTarget {
  getAttribute?(name: string): string | null;
}

/**
 * `Échap` doit-il être laissé à quelqu'un d'autre que la modale ?
 *
 * - un panneau d'une couche exemptée est ouvert (son propre écouteur le
 *   referme — la question porte sur le panneau, pas sur la cible : Safari ne
 *   focalise pas un bouton cliqué) ;
 * - la cible est un `combobox` dont la liste est ouverte (il la referme).
 *   Le rôle est exigé, et pas seulement `aria-expanded` : un bouton de
 *   dépliage porte lui aussi `aria-expanded="true"` sans écouter Échap.
 */
export function escapeBelongsElsewhere(
  layers: readonly EscapeLayer[],
  target: EscapeTarget | null | undefined,
): boolean {
  if (layers.some((layer) => layer.querySelector('[aria-expanded="true"]'))) return true;
  return target?.getAttribute?.("role") === "combobox" && target.getAttribute("aria-expanded") === "true";
}

/** État du piège à focus au moment d'un `Tab`. */
export interface FocusTrapState<T> {
  /** Focalisables de la modale, dans l'ordre du DOM (au moins un). */
  items: readonly T[];
  /** Focalisables des couches exemptées, parcourus après la modale. */
  extra: readonly T[];
  /** Élément qui a le focus. */
  active: unknown;
  inModal: boolean;
  inLayer: boolean;
  /**
   * Le focus est dans la modale mais **avant** son premier focalisable : un
   * titre `tabIndex={-1}` qui a pris le focus d'ouverture. `Maj+Tab` n'y a
   * rien avant lui dans la modale et partirait dans la page derrière.
   */
  beforeStart?: boolean;
  shiftKey: boolean;
}

/**
 * Élément où envoyer le focus pour boucler sur la modale puis ses couches
 * exemptées, ou `null` quand l'ordre natif suffit (on n'est pas sur un bord).
 */
export function focusTrapTarget<T>({
  items,
  extra,
  active,
  inModal,
  inLayer,
  beforeStart = false,
  shiftKey,
}: FocusTrapState<T>): T | null {
  const start = items[0];
  const end = items.at(-1)!;
  if (inLayer) return layerEdgeTarget(extra, active, shiftKey, start, end);
  if (!inModal) return shiftKey ? end : start;
  if (shiftKey && (active === start || beforeStart)) return extra.at(-1) ?? end;
  if (!shiftKey && active === end) return extra[0] ?? start;
  return null;
}

/** Bords d'une couche exemptée : retour à la modale, sinon ordre natif. */
function layerEdgeTarget<T>(extra: readonly T[], active: unknown, shiftKey: boolean, start: T, end: T): T | null {
  if (!shiftKey && active === extra.at(-1)) return start;
  if (shiftKey && active === extra[0]) return end;
  return null;
}

/**
 * Modales ouvertes d'office et décidées, mais pas encore dans le DOM (morceau
 * chargé à la demande) : elles comptent déjà, sans quoi une autre ouverture
 * d'office s'y glisserait pendant le chargement.
 */
let pendingAutoOpenModals = 0;

/** Réserve la place d'une modale ouverte d'office ; renvoie sa libération (idempotente). */
export function claimAutoOpenModal(): () => void {
  pendingAutoOpenModals += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingAutoOpenModals -= 1;
  };
}

/** Une modale (`aria-modal`, ou réservée) est déjà ouverte : une ouverture d'office attend. */
export function anotherModalOpen(root: ParentNode = document): boolean {
  return pendingAutoOpenModals > 0 || root.querySelector('[aria-modal="true"]') !== null;
}

/**
 * Prévient (une fois) quand plus aucune modale n'est ouverte, sans minuterie :
 * un observateur du DOM, actif le temps de l'attente. Renvoie l'arrêt.
 */
export function watchModalsClosed(onClosed: () => void, root: Node = document.body): () => void {
  const observer = new MutationObserver(() => {
    if (anotherModalOpen()) return;
    observer.disconnect();
    onClosed();
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
  return () => observer.disconnect();
}
