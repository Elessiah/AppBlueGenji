"use client";

import { useEffect, useRef, useState } from "react";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { COUNT_UP_MS, countUpStart, countUpValue } from "@/lib/shared/landing-motion";

/**
 * Chiffre du hero qui se décompte de 0 à sa valeur, une fois, quand il entre à
 * l'écran (`docs/features/LANDING_ANIMATIONS.md`).
 *
 * Le rendu serveur écrit la valeur finale (lisible sans JavaScript, indexée
 * telle quelle) ; la boucle `requestAnimationFrame` ne démarre que si le régime
 * de charge permet les animations décoratives, et s'arrête d'elle-même au bout
 * de `COUNT_UP_MS`. Déjà à l'écran au chargement, il ne retombe pas à 0 : il
 * roule des derniers 15 % (`countUpStart`). La largeur est réservée en `ch` sur la valeur finale
 * (chiffres tabulaires) : le décompte ne pousse rien.
 */
export function CountUp({ value, className }: Readonly<{ value: number; className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(value);
  const { decorativeMotion } = useClientPower();
  const played = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || played.current || !decorativeMotion || typeof IntersectionObserver === "undefined") {
      setShown(value);
      return undefined;
    }
    let frame = 0;
    const from = countUpStart(value, element.getBoundingClientRect().top < window.innerHeight);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      played.current = true;
      const start = performance.now();
      const step = (now: number) => {
        const progress = (now - start) / COUNT_UP_MS;
        setShown(countUpValue(value, progress, from));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      setShown(value);
    };
  }, [value, decorativeMotion]);

  return (
    <div ref={ref} className={className} style={{ minWidth: `${String(value).length}ch` }}>
      {shown}
    </div>
  );
}
