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
 * Sélecteur d'une modale ouverte : `aria-modal`, ou la place tenue par une
 * modale décidée dont le morceau se charge encore (`data-modal-pending`, posé
 * par le `loading` de son `dynamic()`) — sans quoi une autre ouverture d'office
 * s'y glisserait pendant le chargement. Tenue par le DOM, la place se libère
 * d'elle-même au démontage.
 */
export const OPEN_MODAL_SELECTOR = '[aria-modal="true"], [data-modal-pending]';

/**
 * Marque d'une modale **qui cède sa place** : une invitation sans urgence
 * (`CertificationPromptDialog`). Posée sur la modale ou l'un de ses
 * descendants ; une ouverture urgente (lancement de match) passe par-dessus,
 * et l'invitation se ferme d'elle-même.
 */
export const YIELDING_MODAL_ATTR = "data-modal-yields";

/** Ce que la recherche d'une modale lit du DOM. */
type ModalRoot = Pick<ParentNode, "querySelectorAll">;

/**
 * Une modale est déjà ouverte (ou en chargement) : une ouverture d'office
 * attend. `overYielding` : ne compter que les modales qui ne cèdent pas leur
 * place — la question d'une ouverture urgente.
 */
export function anotherModalOpen(root: ModalRoot = document, { overYielding = false } = {}): boolean {
  const open = Array.from(root.querySelectorAll(OPEN_MODAL_SELECTOR));
  if (!overYielding) return open.length > 0;
  return open.some((el) => !el.hasAttribute(YIELDING_MODAL_ATTR) && el.querySelector(`[${YIELDING_MODAL_ATTR}]`) === null);
}

/** Délai minimal entre deux relectures d'un guet : un plateau en direct mute sans cesse. */
const WATCH_THROTTLE_MS = 250;

/**
 * Prévient (une fois) dès que `condition` est vraie — tout de suite si elle
 * l'est déjà —, sans minuterie de fond : un observateur du DOM, actif le temps
 * du guet seulement, ses relectures espacées d'au moins `WATCH_THROTTLE_MS`.
 * Renvoie l'arrêt.
 */
export function watchModals(condition: () => boolean, onMet: () => void, root: Node = document.body): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
  const check = () => {
    timer = null;
    if (stopped || !condition()) return;
    stop();
    onMet();
  };
  const observer = new MutationObserver(() => {
    timer ??= setTimeout(check, WATCH_THROTTLE_MS);
  });
  if (condition()) {
    onMet();
    return () => undefined;
  }
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-modal", "data-modal-pending"],
  });
  return stop;
}

/** Prévient (une fois) quand plus aucune modale n'est ouverte (`watchModals`). */
export function watchModalsClosed(onClosed: () => void, root?: Node, options: { overYielding?: boolean } = {}): () => void {
  return watchModals(() => !anotherModalOpen(document, options), onClosed, root);
}

/**
 * Une modale **recouverte** se ferme : les modales qui comptaient rendre le
 * focus à un élément en son sein (bientôt retiré du DOM) le rendront à sa
 * propre cible. `inside` dit si un élément appartient à la modale fermée.
 */
export function handOffRestoreTargets<T>(
  targets: Map<symbol, T | null>,
  inside: (element: T) => boolean,
  target: T | null,
): void {
  for (const [token, element] of targets) {
    if (element !== null && inside(element)) targets.set(token, target);
  }
}
