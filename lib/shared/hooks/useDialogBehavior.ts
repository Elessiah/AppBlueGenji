"use client";

import { useEffect, useRef } from "react";

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
 * Comportement commun des boîtes de dialogue modales : fermeture par `Échap`,
 * verrouillage du défilement de l'arrière-plan tant que la modale est ouverte,
 * et restitution du focus à l'élément qui l'avait avant l'ouverture.
 *
 * Renvoie une `ref` à poser sur le conteneur de la modale : le focus y est
 * déplacé à l'ouverture (sur le premier élément focalisable, sinon sur le
 * conteneur lui-même), et le focus clavier y est **piégé** — `Tab` et
 * `Maj+Tab` bouclent à l'intérieur au lieu de repartir dans la page derrière.
 *
 * Le verrouillage du défilement restaure la valeur exacte trouvée sur
 * `document.body` plutôt que de la vider : si plusieurs couches la manipulent,
 * on ne veut pas effacer le réglage de la couche précédente.
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

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Défilement de l'arrière-plan gelé le temps de la lecture.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus initial : premier élément focalisable de la modale, sinon le
    // conteneur (rendu focalisable par `tabIndex={-1}` côté appelant).
    const focusables = () =>
      Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const first = focusables()[0];
    (first ?? containerRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
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
      document.body.style.overflow = previousOverflow;
      // Retour au déclencheur : sans ça, le focus repart en tête de document.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return containerRef;
}
