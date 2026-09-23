"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  activeMatchFocusUntil,
  FRAME_SAMPLE_SIZE,
  IGNORE_PERFORMANCE_STORAGE_KEY,
  isSlowFrameInterval,
  MATCH_FOCUS_LEASE_MS,
  MATCH_FOCUS_STORAGE_KEY,
  medianFrameInterval,
  parseMatchFocusLeases,
  performanceLimits,
  powerPolicy,
  UNKNOWN_PROBE,
  updateMatchFocusLease,
  type ClientPowerInput,
  type ClientPowerPolicy,
  type PageAttention,
  type PerformanceLimit,
  type PerformanceProbe,
} from "@/lib/shared/client-power";

/**
 * Magasin du régime de charge (`lib/shared/client-power.ts`), côté navigateur.
 *
 * **Un seul** jeu d'écouteurs pour toute la page — visibilité, focus, préférence
 * de mouvement, bail inter-onglets —, posé au premier abonné et retiré au
 * dernier. Chaque composant qui veut savoir s'il peut s'animer lit ce magasin
 * plutôt que d'écouter `visibilitychange` pour son compte.
 *
 * Il tient aussi la **mesure de cadence d'affichage** : un relevé de
 * {@link FRAME_SAMPLE_SIZE} images, trois secondes après l'arrivée (pour ne pas
 * mesurer l'hydratation), puis toutes les cinq minutes **tant qu'aucun ralenti
 * n'a été constaté**, et seulement quand la page a le focus — une fenêtre en
 * arrière-plan peut être bridée par le système sans que la machine soit en
 * cause. Un ralenti constaté tient jusqu'au rechargement : remesuré en éco,
 * animations coupées, il disparaîtrait, et la page oscillerait entre les deux
 * régimes (`isSlowFrameInterval`). Le témoin offre de l'ignorer. Un relevé,
 * c'est une seconde et demie de rappels `requestAnimationFrame` vides : rien au
 * regard de ce qu'il économise.
 */

type Listener = () => void;

/** Tout ce que le magasin sait : la situation, et de quoi l'expliquer au témoin. */
export type ClientPowerState = {
  input: ClientPowerInput;
  probe: PerformanceProbe;
  /** Limites constatées, **même ignorées** : le témoin dit ce qu'il a vu. */
  limits: PerformanceLimit[];
  /** Le lecteur a demandé d'ignorer la détection de performances. */
  ignorePerformance: boolean;
};

const SERVER_STATE: ClientPowerState = {
  input: { attention: "FOCUSED", matchFocus: false, reducedMotion: false, performanceLimited: false },
  probe: UNKNOWN_PROBE,
  limits: [],
  ignorePerformance: false,
};

/** Premier relevé : après l'hydratation et le premier rendu du contenu. */
const FIRST_SAMPLE_DELAY_MS = 3_000;
/** Relevés suivants : un ralenti peut survenir en cours de route (batterie passée en économie, jeu lancé). */
const RESAMPLE_INTERVAL_MS = 5 * 60_000;
/** Délai après le retour du focus avant un relevé en attente. */
const REFOCUS_SAMPLE_DELAY_MS = 1_000;

const listeners = new Set<Listener>();
let current: ClientPowerState = SERVER_STATE;
/** Ce que cet onglet a déclaré, lu sans attendre `storage` (qui ne vise que les autres). */
let localMatchFocus = false;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let detach: (() => void) | null = null;

let probe: PerformanceProbe = UNKNOWN_PROBE;
let slowFrames = false;
let sampleTimer: ReturnType<typeof setTimeout> | null = null;
let sampleFrame = 0;
/** Un relevé est dû, mais la page n'avait pas le focus. */
let samplePending = false;

/** Identifiant de l'onglet, tiré une fois : il ne sert qu'à nommer son bail. */
const tabId =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function readAttention(): PageAttention {
  if (document.visibilityState === "hidden") return "HIDDEN";
  // `hasFocus` peut lever dans un cadre isolé : on retombe alors sur « regardé »,
  // l'erreur la moins coûteuse (une animation de trop plutôt qu'un score raté).
  try {
    return document.hasFocus() ? "FOCUSED" : "BACKGROUND";
  } catch {
    return "FOCUSED";
  }
}

function readLeases() {
  try {
    return parseMatchFocusLeases(window.localStorage.getItem(MATCH_FOCUS_STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeLeases(until: number | null): void {
  try {
    const now = Date.now();
    const next = updateMatchFocusLease(readLeases(), tabId, until, now);
    if (Object.keys(next).length === 0) window.localStorage.removeItem(MATCH_FOCUS_STORAGE_KEY);
    else window.localStorage.setItem(MATCH_FOCUS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Stockage indisponible (navigation privée, quota) : le régime `MATCH` vaut
    // alors pour cet onglet seulement, ce qui est l'essentiel.
  }
}

function readIgnorePerformance(): boolean {
  try {
    return window.localStorage.getItem(IGNORE_PERFORMANCE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Ce que le navigateur déclare de la machine ; lu une fois, ça ne bouge pas. */
function readHardware(): Pick<PerformanceProbe, "cores" | "memoryGb"> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null;
  const memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
  return { cores, memoryGb };
}

function cancelSample(): void {
  if (sampleTimer !== null) {
    clearTimeout(sampleTimer);
    sampleTimer = null;
  }
  if (sampleFrame !== 0) {
    cancelAnimationFrame(sampleFrame);
    sampleFrame = 0;
  }
}

function scheduleSample(delayMs: number): void {
  if (sampleTimer !== null) clearTimeout(sampleTimer);
  sampleTimer = setTimeout(startSample, delayMs);
}

/**
 * Relève la cadence d'affichage. Abandonné — et remis au prochain focus — si la
 * page perd le focus en cours de route : on ne mesure que ce que le lecteur voit.
 */
function startSample(): void {
  sampleTimer = null;
  if (slowFrames) return;
  if (readAttention() !== "FOCUSED") {
    samplePending = true;
    return;
  }
  samplePending = false;
  const stamps: number[] = [];
  const step = (time: number) => {
    sampleFrame = 0;
    if (readAttention() !== "FOCUSED") {
      samplePending = true;
      return;
    }
    stamps.push(time);
    if (stamps.length < FRAME_SAMPLE_SIZE) {
      sampleFrame = requestAnimationFrame(step);
      return;
    }
    const interval = medianFrameInterval(stamps);
    if (interval !== null) {
      probe = { ...probe, frameIntervalMs: Math.round(interval * 10) / 10 };
      slowFrames = isSlowFrameInterval(interval);
    }
    // Ralenti constaté : on ne remesure plus (voir l'en-tête du module).
    if (!slowFrames) scheduleSample(RESAMPLE_INTERVAL_MS);
    refresh(true);
  };
  sampleFrame = requestAnimationFrame(step);
}

/**
 * Relit la situation et prévient les abonnés si elle a changé. `force` publie
 * même à entrée égale (nouvelle mesure affichée par le témoin).
 */
function refresh(force = false): void {
  const now = Date.now();
  const leaseUntil = activeMatchFocusUntil(readLeases(), now);

  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  // Un onglet fermé sans avoir rendu son bail ne calme pas les autres plus
  // longtemps que l'échéance : on se réveille à cet instant pour le constater.
  if (leaseUntil !== null && listeners.size > 0) {
    expiryTimer = setTimeout(() => refresh(), Math.min(leaseUntil - now + 50, MATCH_FOCUS_LEASE_MS));
  }

  const attention = readAttention();
  // Un relevé attendait le focus : le voici.
  if (
    samplePending &&
    !slowFrames &&
    attention === "FOCUSED" &&
    sampleTimer === null &&
    sampleFrame === 0
  ) {
    samplePending = false;
    scheduleSample(REFOCUS_SAMPLE_DELAY_MS);
  }

  const limits = performanceLimits(probe, slowFrames);
  const ignorePerformance = readIgnorePerformance();
  const input: ClientPowerInput = {
    attention,
    matchFocus: localMatchFocus || leaseUntil !== null,
    reducedMotion: readReducedMotion(),
    performanceLimited: limits.length > 0 && !ignorePerformance,
  };
  const previous = current.input;
  const unchanged =
    input.attention === previous.attention &&
    input.matchFocus === previous.matchFocus &&
    input.reducedMotion === previous.reducedMotion &&
    input.performanceLimited === previous.performanceLimited &&
    ignorePerformance === current.ignorePerformance &&
    limits.join() === current.limits.join();
  if (unchanged && !force) return;

  current = {
    // L'identité de `input` n'est renouvelée que s'il change : les composants
    // qui ne lisent que le régime ne sont pas re-rendus par une mesure.
    input: unchanged ? previous : input,
    probe,
    limits,
    ignorePerformance,
  };
  for (const listener of listeners) listener();
}

function attach(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === MATCH_FOCUS_STORAGE_KEY ||
      event.key === IGNORE_PERFORMANCE_STORAGE_KEY
    ) {
      refresh();
    }
  };
  const onChange = () => refresh();
  let motion: MediaQueryList | null = null;
  try {
    motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  } catch {
    motion = null;
  }

  probe = { ...probe, ...readHardware() };
  scheduleSample(FIRST_SAMPLE_DELAY_MS);

  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  window.addEventListener("pageshow", onChange);
  window.addEventListener("storage", onStorage);
  motion?.addEventListener?.("change", onChange);

  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
    window.removeEventListener("pageshow", onChange);
    window.removeEventListener("storage", onStorage);
    motion?.removeEventListener?.("change", onChange);
    cancelSample();
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  };
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!detach) {
    detach = attach();
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detach) {
      detach();
      detach = null;
    }
  };
}

function getSnapshot(): ClientPowerState {
  return current;
}

function getServerSnapshot(): ClientPowerState {
  return SERVER_STATE;
}

/**
 * Abonnement **sans rendu**, pour qui ne lit le régime que dans des refs et des
 * minuteurs. `useClientPower()` re-rend son composant à chaque changement de
 * régime — c'est-à-dire à chaque alt-tab : négligeable pour une pastille, pas
 * pour la page d'un tournoi, dont l'arbre compterait 254 cartes à redessiner.
 */
export function subscribeClientPower(listener: Listener): () => void {
  return subscribe(listener);
}

/** Situation courante, hors React (voir {@link subscribeClientPower}). */
export function getClientPowerInput(): ClientPowerInput {
  return current.input;
}

/** Tout l'état, mesures comprises — pour le témoin. */
export function useClientPowerState(): ClientPowerState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Situation brute : attention, match, préférence de mouvement, performances. */
export function useClientPowerInput(): ClientPowerInput {
  return useClientPowerState().input;
}

/** Ce que la page a le droit de coûter en ce moment. */
export function useClientPower(): ClientPowerPolicy {
  const input = useClientPowerInput();
  return useMemo(() => powerPolicy(input), [input]);
}

/**
 * Ignorer (ou non) la détection de performances. Choix du lecteur, gardé dans
 * ce navigateur : c'est le recours quand la détection se trompe. Les autres
 * onglets le reçoivent par l'évènement `storage`.
 */
export function setIgnorePerformance(ignore: boolean): void {
  try {
    if (ignore) window.localStorage.setItem(IGNORE_PERFORMANCE_STORAGE_KEY, "1");
    else window.localStorage.removeItem(IGNORE_PERFORMANCE_STORAGE_KEY);
  } catch {
    // Stockage indisponible : le choix ne survivra pas, rien de plus.
  }
  refresh(true);
}

/**
 * Déclare que le lecteur a une rencontre en cours (`active`), pour cet onglet
 * **et les autres onglets du site**. Le bail est renouvelé tant que la
 * déclaration tient et rendu au démontage comme à la fermeture de l'onglet.
 */
export function useMatchFocusLease(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const renew = () => {
      writeLeases(Date.now() + MATCH_FOCUS_LEASE_MS);
    };
    const release = () => {
      writeLeases(null);
    };

    localMatchFocus = true;
    renew();
    refresh();
    // Renouvelé à mi-bail : le seul minuteur que coûte un match, un toutes les
    // dix minutes.
    const timer = setInterval(renew, MATCH_FOCUS_LEASE_MS / 2);
    window.addEventListener("pagehide", release);
    // Un onglet restauré depuis le cache de navigation reprend son bail.
    window.addEventListener("pageshow", renew);

    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("pageshow", renew);
      localMatchFocus = false;
      release();
      refresh();
    };
  }, [active]);
}
