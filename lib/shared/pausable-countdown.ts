/**
 * Compte à rebours qu'on peut suspendre — celui d'une notification.
 *
 * Une notification qui s'efface seule au bout de cinq secondes est un **délai
 * imposé** (WCAG 2.2.1, RGAA 13.1) : qui lit lentement, agrandit l'écran ou
 * écoute un lecteur d'écran la voit partir avant la fin. Le délai reste — il
 * évite d'empiler des messages périmés —, mais il se **suspend** : au survol,
 * au focus, et sur demande explicite par le bouton pause. L'état est une
 * valeur, pas une minuterie : le composant en tire la minuterie qu'il faut,
 * et les cas limites se testent sans horloge.
 */
export interface Countdown {
  /** Temps restant au dernier arrêt ou au dernier départ, en ms. */
  remainingMs: number;
  /** Instant du dernier départ, `null` tant que le décompte est suspendu. */
  runningSince: number | null;
}

/** Décompte lancé à `now` pour `durationMs`. */
export function startCountdown(durationMs: number, now: number): Countdown {
  return { remainingMs: Math.max(0, durationMs), runningSince: now };
}

/** Temps restant à `now`, jamais négatif. */
export function countdownRemaining(countdown: Countdown, now: number): number {
  if (countdown.runningSince === null) return countdown.remainingMs;
  return Math.max(0, countdown.remainingMs - Math.max(0, now - countdown.runningSince));
}

/** Suspend le décompte en retenant ce qu'il restait. Sans effet s'il l'était déjà. */
export function pauseCountdown(countdown: Countdown, now: number): Countdown {
  if (countdown.runningSince === null) return countdown;
  return { remainingMs: countdownRemaining(countdown, now), runningSince: null };
}

/**
 * Choix explicite du lecteur, posé par le bouton pause : `PAUSED` tient le
 * décompte arrêté, `RUNNING` le relance même sous le pointeur ou le focus
 * (sans quoi « Reprendre », cliqué sous la souris, ne reprendrait rien),
 * `null` laisse décider le survol et le focus.
 */
export type CountdownOverride = "PAUSED" | "RUNNING" | null;

/** Le décompte doit-il être suspendu ? Le choix explicite prime sur le reste. */
export function isCountdownHeld(override: CountdownOverride, hovered: boolean, focused: boolean): boolean {
  if (override === "PAUSED") return true;
  if (override === "RUNNING") return false;
  return hovered || focused;
}

/** Relance le décompte là où il s'était arrêté. Sans effet s'il tournait déjà. */
export function resumeCountdown(countdown: Countdown, now: number): Countdown {
  if (countdown.runningSince !== null) return countdown;
  return { remainingMs: countdown.remainingMs, runningSince: now };
}
