"use client";

import { useEffect, useRef } from "react";
import { createDialogStack, type ScrollLockTarget } from "@/lib/shared/dialog-stack";

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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
export function useDialogBehavior({ open, onClose, locked = false }: DialogBehaviorOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  // `onClose` est relu à chaque événement : une fonction recréée à chaque rendu
  // ne doit pas réabonner l'écouteur (ni relancer le verrou de défilement).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    if (!open) return;

    const token = Symbol("dialog");
    const previouslyFocused = document.activeElement as HTMLElement | null;
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
    const preferred = candidates.find((el) => el.hasAttribute("data-autofocus"));
    // Un bouton « × » d'en-tête (`data-dialog-close`) vient en tête du DOM pour
    // rester collé en haut du panneau : il n'est pas ce qu'on vient faire dans
    // la modale, le focus d'ouverture va au premier contrôle qui suit.
    const firstContent = candidates.find((el) => !el.hasAttribute("data-dialog-close"));

    (preferred ?? firstContent ?? candidates[0] ?? containerRef.current)?.focus();

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
        // Panneau d'une couche ouvert : Échap le referme lui (son écouteur est
        // sur `document`), pas la modale — qui perdrait sa saisie. La question
        // porte sur le panneau et non sur la cible : Safari ne focalise pas un
        // bouton cliqué, le focus peut être resté dans la modale.
        if (layers.some((layer) => layer.querySelector('[aria-expanded="true"]'))) return;
        if (lockedRef.current) return;
        // Un champ `combobox` dont la liste est ouverte répond d'abord à Échap
        // (il la referme) : l'écouteur est posé en capture sur `window`, il
        // passerait avant lui et fermerait la modale entière — saisie comprise.
        // Le rôle est exigé, et pas seulement `aria-expanded` : un bouton de
        // dépliage porte lui aussi `aria-expanded="true"`, mais n'écoute pas
        // Échap — la modale ne se fermerait alors plus du tout.
        const target = event.target as HTMLElement | null;
        if (
          target?.getAttribute?.("role") === "combobox" &&
          target.getAttribute("aria-expanded") === "true"
        ) {
          return;
        }
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
      const start = items[0];
      const end = items[items.length - 1];
      const active = document.activeElement;
      const inModal = containerRef.current?.contains(active as Node) ?? false;
      const inLayer = !inModal && extra.length > 0 && layers.some((layer) => layer.contains(active as Node));

      const go = (el: HTMLElement) => {
        event.preventDefault();
        el.focus();
      };
      if (inLayer) {
        if (!event.shiftKey && active === extra[extra.length - 1]) go(start);
        else if (event.shiftKey && active === extra[0]) go(end);
        return;
      }
      if (!inModal) {
        go(event.shiftKey ? end : start);
        return;
      }
      if (event.shiftKey && active === start) go(extra[extra.length - 1] ?? end);
      else if (!event.shiftKey && active === end) go(extra[0] ?? start);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      dialogStack.pop(token);
      // Retour au déclencheur : sans ça, le focus repart en tête de document.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return containerRef;
}
