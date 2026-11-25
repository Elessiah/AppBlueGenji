/**
 * Horloges de fond du serveur (purges, balayages) : un premier passage après
 * un délai, puis un passage à intervalle fixe, une fois par processus.
 *
 * Le premier passage attend `firstDelayMs`, les suivants `tickMs` chacun,
 * **comptés depuis le premier** (délai + n × pas) : après chaque démarrage, une
 * purge quotidienne court donc `firstDelayMs` après le lancement, puis toutes
 * les 24 h.
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
  /** Compte les arrêts : un premier passage différé d'une horloge arrêtée entre-temps ne part pas. */
  generation: number;
  /** Réglages de l'horloge lancée, pour la reprise après un arrêt non suivi de sortie. */
  options: PeriodicClockOptions | null;
  /** Arrêtée par {@link stopAllPeriodicClocks} alors qu'elle tournait. */
  suspended: boolean;
  /** Un pas ignoré (passage précédent toujours en cours) est déjà journalisé pour ce passage. */
  skipLogged: boolean;
};

/** Passages de fond lancés hors d'une horloge (entretien entraîné par le trafic), et l'arrêt du serveur. */
type BackgroundState = { halted: boolean; passes: Set<Promise<unknown>>; haltListeners?: Set<() => void> };

const globalClocks = globalThis as typeof globalThis & {
  __bgPeriodicClocks?: Map<string, ClockState>;
  __bgBackgroundPasses?: BackgroundState;
};

function clocks(): Map<string, ClockState> {
  globalClocks.__bgPeriodicClocks ??= new Map();
  return globalClocks.__bgPeriodicClocks;
}

function background(): BackgroundState {
  globalClocks.__bgBackgroundPasses ??= { halted: false, passes: new Set() };
  return globalClocks.__bgBackgroundPasses;
}

/**
 * Le serveur s'arrête ({@link stopAllPeriodicClocks}, jusqu'à une éventuelle
 * reprise) : un passage de fond déclenché autrement que par une horloge (une
 * requête qui entraîne l'entretien) ne démarre plus.
 */
export function backgroundPassesHalted(): boolean {
  return background().halted;
}

/**
 * Inscrit un passage de fond lancé hors d'une horloge : l'arrêt du serveur
 * l'attend comme ceux des horloges. Retiré de lui-même à sa fin.
 */
export function trackBackgroundPass(pass: Promise<unknown>): void {
  const { passes } = background();
  passes.add(pass);
  const settled = () => {
    passes.delete(pass);
  };
  pass.then(settled, settled);
}

/**
 * Écoute l'arrêt du serveur ({@link stopAllPeriodicClocks}) : `listener` est
 * appelé **sur-le-champ**, avant l'attente bornée des passages et le vidage du
 * journal — un passage trop long pour finir à temps y pose sa dernière ligne.
 * Rend de quoi se désinscrire (à la fin du passage). Une erreur de l'écouteur
 * est avalée : l'arrêt ne s'interrompt pas.
 */
export function onBackgroundHalt(listener: () => void): () => void {
  const state = background();
  state.haltListeners ??= new Set();
  const listeners = state.haltListeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
  if (state.inFlight) {
    // Un passage qui ne finit jamais (verrou nommé, base figée) éteindrait
    // l'horloge sans bruit : le premier pas ignoré se journalise, une fois par passage.
    if (!state.skipLogged) console.warn(`${options.failureMessage} (passage précédent toujours en cours, pas ignoré)`);
    state.skipLogged = true;
    return;
  }
  const pass = runOnce(state, options).finally(() => {
    if (state.inFlight === pass) state.inFlight = null;
    state.skipLogged = false;
  });
  state.inFlight = pass;
}

/** Lance l'horloge `options.key` ; sans effet si elle tourne déjà. */
export function startPeriodicClock(options: PeriodicClockOptions): void {
  const registry = clocks();
  let state = registry.get(options.key);
  if (!state) {
    state = { first: null, timer: null, failing: false, inFlight: null, generation: 0, options: null, suspended: false, skipLogged: false };
    registry.set(options.key, state);
  }
  if (state.first || state.timer) return;
  const current = state;
  current.options = options;
  current.suspended = false;
  const { generation } = current;
  // L'intervalle part du premier passage : armé dès le démarrage, il devancerait
  // un premier délai plus long que lui (2 min d'attente pour un pas d'1 min).
  current.first = setTimeout(() => {
    current.first = null;
    // Relancée pendant que l'ancien passage court encore : ce premier passage
    // l'attend (le sauter coûterait un pas entier, un jour pour la purge).
    // L'intervalle n'est armé qu'avec ce premier passage : armé pendant
    // l'attente, il buterait sur l'ancien passage et l'annoncerait bloqué.
    const begin = () => {
      tick(current, options);
      current.timer = setInterval(() => tick(current, options), options.tickMs);
      current.timer.unref?.();
    };
    const previous = current.inFlight;
    if (previous) {
      void previous.then(() => {
        // Arrêtée (ou relancée) pendant l'attente : la nouvelle génération décide.
        if (current.generation === generation && !current.timer) begin();
      });
    } else begin();
  }, options.firstDelayMs);
  current.first.unref?.();
}

/** Coupe les minuteurs de l'horloge, sans attendre ; rend son passage en cours. */
function clearClock(state: ClockState): Promise<void> {
  state.generation += 1;
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
  if (state) {
    state.suspended = false;
    await clearClock(state);
  }
}

/**
 * Arrête toutes les horloges : leurs minuteurs sont coupés **sur-le-champ**
 * (aucun passage ne démarre plus, {@link backgroundPassesHalted} non plus), la
 * promesse rendue attend les passages en cours, ceux des horloges comme ceux
 * inscrits par {@link trackBackgroundPass}.
 */
export function stopAllPeriodicClocks(): Promise<void> {
  const state = background();
  state.halted = true;
  for (const listener of [...(state.haltListeners ?? [])]) {
    try {
      listener();
    } catch {
      // Un écouteur en panne n'empêche ni les autres ni l'arrêt.
    }
  }
  return Promise.all([
    ...[...clocks().values()].map((clock) => {
      if (clock.first || clock.timer) clock.suspended = true;
      return clearClock(clock);
    }),
    ...[...state.passes].map((pass) => pass.catch(() => undefined)),
  ]).then(() => undefined);
}

/**
 * Relance les horloges coupées par {@link stopAllPeriodicClocks} : le signal
 * d'arrêt n'a pas emporté le processus (un autre écouteur le retient), les
 * balayages de fond ne doivent pas rester éteints jusqu'au prochain démarrage.
 */
export function resumeSuspendedPeriodicClocks(): void {
  background().halted = false;
  for (const state of clocks().values()) {
    if (state.suspended && state.options) startPeriodicClock(state.options);
  }
}
