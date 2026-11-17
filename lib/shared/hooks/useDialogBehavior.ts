"use client";

import { useEffect, useRef } from "react";
import { createDialogStack, type ScrollLockTarget } from "@/lib/shared/dialog-stack";
import {
  escapeBelongsElsewhere,
  focusTrail,
  focusTrapTarget,
  handOffRestoreTargets,
  restoreFocusTarget,
  type FocusTrailStep,
} from "@/lib/shared/dialog-focus";

interface DialogBehaviorOptions {
  /** La boîte de dialogue est-elle montée / visible ? */
  open: boolean;
  /** Fermeture demandée (Échap). */
  onClose: () => void;
  /**
   * Bloque la fermeture au clavier pendant une opération en cours (envoi de
   * formulaire) : on ne veut pas qu'Échap referme une modale en train d'écrire.
   */
  locked?: boolean;
  /**
   * `"container"` : le focus d'ouverture va au conteneur lui-même (sans
   * défilement), pas au premier contrôle — le titre est annoncé et reste en
   * vue, Entrée n'y déclenche rien. Le conteneur porte `tabIndex={-1}`.
   */
  initialFocus?: "first" | "container";
}

/**
 * Verrou de défilement de la page. Les accesseurs ne touchent au DOM qu'à
 * l'appel, jamais à l'import : le module reste chargeable côté serveur.
 */
const bodyScrollLock: ScrollLockTarget = {
  get: () => document.body.style.overflow,
  set: (value) => {
    document.body.style.overflow = value;
  },
};

/**
 * Pile partagée par **toutes** les boîtes de dialogue de l'application : c'est
 * elle qui décide quand poser et lever le verrou de défilement, et laquelle des
 * couches ouvertes traite `Échap` (voir `lib/shared/dialog-stack.ts`).
 */
const dialogStack = createDialogStack(bodyScrollLock);

/**
 * Où rendre le focus à la fermeture de chaque modale ouverte. Tenu à part
 * parce qu'une modale **recouverte** qui se ferme (invitation qui cède sa
 * place au lancement d'un match) passe sa cible à celles du dessus qui
 * comptaient rendre le focus en son sein — un élément bientôt retiré.
 */
const restoreTargets = new Map<symbol, RestoreEntry | null>();

/**
 * Cible de restitution : l'élément, et son voisinage relevé à l'ouverture
 * (`focusTrail`) — pour retomber sur la ligne voisine si la sienne a été
 * supprimée entre-temps.
 */
interface RestoreEntry {
  element: HTMLElement;
  trail: FocusTrailStep<Element>[];
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Durée pendant laquelle un déclencheur rendu reste guetté : une liste
 * rechargée **après** la fermeture (`router.refresh()`) retire sa ligne un peu
 * plus tard, et le focus tomberait alors sur `<body>`.
 */
const LATE_REMOVAL_WATCH_MS = 3_000;

const isShown = (el: Element) =>
  (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

/** Un contrôle désarmé (`aria-disabled`, bouton occupé ou bord d'une flèche) ne fait rien : mauvaise cible de focus. */
const isArmed = (el: Element) => el.getAttribute("aria-disabled") !== "true";

/**
 * Premier élément focalisable et visible de `root`, `root` compris — un
 * contrôle actif de préférence (la flèche « monter » grisée d'une première
 * ligne ne mène nulle part), à défaut un désarmé plutôt que rien. Parcours
 * **paresseux** : il s'arrête au premier contrôle actif (la mise en page n'est
 * lue que pour les candidats rencontrés) et ne balaie jamais le document entier.
 */
function firstFocusableIn(root: Element): Element | null {
  if (root === document.body || root === document.documentElement) return null;
  let fallback: Element | null = null;
  const candidates = root.matches(FOCUSABLE_SELECTOR) ? [root, ...root.querySelectorAll(FOCUSABLE_SELECTOR)] : root.querySelectorAll(FOCUSABLE_SELECTOR);
  for (const el of candidates) {
    if (!isShown(el)) continue;
    if (isArmed(el)) return el;
    fallback ??= el;
  }
  return fallback;
}

function focusRestoreTarget(entry: RestoreEntry): Element | null {
  const next = restoreFocusTarget<Element>(entry.element, entry.trail, (node) => node.isConnected, firstFocusableIn);
  (next as HTMLElement | null)?.focus?.();
  return next;
}

/** Arrêt du guet en cours : un seul à la fois, une nouvelle fermeture ou ouverture le remplace. */
let stopLateRemovalWatch: (() => void) | null = null;

/** La région principale de la page : borne du relevé du voisinage et du guet. */
const isMainRegion = (el: Element) => el.matches("main, [role='main']");

/**
 * Le déclencheur a repris le focus mais sa ligne peut encore disparaître
 * (rechargement après fermeture) : à son retrait, si le focus est tombé sur
 * `<body>`, il passe à la ligne voisine. Guet borné (3 s), levé au premier
 * retrait, à la page quittée (adresse changée), à une nouvelle modale, au
 * premier clic dans la page ou dès que le focus va ailleurs. Il n'écoute que les **parents** du déclencheur
 * jusqu'à la région principale (`childList`, sans sous-arbre) : le retrait de
 * la ligne est celui d'un maillon de cette chaîne, et les mises à jour en
 * continu du reste de la page ne déclenchent rien.
 */
function watchLateRemoval(entry: RestoreEntry) {
  stopLateRemovalWatch?.();
  if (entry.element === document.body || entry.element === document.documentElement) return;
  const region: Element = entry.element.closest("main, [role='main']") ?? document.body;
  const startedAt = `${location.pathname}${location.search}`;
  const observer = new MutationObserver(() => {
    if (entry.element.isConnected) return;
    stop();
    // Page changée : le focus sur `<body>` est l'usage, rien à rendre.
    if (`${location.pathname}${location.search}` !== startedAt) return;
    if (!entry.trail.some((step) => step.parent.isConnected && region.contains(step.parent))) return;
    const active = document.activeElement;
    if (active === null || active === document.body) focusRestoreTarget(entry);
  });
  const onFocusIn = (event: FocusEvent) => {
    if (event.target !== entry.element) stop();
  };
  // Un clic dans la page (même sur un fond non focalisable, qui pose le focus
  // sur `<body>` sans `focusin`) est un choix : le guet ne le reprend pas.
  const onPointerDown = () => stop();
  const timer = setTimeout(() => stop(), LATE_REMOVAL_WATCH_MS);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    if (stopLateRemovalWatch === stop) stopLateRemovalWatch = null;
  }
  stopLateRemovalWatch = stop;
  for (const step of entry.trail) {
    observer.observe(step.parent, { childList: true });
    if (step.parent === region) break;
  }
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("pointerdown", onPointerDown, true);
}

/**
 * Comportement commun des boîtes de dialogue modales : fermeture par `Échap`,
 * verrouillage du défilement de l'arrière-plan tant qu'une modale est ouverte,
 * et restitution du focus à l'élément qui l'avait avant l'ouverture.
 *
 * Renvoie une `ref` à poser sur le conteneur de la modale : le focus y est
 * déplacé à l'ouverture (sur l'élément marqué `data-autofocus`, sinon le premier
 * élément focalisable, sinon le conteneur lui-même), et le focus clavier y est **piégé** — `Tab` et
 * `Maj+Tab` bouclent à l'intérieur au lieu de repartir dans la page derrière.
 *
 * Plusieurs modales peuvent se superposer (la mise en avant urgente par-dessus
 * une annonce ouverte en lecture, par exemple) : seule celle du dessus répond au
 * clavier, et le défilement n'est rendu qu'à la fermeture de la dernière.
 */
export function useDialogBehavior({ open, onClose, locked = false, initialFocus = "first" }: DialogBehaviorOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  // `onClose` est relu à chaque événement : une fonction recréée à chaque rendu
  // ne doit pas réabonner l'écouteur (ni relancer le verrou de défilement).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    if (!open) return;

    stopLateRemovalWatch?.();
    const token = Symbol("dialog");
    const container = containerRef.current;
    const opener = document.activeElement as HTMLElement | null;
    restoreTargets.set(token, opener ? { element: opener, trail: focusTrail<Element>(opener, isMainRegion) } : null);
    dialogStack.push(token);

    // Focus initial : l'élément marqué `data-autofocus` s'il y en a un (le champ
    // à remplir d'abord n'est pas toujours le premier de la modale — un bouton
    // d'aperçu peut le précéder), sinon le premier élément focalisable, sinon
    // le conteneur (rendu focalisable par `tabIndex={-1}` côté appelant). Le
    // champ marqué est pris **parmi** les focalisables : désactivé ou masqué,
    // `focus()` échouerait en silence et laisserait le focus derrière le voile.
    const focusablesIn = (root: Element | null) =>
      Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(
        (el) =>
          (el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden") ||
          el === document.activeElement,
      );
    const focusables = () => focusablesIn(containerRef.current);
    const candidates = focusables();
    const preferred = candidates.find((el) => el.dataset.autofocus !== undefined);
    // Un bouton « × » d'en-tête (`data-dialog-close`) vient en tête du DOM pour
    // rester collé en haut du panneau : il n'est pas ce qu'on vient faire dans
    // la modale, le focus d'ouverture va au premier contrôle qui suit.
    const firstContent = candidates.find((el) => el.dataset.dialogClose === undefined);

    if (initialFocusRef.current === "container") containerRef.current?.focus({ preventScroll: true });
    else (preferred ?? firstContent ?? candidates[0] ?? containerRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // Les écouteurs de toutes les couches vivent sur `window` : seule celle du
      // dessus doit réagir, sinon un `Échap` les fermerait toutes d'un coup.
      if (!dialogStack.isTop(token)) return;
      // Couches marquées `data-dialog-exempt` : le menu d'accessibilité, offert
      // au-dessus des modales (une modale qu'on ne peut pas écarter doit rester
      // lisible, contraste ou texte agrandi compris). Elles entrent dans le
      // cycle de tabulation, après la modale.
      const layers = Array.from(document.querySelectorAll("[data-dialog-exempt]"));

      if (event.key === "Escape") {
        // Panneau d'une couche ouvert, ou liste d'un `combobox` ouverte : Échap
        // leur revient (l'écouteur est posé en capture sur `window`, il
        // passerait avant eux et fermerait la modale entière — saisie comprise).
        if (lockedRef.current) return;
        if (escapeBelongsElsewhere(layers, event.target as HTMLElement | null, containerRef.current)) return;
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      // Piège à focus : la tabulation parcourt la modale, puis les couches
      // exemptées, et reboucle. À l'intérieur de chaque bloc, l'ordre natif
      // est gardé (groupes de boutons radio compris) : seuls les bords sont
      // tenus.
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        containerRef.current?.focus();
        return;
      }
      const extra = layers.flatMap((layer) => focusablesIn(layer));
      const active = document.activeElement;
      const inModal = containerRef.current?.contains(active as Node) ?? false;
      const inLayer = !inModal && extra.length > 0 && layers.some((layer) => layer.contains(active as Node));

      const onContainer = active === containerRef.current;
      const next = focusTrapTarget({ items, extra, active, inModal, onContainer, inLayer, shiftKey: event.shiftKey });
      if (next) {
        event.preventDefault();
        next.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      // Retour au déclencheur : sans ça, le focus repart en tête de document.
      // Déclencheur retiré (sa ligne supprimée) : sa ligne voisine, sa liste…
      // Seulement pour la modale du dessus : une modale recouverte qui se ferme
      // ne doit pas arracher le focus à celle qui la couvre ; elle lui passe sa
      // cible si celle du dessus visait un élément en son sein.
      const wasTop = dialogStack.isTop(token);
      dialogStack.pop(token);
      const target = restoreTargets.get(token) ?? null;
      restoreTargets.delete(token);
      if (wasTop) {
        if (target !== null && focusRestoreTarget(target) === target.element) watchLateRemoval(target);
        return;
      }
      handOffRestoreTargets(restoreTargets, (entry) => container?.contains(entry.element) ?? false, target);
    };
  }, [open]);

  return containerRef;
}
