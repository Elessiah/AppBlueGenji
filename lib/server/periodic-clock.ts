/**
 * Horloges de fond du serveur (purges, balayages) : un premier passage après
 * un délai, puis un passage à intervalle fixe, une fois par processus.
 *
 * Le premier passage attend `firstDelayMs`, les suivants `tickMs` chacun.
 * Mécanique commune : un passage n'en chevauche jamais un autre, une panne ne
 * s'annonce qu'une fois (jusqu'au prochain succès), les minuteurs ne retiennent
 * pas le processus (`unref`). L'état vit sur `globalThis`, par clé : un module
 * chargé deux fois (deux bundles, dev) ne lance pas deux horloges.
 * {@link stopPeriodicClock} arrête une horloge (premier passage compris) et
 * attend le passage en cours ; {@link stopAllPeriodicClocks} sert à l'arrêt du
 * serveur, où aucun passage ne doit plus démarrer pendant la fermeture.
 */
import { failureReason } from "@/lib/server/failure-reason";

export type PeriodicClockOptions = {
  /** Clé unique de l'horloge dans le processus. */
  key: string;
  /** Délai avant le premier passage. */
  firstDelayMs: number;
  /** Intervalle entre deux passages. */
  tickMs: number;
  /** Le passage ; une erreur est journalisée (une fois par panne), jamais relancée. */
  run: () => Promise<unknown>;
  /** Message journalisé à la première erreur d'une panne. */
  failureMessage: string;
};

type ClockState = {
  first: ReturnType<typeof setTimeout> | null;
  timer: ReturnType<typeof setInterval> | null;
  failing: boolean;
  /** Passage en cours, attendu par l'arrêt. */
  inFlight: Promise<void> | null;
};

const globalClocks = globalThis as typeof globalThis & { __bgPeriodicClocks?: Map<string, ClockState> };

function clocks(): Map<string, ClockState> {
  globalClocks.__bgPeriodicClocks ??= new Map();
  return globalClocks.__bgPeriodicClocks;
}

async function runOnce(state: ClockState, options: PeriodicClockOptions): Promise<void> {
  try {
    await options.run();
    state.failing = false;
  } catch (error) {
    if (!state.failing) console.error(options.failureMessage, failureReason(error));
    state.failing = true;
  }
}

function tick(state: ClockState, options: PeriodicClockOptions): void {
  if (state.inFlight) return;
  const pass = runOnce(state, options).finally(() => {
    if (state.inFlight === pass) state.inFlight = null;
  });
  state.inFlight = pass;
}

/** Lance l'horloge `options.key` ; sans effet si elle tourne déjà. */
export function startPeriodicClock(options: PeriodicClockOptions): void {
  const registry = clocks();
  let state = registry.get(options.key);
  if (!state) {
    state = { first: null, timer: null, failing: false, inFlight: null };
    registry.set(options.key, state);
  }
  if (state.first || state.timer) return;
  const current = state;
  // L'intervalle part du premier passage : armé dès le démarrage, il devancerait
  // un premier délai plus long que lui (2 min d'attente pour un pas d'1 min).
  current.first = setTimeout(() => {
    current.first = null;
    tick(current, options);
    current.timer = setInterval(() => tick(current, options), options.tickMs);
    current.timer.unref?.();
  }, options.firstDelayMs);
  current.first.unref?.();
}

/** Coupe les minuteurs de l'horloge, sans attendre ; rend son passage en cours. */
function clearClock(state: ClockState): Promise<void> {
  if (state.first) clearTimeout(state.first);
  if (state.timer) clearInterval(state.timer);
  state.first = null;
  state.timer = null;
  return state.inFlight ?? Promise.resolve();
}

/**
 * Arrête l'horloge `key` (premier passage compris) et attend la fin du passage
 * en cours, s'il y en a un. Sans effet sur une horloge inconnue ou déjà
 * arrêtée ; l'horloge peut être relancée ensuite.
 */
export async function stopPeriodicClock(key: string): Promise<void> {
  const state = clocks().get(key);
  if (state) await clearClock(state);
}

/**
 * Arrête toutes les horloges : leurs minuteurs sont coupés **sur-le-champ**
 * (aucun passage ne démarre plus), la promesse rendue attend les passages en
 * cours.
 */
export function stopAllPeriodicClocks(): Promise<void> {
  return Promise.all([...clocks().values()].map(clearClock)).then(() => undefined);
}
