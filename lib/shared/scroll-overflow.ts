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

/** Le sous-ensemble de l'élément que la surveillance lit. */
export interface ObservedScrollElement extends ScrollMetrics {
  readonly children: ArrayLike<object>;
}

interface ResizeObserverLike {
  observe(target: object): void;
  disconnect(): void;
}

interface MutationObserverLike {
  observe(target: object, options: { childList: boolean }): void;
  disconnect(): void;
}

/** Les constructeurs du navigateur, passés pour rester testable hors DOM. */
export interface ScrollOverflowEnvironment {
  ResizeObserver?: new (callback: () => void) => ResizeObserverLike;
  MutationObserver?: new (callback: () => void) => MutationObserverLike;
}

/**
 * Suit le débordement d'une zone et appelle `onChange` à chaque mesure.
 *
 * Trois choses font changer la réponse, et chacune a son observateur :
 * - la **zone** change de taille (fenêtre redimensionnée, panneau replié) ;
 * - un **enfant** change de taille (le flux SSE ajoute une ronde, une ligne) —
 *   la zone, elle, garde souvent la sienne ;
 * - un enfant **apparaît ou disparaît** : il faut alors l'observer à son tour.
 *
 * Sans `ResizeObserver` (navigateur ancien), rien n'est mesuré et la zone
 * garde le défaut prudent — focalisable. Renvoie la fonction de nettoyage.
 */
export function watchScrollOverflow(
  element: ObservedScrollElement,
  onChange: (overflowing: boolean) => void,
  environment: ScrollOverflowEnvironment,
): () => void {
  const { ResizeObserver: Resize, MutationObserver: Mutation } = environment;
  if (!Resize) return () => {};

  const measure = () => onChange(hasScrollableOverflow(element));

  const resize = new Resize(measure);
  const observeAll = () => {
    resize.disconnect();
    resize.observe(element);
    for (const child of Array.from(element.children)) resize.observe(child);
  };
  observeAll();

  const mutation = Mutation
    ? new Mutation(() => {
        observeAll();
        measure();
      })
    : null;
  mutation?.observe(element, { childList: true });

  measure();

  return () => {
    resize.disconnect();
    mutation?.disconnect();
  };
}
