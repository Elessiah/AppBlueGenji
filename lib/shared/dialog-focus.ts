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
  closest?(selector: string): unknown;
}

/**
 * `Échap` doit-il être laissé à quelqu'un d'autre que la modale ?
 *
 * - un panneau d'une couche exemptée est ouvert (son propre écouteur le
 *   referme — la question porte sur le panneau, pas sur la cible : Safari ne
 *   focalise pas un bouton cliqué) ;
 * - la cible est dans un élément ouvert qui referme lui-même sur Échap
 *   (`data-escape-owner`, posé par `InfoHint` déplié) ;
 * - un tel élément est ouvert **n'importe où dans la modale** (`container`) :
 *   un « i » resté déplié alors que le focus est parti sur un champ voisin
 *   (Tab) se replie sur Échap — sa propre écoute, posée sur `document` — sans
 *   que la modale se ferme et vide son formulaire ;
 * - la cible est un `combobox` dont la liste est ouverte (il la referme).
 *   Le rôle est exigé, et pas seulement `aria-expanded` : un bouton de
 *   dépliage porte lui aussi `aria-expanded="true"` sans écouter Échap.
 */
export function escapeBelongsElsewhere(
  layers: readonly EscapeLayer[],
  target: EscapeTarget | null | undefined,
  container?: EscapeLayer | null,
): boolean {
  if (layers.some((layer) => layer.querySelector('[aria-expanded="true"]'))) return true;
  if (target?.closest?.("[data-escape-owner]")) return true;
  if (container?.querySelector("[data-escape-owner]")) return true;
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
  /**
   * Le focus est sur le **conteneur** de la modale (`tabIndex={-1}` : focus
   * d'ouverture, ou clic sur son texte) — hors des focalisables, c'est un bord :
   * sans quoi `Maj+Tab` partirait dans la page derrière le voile.
   */
  onContainer?: boolean;
  inLayer: boolean;
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
  onContainer = false,
  inLayer,
  shiftKey,
}: FocusTrapState<T>): T | null {
  const start = items[0];
  const end = items.at(-1)!;
  if (inLayer) return layerEdgeTarget(extra, active, shiftKey, start, end);
  if (!inModal) return shiftKey ? end : start;
  if (onContainer) return shiftKey ? (extra.at(-1) ?? end) : start;
  if (shiftKey && active === start) return extra.at(-1) ?? end;
  if (!shiftKey && active === end) return extra[0] ?? start;
  return null;
}

/** Bords d'une couche exemptée : on revient à la modale, sinon ordre natif. */
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
const MODAL_OR_PENDING_SELECTOR = '[aria-modal="true"], [data-modal-pending]';

/**
 * Marque d'une modale **qui cède sa place** : une invitation sans urgence
 * (`CertificationPromptDialog`). Posée sur la racine de la modale (prop
 * `yields` de `TournamentDialogFrame`) ou sur la place tenue pendant son
 * chargement ; une ouverture urgente (lancement de match) passe par-dessus, et
 * l'invitation s'efface.
 */
export const YIELDING_MODAL_ATTR = "data-modal-yields";

/** Même recherche, sans les modales qui cèdent leur place : la question d'une ouverture urgente. */
const NON_YIELDING_MODAL_SELECTOR = `[aria-modal="true"]:not([${YIELDING_MODAL_ATTR}]), [data-modal-pending]:not([${YIELDING_MODAL_ATTR}])`;

/** Ce que la recherche d'une modale lit du DOM. */
type ModalRoot = Pick<ParentNode, "querySelector">;

/**
 * Une modale est déjà ouverte (ou en chargement) : une ouverture d'office
 * n'a pas lieu. `overYielding` : ne compter que les modales qui ne cèdent pas
 * leur place — la question d'une ouverture urgente. Une seule recherche.
 */
export function anotherModalOpen(root: ModalRoot = document, { overYielding = false } = {}): boolean {
  return root.querySelector(overYielding ? NON_YIELDING_MODAL_SELECTOR : MODAL_OR_PENDING_SELECTOR) !== null;
}

/**
 * Délai minimal entre deux relectures d'un guet : un plateau en direct mute
 * sans cesse. Une seconde, la cadence de l'ancien guet du centre de lancement.
 */
const WATCH_THROTTLE_MS = 1_000;

/** Ce que les guets observent : arrivée, départ ou marquage d'une modale. */
const MODAL_OBSERVATION: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["aria-modal", "data-modal-pending"],
};

/**
 * Prévient (une fois) dès que `condition` est vraie — tout de suite si elle
 * l'est déjà —, sans minuterie de fond : un observateur du DOM, actif le temps
 * du guet seulement, ses relectures espacées d'au moins `WATCH_THROTTLE_MS`.
 * Renvoie l'arrêt.
 */
export function watchModals(condition: () => boolean, onMet: () => void, root: Node = document.body): () => void {
  if (condition()) {
    onMet();
    return () => undefined;
  }
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
  observer.observe(root, MODAL_OBSERVATION);
  return stop;
}

/**
 * Une mutation peut-elle avoir ouvert une modale ? Un élément ajouté (la
 * modale, ou un bloc qui la contient) ou un marquage changé ; le texte, non.
 * La page n'est alors relue qu'une fois par lot.
 */
function mayOpenModal(record: Pick<MutationRecord, "type" | "addedNodes">): boolean {
  if (record.type === "attributes") return true;
  for (const node of record.addedNodes) {
    if (node.nodeType === 1) return true;
  }
  return false;
}

/**
 * Prévient (une fois), **sans délai**, quand une modale qui ne cède pas sa
 * place s'ouvre — tout de suite si c'est déjà le cas : pour qu'une modale qui
 * cède la sienne s'efface avant de se monter au-dessus d'elle. Seuls les lots
 * qui ajoutent un élément relisent la page, une fois par lot.
 * Renvoie l'arrêt.
 */
export function watchUrgentModalOpened(onOpened: () => void, root: Node & ParentNode = document.body): () => void {
  const urgentOpen = () => anotherModalOpen(root, { overYielding: true });
  if (urgentOpen()) {
    onOpened();
    return () => undefined;
  }
  const observer = new MutationObserver((records) => {
    if (!records.some(mayOpenModal) || !urgentOpen()) return;
    observer.disconnect();
    onOpened();
  });
  observer.observe(root, MODAL_OBSERVATION);
  return () => observer.disconnect();
}

/** Prévient (une fois) quand plus aucune modale n'est ouverte (`watchModals`). */
export function watchModalsClosed(
  onClosed: () => void,
  options: { overYielding?: boolean } = {},
  root: Node & ParentNode = document.body,
): () => void {
  return watchModals(() => !anotherModalOpen(root, options), onClosed, root);
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

/** Ce que la restitution du focus lit d'un élément de la page. */
export interface TrailNode<T> {
  readonly parentElement: T | null;
  readonly nextElementSibling: T | null;
  readonly previousElementSibling: T | null;
  /** Enfants d'alors : une liste rafraîchie les a peut-être remplacés. */
  readonly children: ArrayLike<T>;
}

/** Un cran de la remontée du déclencheur : son parent et ses voisins d'alors. */
export interface FocusTrailStep<T> {
  parent: T;
  next: T | null;
  previous: T | null;
  /** Rang du chaînon parmi les enfants de `parent` à l'ouverture. */
  index: number;
}

/**
 * Relevé, **à l'ouverture**, du voisinage du déclencheur : chacun de ses
 * ancêtres avec les voisins du chaînon qu'il contient et le rang de celui-ci. Une fois la ligne
 * retirée (suppression confirmée), l'élément détaché ne sait plus où il était.
 */
export function focusTrail<T extends TrailNode<T>>(target: T | null): FocusTrailStep<T>[] {
  const steps: FocusTrailStep<T>[] = [];
  let node = target;
  while (node?.parentElement) {
    const parent: T = node.parentElement;
    steps.push({
      parent,
      next: node.nextElementSibling,
      previous: node.previousElementSibling,
      index: Array.prototype.indexOf.call(parent.children, node),
    });
    node = node.parentElement;
  }
  return steps;
}

/**
 * Où rendre le focus à la fermeture d'une modale. Le déclencheur, s'il est
 * encore dans la page ; sinon — sa ligne a disparu avec la suppression
 * confirmée, le focus tomberait sur `<body>` (WCAG 2.4.3) — le premier
 * focalisable de la ligne **suivante**, sinon de la **précédente**, sinon de la
 * liste, et ainsi de suite en remontant (le bouton « Ajouter » d'une liste
 * vidée). `null` si rien ne convient.
 */
export function restoreFocusTarget<T extends TrailNode<T>>(
  target: T | null,
  trail: readonly FocusTrailStep<T>[],
  isConnected: (node: T) => boolean,
  firstFocusable: (root: T) => T | null,
): T | null {
  if (target === null || isConnected(target)) return target;
  for (const step of trail) {
    if (!isConnected(step.parent)) continue;
    // Voisins relevés à l'ouverture, puis ceux **d'aujourd'hui** au même rang :
    // une liste rafraîchie pendant que la modale était ouverte a remplacé les
    // nœuds relevés, le rang, lui, tient encore.
    const now = (at: number): T | null => (at >= 0 && at < step.parent.children.length ? step.parent.children[at] : null);
    for (const sibling of [step.next, step.previous, now(step.index), now(step.index - 1)]) {
      if (sibling === null || !isConnected(sibling)) continue;
      const found = firstFocusable(sibling);
      if (found !== null) return found;
    }
    const found = firstFocusable(step.parent);
    if (found !== null) return found;
  }
  return null;
}
