/**
 * Une zone défilante ne devient un arrêt de tabulation — et un repère nommé —
 * que lorsqu'elle a **réellement** quelque chose à faire défiler.
 *
 * `ScrollArea` posait `tabIndex={0}` et `role="region"` sans condition : sur un
 * grand écran où le contenu tient, c'était un arrêt clavier qui ne fait rien
 * (WCAG 2.4.3) et un repère de plus autour d'un contenu souvent déjà nommé —
 * le classement de la ronde suisse s'annonçait deux fois, « Classement du
 * tournoi — défilement horizontal » puis « Classement du tournoi ».
 *
 * Module pur : la décision et la surveillance ne dépendent que de ce qu'on leur
 * passe, si bien qu'elles se testent sans navigateur.
 */

/** Les quatre dimensions dont dépend la décision, lues sur l'élément. */
export interface ScrollMetrics {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Écart toléré avant de parler de débordement. `scrollWidth` et `clientWidth`
 * sont arrondis chacun de leur côté : un contenu de 300,4 px dans une boîte de
 * 300 px peut rendre 301 contre 300 sans qu'il y ait rien à faire défiler.
 */
export const SCROLL_OVERFLOW_TOLERANCE_PX = 1;

/**
 * La zone déborde-t-elle ? Les **deux** axes sont lus quelle que soit
 * l'orientation déclarée : `overflow-y: visible` à côté d'un `overflow-x: auto`
 * est calculé `auto` par le navigateur, si bien qu'une zone « horizontale »
 * peut aussi défiler verticalement — et il faut alors pouvoir l'atteindre.
 */
export function hasScrollableOverflow(metrics: ScrollMetrics): boolean {
  return (
    metrics.scrollWidth - metrics.clientWidth > SCROLL_OVERFLOW_TOLERANCE_PX ||
    metrics.scrollHeight - metrics.clientHeight > SCROLL_OVERFLOW_TOLERANCE_PX
  );
}

/** Attributs d'accessibilité posés sur la zone. */
export interface ScrollAreaAccessibility {
  tabIndex?: 0;
  role?: "region";
  "aria-label"?: string;
}

/**
 * Les attributs que porte la zone.
 *
 * - **`overflowing`** vaut `true` tant qu'on n'a rien mesuré — au rendu serveur
 *   et jusqu'à l'hydratation. C'est le sens prudent : un arrêt de trop est une
 *   gêne, une zone qui déborde sans pouvoir être atteinte au clavier est un
 *   **blocage** (WCAG 2.1.1).
 * - **`focused`** garde la zone focalisable tant qu'elle a le focus : retirer le
 *   `tabindex` d'un élément focalisé renvoie le focus en tête de document — une
 *   fenêtre agrandie pendant la lecture ne doit pas faire perdre sa place.
 * - Le **nom** part avec le rôle : `aria-label` est interdit sur un élément
 *   générique (ARIA 1.2), et un nom qu'aucun lecteur d'écran n'annonce n'est
 *   qu'un piège pour qui le chercherait.
 */
export function scrollAreaAccessibility(state: {
  overflowing: boolean;
  focused: boolean;
  ariaLabel?: string;
}): ScrollAreaAccessibility {
  if (!state.overflowing && !state.focused) return {};
  if (!state.ariaLabel) return { tabIndex: 0 };
  return { tabIndex: 0, role: "region", "aria-label": state.ariaLabel };
}

/**
 * Le focus reçu ou perdu concerne-t-il la zone elle-même ? `onFocus` et
 * `onBlur` de React bouillonnent : le focus d'un bouton contenu remonte
 * jusqu'à la zone, et ne dit rien d'elle.
 */
export function isOwnFocusEvent(event: { target: unknown; currentTarget: unknown }): boolean {
  return event.target === event.currentTarget;
}

/**
 * La zone a-t-elle réellement perdu le focus ? Quitter la fenêtre émet aussi
 * `blur`, mais la zone reste alors l'élément actif et le retrouvera au retour :
 * elle doit rester focalisable.
 */
export function releasesFocus(event: {
  target: unknown;
  currentTarget: unknown;
  activeElement: unknown;
}): boolean {
  return isOwnFocusEvent(event) && event.activeElement !== event.currentTarget;
}

/** Le sous-ensemble de l'élément que la surveillance lit. */
export interface ObservedScrollElement extends ScrollMetrics {
  readonly children: ArrayLike<object>;
}

interface ResizeObserverLike {
  observe(target: object): void;
  unobserve(target: object): void;
  disconnect(): void;
}

/** Le sous-ensemble d'un `MutationRecord` que la surveillance lit. */
export interface MutationRecordLike {
  type: string;
  target: unknown;
  addedNodes: ArrayLike<unknown>;
  removedNodes: ArrayLike<unknown>;
}

interface MutationObserverLike {
  observe(target: object, options: MutationObserverInit): void;
  disconnect(): void;
}

interface FontFaceSetLike {
  addEventListener(type: "loadingdone", listener: () => void): void;
  removeEventListener(type: "loadingdone", listener: () => void): void;
}

/** Ce que la surveillance lit du navigateur, passé pour rester testable hors DOM. */
export interface ScrollOverflowEnvironment {
  ResizeObserver?: new (callback: () => void) => ResizeObserverLike;
  MutationObserver?: new (callback: (records: MutationRecordLike[]) => void) => MutationObserverLike;
  /** `<html>`, qui porte les réglages d'accessibilité (`data-a11y`). */
  root?: object;
  /** `document.fonts` : une police chargée tard élargit le texte. */
  fonts?: FontFaceSetLike;
  /** L'élément actif du document, relu à chaque mesure. */
  activeElement?: () => unknown;
}

/** Une mesure : la zone déborde-t-elle, et est-elle l'élément actif ? */
export interface ScrollOverflowMeasure {
  overflowing: boolean;
  active: boolean;
}

/**
 * Nœud élément ? Un `MutationRecord` liste aussi les nœuds texte, qu'un
 * `ResizeObserver` refuse d'observer.
 */
function isElementNode(node: unknown): node is object {
  return typeof node === "object" && node !== null && (node as { nodeType?: number }).nodeType === 1;
}

/**
 * Suit le débordement d'une zone et appelle `onChange` à chaque mesure.
 *
 * Tout ce qui peut changer la réponse a son observateur :
 * - la **zone** change de taille (fenêtre redimensionnée, panneau replié) ;
 * - un **enfant direct** change de taille (le flux SSE ajoute une ronde) — la
 *   zone, elle, garde souvent la sienne ; un enfant ajouté est observé à son
 *   tour, un enfant retiré cesse de l'être ;
 * - le **contenu** change sans qu'aucune boîte observée ne bouge : les pistes
 *   d'une grille débordent de la grille, dont la largeur reste celle de la zone
 *   (`MutationObserver` sur tout le sous-arbre) ;
 * - le **texte** s'élargit sans aucune écriture dans la zone : réglage
 *   d'accessibilité posé sur `<html data-a11y>` (police, espacement), police
 *   web chargée après la première mesure.
 *
 * Chaque mesure dit aussi si la zone est l'**élément actif** : un `focus()`
 * appelé dans un onglet en arrière-plan n'émet aucun évènement, et la zone ne
 * doit pas perdre son `tabindex` sous le focus.
 *
 * Sans `ResizeObserver` (navigateur ancien), rien n'est mesuré et la zone
 * garde le défaut prudent — focalisable. Renvoie la fonction de nettoyage.
 */
export function watchScrollOverflow(
  element: ObservedScrollElement,
  onChange: (measure: ScrollOverflowMeasure) => void,
  environment: ScrollOverflowEnvironment,
): () => void {
  const { ResizeObserver: Resize, MutationObserver: Mutation, root, fonts, activeElement } = environment;
  if (!Resize) return () => {};

  const measure = () =>
    onChange({ overflowing: hasScrollableOverflow(element), active: activeElement?.() === element });

  const resize = new Resize(measure);
  resize.observe(element);
  for (const child of Array.from(element.children)) resize.observe(child);

  const content = Mutation
    ? new Mutation((records) => {
        for (const record of records) {
          if (record.type !== "childList" || record.target !== element) continue;
          for (const node of Array.from(record.removedNodes)) if (isElementNode(node)) resize.unobserve(node);
          for (const node of Array.from(record.addedNodes)) if (isElementNode(node)) resize.observe(node);
        }
        measure();
      })
    : null;
  content?.observe(element, { childList: true, subtree: true, characterData: true, attributes: true });

  const settings = Mutation && root ? new Mutation(measure) : null;
  if (settings && root) settings.observe(root, { attributes: true, attributeFilter: ["data-a11y"] });

  fonts?.addEventListener("loadingdone", measure);

  measure();

  return () => {
    resize.disconnect();
    content?.disconnect();
    settings?.disconnect();
    fonts?.removeEventListener("loadingdone", measure);
  };
}
