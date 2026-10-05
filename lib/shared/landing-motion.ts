/**
 * Animations de l'accueil (`docs/features/LANDING_ANIMATIONS.md`) — logique
 * pure, partagée par `Reveal` et `CountUp`.
 *
 * Une seule porte : `decorativeMotion` du régime de charge
 * (`lib/shared/client-power.ts`), qui est déjà faux sous la préférence système
 * de mouvement réduit, sous le réglage « Réduire les animations » du menu
 * d'accessibilité, onglet caché ou machine à la peine. Aucune animation de
 * l'accueil ne relit ces signaux à part : elles suivent toutes cette porte.
 */

/** Durée du décompte des chiffres du hero. */
export const COUNT_UP_MS = 1200;

/** Ce qu'il faut savoir d'un bloc pour décider de le masquer avant son apparition. */
export type RevealInput = {
  /** `decorativeMotion` du régime de charge. */
  motion: boolean;
  /** `IntersectionObserver` existe dans ce navigateur. */
  observerSupported: boolean;
  /** Haut du bloc par rapport au haut de la fenêtre, en pixels. */
  top: number;
  /** Hauteur de la fenêtre, en pixels. */
  viewportHeight: number;
};

/**
 * Masquer le bloc en attendant qu'il entre à l'écran ? Jamais ce qui est déjà
 * visible au chargement (pas d'éclair « plein → vide → plein », ni de recul du
 * LCP), jamais sans observateur (le bloc ne réapparaîtrait pas), jamais quand
 * le mouvement est coupé. Le rendu serveur ne masque rien : sans JavaScript,
 * tout le contenu est visible.
 */
export function shouldDeferReveal(input: RevealInput): boolean {
  if (!input.motion || !input.observerSupported) return false;
  return input.top >= input.viewportHeight;
}

/**
 * Part de la cible d'où repart le décompte d'un chiffre **déjà à l'écran** au
 * chargement : il a été lu à sa valeur finale (rendu serveur), le faire
 * retomber à 0 serait un éclair « plein → vide → plein ». Il roule donc des
 * derniers 15 %. Un chiffre encore hors de l'écran part de 0.
 */
export const COUNT_UP_ON_SCREEN_FROM = 0.85;

/** Point de départ du décompte : 0 hors de l'écran, `COUNT_UP_ON_SCREEN_FROM` de la cible sinon. */
export function countUpStart(target: number, onScreenAtMount: boolean): number {
  if (!Number.isFinite(target)) return 0;
  return onScreenAtMount ? Math.round(target * COUNT_UP_ON_SCREEN_FROM) : 0;
}

/**
 * Valeur affichée par le décompte à l'avancement `progress` (0 → 1), de `from`
 * à `target`, en décélération (cubique) : vite au début, posé à l'arrivée.
 * Bornée, entière, et toujours la cible exacte à la fin.
 */
export function countUpValue(target: number, progress: number, from = 0): number {
  if (!Number.isFinite(target)) return 0;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 1));
  if (clamped >= 1) return target;
  const eased = 1 - (1 - clamped) ** 3;
  return Math.round(from + (target - from) * eased);
}
