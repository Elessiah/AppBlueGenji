"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { shouldDeferReveal } from "@/lib/shared/landing-motion";

/**
 * Apparition au défilement d'une section de l'accueil, une seule fois
 * (`docs/features/LANDING_ANIMATIONS.md`).
 *
 * Le rendu serveur ne pose **aucune** classe : sans JavaScript, la section est
 * visible. Le masquage (`reveal-pending`) n'est ajouté qu'après hydratation,
 * pour une section encore sous la ligne de flottaison, et seulement si le
 * régime de charge permet les animations décoratives — mouvement réduit et
 * menu d'accessibilité compris. Si la permission tombe en route, la section se
 * montre aussitôt.
 */
export function Reveal({ children }: Readonly<{ children: ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  const { decorativeMotion } = useClientPower();

  useEffect(() => {
    const element = ref.current;
    if (!element || element.classList.contains("reveal-in")) return undefined;
    const defer = shouldDeferReveal({
      motion: decorativeMotion,
      observerSupported: typeof IntersectionObserver !== "undefined",
      top: element.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    });
    if (!defer) {
      element.classList.remove("reveal-pending");
      return undefined;
    }
    element.classList.add("reveal-pending");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        element.classList.add("reveal-in");
        element.classList.remove("reveal-pending");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [decorativeMotion]);

  return <div ref={ref}>{children}</div>;
}
