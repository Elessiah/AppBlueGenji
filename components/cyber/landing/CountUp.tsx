"use client";

import { useEffect, useRef, useState } from "react";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { COUNT_UP_MS, countUpMayStart, countUpStart, countUpValue } from "@/lib/shared/landing-motion";

/**
 * Chiffre du hero qui se décompte de 0 à sa valeur, une fois, quand il entre à
 * l'écran (`docs/features/LANDING_ANIMATIONS.md`).
 *
 * Le rendu serveur écrit la valeur finale (lisible sans JavaScript, indexée
 * telle quelle) ; la boucle `requestAnimationFrame` ne démarre que si le régime
 * de charge permet les animations décoratives, et s'arrête d'elle-même au bout
 * de `COUNT_UP_MS`. Déjà à l'écran au chargement, il ne retombe pas à 0 : il
 * roule des derniers 15 % (`countUpStart`), et seulement juste après le
 * chargement (`countUpMayStart`). La largeur est réservée en `ch` sur la valeur finale
 * (chiffres tabulaires) : le décompte ne pousse rien.
 */
export function CountUp({ value, className }: Readonly<{ value: number; className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(value);
  const { decorativeMotion } = useClientPower();
  const played = useRef(false);
  const mountedAt = useRef<number | null>(null);

  useEffect(() => {
    // Le montage réel, même animations coupées : la fenêtre de départ ne
    // repart pas du moment où elles reviennent.
    mountedAt.current ??= performance.now();
    const element = ref.current;
    if (!element || played.current || !decorativeMotion || typeof IntersectionObserver === "undefined") {
      // Affiché à sa valeur sans animation : il ne rejouera pas au retour des
      // animations, sur un chiffre déjà lu.
      if (element && !decorativeMotion) played.current = true;
      setShown(value);
      return undefined;
    }
    const rect = element.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
    // Au-dessus de la fenêtre (rechargement qui restaure le défilement) : déjà
    // dépassé, donc tenu pour lu — on n'y revient pas avec un décompte.
    const above = rect.bottom <= 0;
    if (above || !countUpMayStart(onScreen, performance.now() - mountedAt.current)) {
      played.current = true;
      setShown(value);
      return undefined;
    }
    let frame = 0;
    const from = countUpStart(value, onScreen);
    // Hors de l'écran, le chiffre attend déjà à son départ : sans cela, il
    // apparaîtrait plein le temps d'une image avant de retomber à 0.
    if (!onScreen) setShown(from);
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

  const animating = shown !== value;

  return (
    <div
      ref={ref}
      className={`${className ?? ""} count-up`.trim()}
      // Le chiffre qui défile est peint par `::before` (`content: attr(…) / ""`,
      // ni lu, ni copié, ni indexé) ; la page ne porte qu'un nœud de texte, la
      // valeur réelle — masquée à l'œil seulement le temps du décompte ou de
      // l'attente d'un chiffre hors de l'écran (parqué à 0).
      data-count={animating ? shown : undefined}
      style={{ minWidth: `${String(value).length}ch` }}
    >
      <span className={animating ? "sr-only count-up-real" : "count-up-real"}>{value}</span>
    </div>
  );
}
