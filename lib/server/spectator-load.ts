/**
 * Charge du serveur, telle que la lisent les lectures publiques d'un tournoi
 * (`/api/spectator/tournaments/[id]`).
 *
 * Trois signaux, tous lus **en mémoire** — mesurer la charge ne doit pas en
 * ajouter : le retard de la boucle d'évènements, les flux SSE ouverts et le
 * rythme des lectures publiques. La décision (seuils, cadences) vit dans le
 * module pur `lib/shared/spectator-view.ts`.
 */
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { openStreamCount } from "@/lib/server/tournament-broadcast";
import {
  spectatorLoadLevel,
  type SpectatorLoadLevel,
  type SpectatorLoadSignals,
} from "@/lib/shared/spectator-view";

/**
 * Fenêtre d'échantillonnage du retard de boucle. Tant que la sonde est armée,
 * un minuteur relit le centile puis le remet à zéro à chaque fenêtre : il décrit
 * les dix dernières secondes, même quand les lectures publiques sont rares —
 * jamais une pause d'il y a cinq minutes.
 */
export const LOOP_DELAY_SAMPLE_MS = 10_000;

/** Fenêtre du compte des lectures publiques. */
export const SPECTATOR_READ_WINDOW_MS = 60_000;

/** Pas de la sonde de boucle : il entre dans chaque mesure, qui le retranche. */
export const LOOP_DELAY_RESOLUTION_MS = 20;

/**
 * Sans lecture publique depuis ce délai, la sonde se désarme : elle ne tourne
 * que pendant qu'il y a des visiteurs sans compte à régler.
 */
export const LOOP_PROBE_IDLE_MS = 5 * 60_000;

let histogram: IntervalHistogram | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Dernière activité publique (lecture servie, ou mesure de la charge). */
let lastActivityAt = 0;
let lastLoopDelayMs: number | null = null;

/** Les lectures de la fenêtre courante et de la précédente (compte glissant approché). */
let windowStartedAt = 0;
let currentReads = 0;
let previousReads = 0;
/** Lectures comptées par client dans la fenêtre courante (plafond `SPECTATOR_READS_PER_CLIENT`). */
const readsByClient = new Map<string, number>();

/**
 * Part d'un même client (adresse IP) dans le signal, par fenêtre. Un onglet en
 * fait un peu plus de deux par minute : le plafond laisse passer quelques
 * onglets, mais une poignée d'adresses qui martèlent la route ne peuvent plus
 * pousser à elles seules le niveau de charge — et ralentir tous les visiteurs
 * sans compte du site. Une salle de LAN derrière une même adresse y pèse
 * moins qu'elle ne lit : ses lectures ne coûtent que le cache partagé.
 */
export const SPECTATOR_READS_PER_CLIENT = 10;

/** Au-delà, les clients ne sont plus suivis un à un (mémoire bornée) : ils comptent sans plafond. */
const MAX_TRACKED_CLIENTS = 10_000;

function disarmProbe(): void {
  histogram?.disable();
  histogram = null;
  if (sampleTimer !== null) clearInterval(sampleTimer);
  sampleTimer = null;
  lastLoopDelayMs = null;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
}

/**
 * Note une activité, et garde **un seul** minuteur d'inactivité : il se relance
 * lui-même tant que l'activité continue, plutôt que d'être recréé à chaque
 * lecture — sous la charge, c'est précisément là qu'on économise. Il ne
 * retient pas le processus (`unref`).
 */
function touchProbe(now: number): void {
  lastActivityAt = now;
  if (idleTimer !== null) return;
  const check = (wait: number) => {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      const idle = Date.now() - lastActivityAt;
      if (idle >= LOOP_PROBE_IDLE_MS) disarmProbe();
      else check(LOOP_PROBE_IDLE_MS - idle);
    }, wait);
    idleTimer.unref?.();
  };
  check(LOOP_PROBE_IDLE_MS);
}

/** Relève le centile de la fenêtre écoulée, puis repart de zéro. */
function sampleLoopDelay(): void {
  if (histogram === null) return;
  // Le centile est en nanosecondes.
  const p99 = histogram.percentile(99) / 1e6 - LOOP_DELAY_RESOLUTION_MS;
  lastLoopDelayMs = Number.isFinite(p99) && p99 > 0 ? p99 : 0;
  histogram.reset();
}

/**
 * Retard de boucle au 99ᵉ centile, en millisecondes. La sonde n'est armée
 * qu'avec les lectures publiques, et se désarme après
 * {@link LOOP_PROBE_IDLE_MS} sans visiteur : un serveur sans visiteur anonyme
 * n'en paie rien. `null` tant qu'aucune fenêtre n'est close.
 *
 * L'histogramme mesure chaque tour **de son propre minuteur** : le pas
 * (`LOOP_DELAY_RESOLUTION_MS`) y figure toujours — un processus au repos lit
 * ~20 ms. Il est retranché : seuls comptent les retards en plus.
 */
function loopDelayMs(now: number): number | null {
  // Toute mesure compte comme activité : une sonde armée par une lecture qui
  // n'aboutit pas (404, 503) se désarme aussi.
  touchProbe(now);
  if (histogram === null) {
    histogram = monitorEventLoopDelay({ resolution: LOOP_DELAY_RESOLUTION_MS });
    histogram.enable();
    sampleTimer = setInterval(sampleLoopDelay, LOOP_DELAY_SAMPLE_MS);
    sampleTimer.unref?.();
  }
  return lastLoopDelayMs;
}

function rollWindow(now: number): void {
  const elapsed = now - windowStartedAt;
  if (elapsed < SPECTATOR_READ_WINDOW_MS) return;
  if (elapsed < 2 * SPECTATOR_READ_WINDOW_MS) {
    // La fenêtre close dure exactement une minute : la suivante part de sa fin,
    // pas de la première lecture qui la referme.
    previousReads = currentReads;
    windowStartedAt += SPECTATOR_READ_WINDOW_MS;
  } else {
    previousReads = 0;
    windowStartedAt = now;
  }
  currentReads = 0;
  readsByClient.clear();
}

/** Compte une lecture publique, et repousse le désarmement de la sonde. */
export function recordSpectatorRead(now: number = Date.now(), client: string | null = null): void {
  rollWindow(now);
  touchProbe(now);
  // Sans adresse connue (proxy de confiance non configuré), tous les clients
  // partagent une même part : le signal sous-estime plutôt que de se laisser
  // pousser par un seul.
  const key = client ?? "";
  const counted = readsByClient.get(key) ?? 0;
  if (counted >= SPECTATOR_READS_PER_CLIENT) return;
  if (counted > 0 || readsByClient.size < MAX_TRACKED_CLIENTS) readsByClient.set(key, counted + 1);
  currentReads += 1;
}

/**
 * Lectures publiques sur la dernière minute, approchées : la fenêtre
 * précédente compte au prorata de ce qu'il en reste dans la minute glissante.
 */
export function spectatorReadsPerMinute(now: number = Date.now()): number {
  rollWindow(now);
  const remaining = Math.max(0, 1 - (now - windowStartedAt) / SPECTATOR_READ_WINDOW_MS);
  return Math.round(currentReads + previousReads * remaining);
}

/** Les trois signaux, à l'instant. */
export function spectatorLoadSignals(now: number = Date.now()): SpectatorLoadSignals {
  return {
    eventLoopDelayMs: loopDelayMs(now),
    openStreams: openStreamCount(),
    spectatorReadsPerMinute: spectatorReadsPerMinute(now),
  };
}

/** Niveau de charge courant (`lib/shared/spectator-view.ts`). */
export function currentSpectatorLoadLevel(now: number = Date.now()): SpectatorLoadLevel {
  return spectatorLoadLevel(spectatorLoadSignals(now));
}

/** Remet les mesures à zéro. Réservé aux tests. */
export function resetSpectatorLoad(): void {
  disarmProbe();
  lastActivityAt = 0;
  windowStartedAt = 0;
  currentReads = 0;
  previousReads = 0;
  readsByClient.clear();
}
