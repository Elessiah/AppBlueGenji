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
 * ligne ne mène nulle part), à défaut un désarmé plutôt que rien.
 */
function firstFocusableIn(root: Element): Element | null {
  const shown = [root, ...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => el.matches(FOCUSABLE_SELECTOR) && isShown(el));
  return shown.find(isArmed) ?? shown[0] ?? null;
}

function focusRestoreTarget(entry: RestoreEntry): Element | null {
  const next = restoreFocusTarget<Element>(entry.element, entry.trail, (node) => node.isConnected, firstFocusableIn);
  (next as HTMLElement | null)?.focus?.();
  return next;
}

/** Arrêt du guet en cours : un seul à la fois, une nouvelle fermeture remplace le précédent. */
let stopLateRemovalWatch: (() => void) | null = null;

/**
 * Le déclencheur a repris le focus mais sa ligne peut encore disparaître
 * (rechargement après fermeture) : à son retrait, si le focus est tombé sur
 * `<body>`, il passe à la ligne voisine. Guet borné, levé au premier retrait,
 * limité à la région principale ; il n'agit que si un ancêtre du déclencheur
 * **de cette région** est toujours là (une ligne retirée d'une liste, pas un
 * changement de page, où le focus sur `<body>` est l'usage).
 */
function watchLateRemoval(entry: RestoreEntry) {
  stopLateRemovalWatch?.();
  if (entry.element === document.body || entry.element === document.documentElement) return;
  const region: Element = entry.element.closest("main, [role='main']") ?? document.body;
  const observer = new MutationObserver(() => {
    if (entry.element.isConnected) return;
    stop();
    if (!entry.trail.some((step) => step.parent !== region && step.parent.isConnected && region.contains(step.parent))) return;
    const active = document.activeElement;
    if (active === null || active === document.body) focusRestoreTarget(entry);
  });
  const timer = setTimeout(() => stop(), LATE_REMOVAL_WATCH_MS);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
    if (stopLateRemovalWatch === stop) stopLateRemovalWatch = null;
  }
  stopLateRemovalWatch = stop;
  observer.observe(region, { childList: true, subtree: true });
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

    const token = Symbol("dialog");
    const container = containerRef.current;
    const opener = document.activeElement as HTMLElement | null;
    restoreTargets.set(token, opener ? { element: opener, trail: focusTrail<Element>(opener) } : null);
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
