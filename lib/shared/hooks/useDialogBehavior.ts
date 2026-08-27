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
 * déplacé à l'ouverture (sur le premier élément focalisable, sinon sur le
 * conteneur lui-même), et le focus clavier y est **piégé** — `Tab` et
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

    // Focus initial : premier élément focalisable de la modale, sinon le
    // conteneur (rendu focalisable par `tabIndex={-1}` côté appelant).
    const focusables = () =>
      Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    (focusables()[0] ?? containerRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // Les écouteurs de toutes les couches vivent sur `window` : seule celle du
      // dessus doit réagir, sinon un `Échap` les fermerait toutes d'un coup.
      if (!dialogStack.isTop(token)) return;

      if (event.key === "Escape") {
        if (lockedRef.current) return;
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      // Piège à focus : la tabulation boucle entre le premier et le dernier
      // élément focalisable de la modale.
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        containerRef.current?.focus();
        return;
      }
      const start = items[0];
      const end = items[items.length - 1];
      const active = document.activeElement;
      const inside = containerRef.current?.contains(active as Node) ?? false;

      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? end : start).focus();
        return;
      }
      if (event.shiftKey && active === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && active === end) {
        event.preventDefault();
        start.focus();
      }
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
