import type { ComponentType } from "react";

/**
 * Filet d'un composant chargé à la demande (`next/dynamic`) : fiche tournoi,
 * fenêtre de lancement de la mise en page racine (`MatchLaunchCenterLazy`).
 * Le chargement peut survenir des heures après l'ouverture de la page
 * — la fiche se garde ouverte tout un tournoi — et un déploiement entre
 * les deux supprime les anciens fichiers : le chargement rendrait 404, lèverait
 * un `ChunkLoadError` au rendu et, faute de frontière d'erreur, remplacerait
 * toute la page par l'écran d'erreur de Next.
 *
 * Un échec recharge donc la page, le code neuf étant la seule réparation
 * (`next/dynamic` garde le résultat du chargeur en mémoire : un composant de
 * repli y resterait jusqu'au prochain rechargement complet). Trois bornes :
 * - **seulement quand c'est sûr** — plusieurs de ces chargements partent sans
 *   geste du lecteur (une vue ou un classement de phase qui paraît avec un
 *   instantané du flux) : le rechargement attend qu'aucune modale ne soit
 *   ouverte (une saisie peut y être en cours) et que le site **réponde**
 *   (`navigator.onLine` reste vrai sur un Wi-Fi sans Internet : recharger
 *   pendant une coupure mènerait à la page d'erreur du navigateur, là où le
 *   flux se serait reconnecté seul) ;
 * - **sur la page qui a échoué** — si le lecteur l'a quittée entre-temps, on
 *   renonce : on rechargerait une autre page, peut-être en pleine saisie ;
 * - **une fois par minute au plus** — si le fichier manque encore juste après
 *   un rechargement, le déploiement lui-même est en cause, et boucler n'y
 *   changerait rien : le composant reste vide, la page reste debout.
 */

export const LAZY_RELOAD_KEY = "bg_lazy_chunk_reload_at";
export const LAZY_RELOAD_COOLDOWN_MS = 60_000;
const SAFE_POLL_MS = 2_000;

export interface LazyReloadEnv {
  now: () => number;
  readStamp: () => string | null;
  /** Rend `false` si la marque n'a pas pu être écrite. */
  writeStamp: (value: string) => boolean;
  reload: () => void;
  /** Rappelle `callback` dès que recharger est sûr (voir plus haut), jamais si la page a changé. */
  whenSafe: (callback: () => void) => void;
}

function browserEnv(): LazyReloadEnv | null {
  if (typeof window === "undefined") return null;
  const noModal = () => document.querySelector('[aria-modal="true"]') === null;
  const siteResponds = async () => {
    try {
      const response = await fetch(window.location.pathname, { method: "HEAD", cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  };
  return {
    now: () => Date.now(),
    readStamp: () => {
      try {
        return window.sessionStorage.getItem(LAZY_RELOAD_KEY);
      } catch {
        return null;
      }
    },
    writeStamp: (value) => {
      try {
        window.sessionStorage.setItem(LAZY_RELOAD_KEY, value);
        return true;
      } catch {
        return false;
      }
    },
    reload: () => window.location.reload(),
    whenSafe: (callback) => {
      const path = window.location.pathname;
      const check = async () => {
        if (window.location.pathname !== path) return;
        if (noModal() && navigator.onLine !== false && (await siteResponds())) {
          if (window.location.pathname === path && noModal()) {
            callback();
            return;
          }
        }
        window.setTimeout(() => void check(), SAFE_POLL_MS);
      };
      void check();
    },
  };
}

function reloadNow(env: LazyReloadEnv): boolean {
  const last = Number(env.readStamp());
  const now = env.now();
  if (Number.isFinite(last) && last > 0 && now - last < LAZY_RELOAD_COOLDOWN_MS) return false;
  // Sans marque écrite, rien ne bornerait les rechargements suivants (stockage
  // bloqué) : mieux vaut un composant vide qu'une page qui recharge en boucle.
  if (!env.writeStamp(String(now))) return false;
  env.reload();
  return true;
}

/**
 * Le chargement a échoué faute de fichier (déploiement, réseau) — le seul cas
 * qu'un rechargement répare. Une erreur levée par le module lui-même (un bogue)
 * n'en est pas un : elle doit remonter, pas se déguiser en composant vide.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ChunkLoadError") return true;
  return /Loading (CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    error.message,
  );
}

/** Un chargement à la demande, fait une fois et gardé (`onceLoader`). */
export interface OnceLoader<T> {
  /** Lance le chargement, ou rend celui en cours ; un échec se retente à l'appel suivant. */
  load(): Promise<T>;
  /** Le résultat, s'il est arrivé ; `null` sinon. */
  loaded(): T | null;
  /** Fournit le résultat d'avance (déjà reçu autrement) : aucun chargement ne partira. */
  prime(value: T): void;
}

/**
 * Un seul chargement, partagé par le préchargement (survol, focus) et
 * l'ouverture : la requête en cours sert tous les appels, le résultat est
 * gardé, un échec n'est **pas** gardé — le geste suivant retente.
 */
export function onceLoader<T>(start: () => Promise<T>): OnceLoader<T> {
  let result: { value: T } | null = null;
  let pending: Promise<T> | null = null;
  return {
    load() {
      pending ??= start().then(
        (value) => {
          result = { value };
          return value;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      return pending;
    },
    loaded: () => (result ? result.value : null),
    prime(value) {
      result ??= { value };
    },
  };
}

/** Silence d'un préchargement raté avant qu'un geste le relance. */
export const PRELOAD_RETRY_MS = 30_000;

/**
 * Un préchargement (survol, focus, clic sur un sélecteur de fichier) qui, raté
 * — hors ligne, déploiement —, se tait `PRELOAD_RETRY_MS` au lieu de repartir
 * à chaque geste, puis se relance de lui-même au geste suivant : une coupure
 * passagère n'éteint pas le préchargement pour toute la session. L'ouverture,
 * elle, retente toujours et dit l'échec.
 */
export function quietPreload(load: () => Promise<unknown>, now: () => number = Date.now): () => void {
  let failedAt: number | null = null;
  return () => {
    if (failedAt !== null && now() - failedAt < PRELOAD_RETRY_MS) return;
    load().then(
      () => {
        failedAt = null;
      },
      () => {
        failedAt = now();
      },
    );
  };
}

/** Programme le rechargement de la page après un chargement raté, dès qu'il est sûr. */
export function reloadAfterChunkError(env: LazyReloadEnv | null = browserEnv()): void {
  if (!env) return;
  env.whenSafe(() => reloadNow(env));
}

/** Enveloppe le chargement d'un composant : un fichier manquant recharge la page et rend un composant vide d'ici là. */
export function orReload<P>(
  load: Promise<ComponentType<P>>,
  env?: LazyReloadEnv | null,
): Promise<ComponentType<P>> {
  return load.catch((error: unknown) => {
    if (!isChunkLoadError(error)) throw error;
    reloadAfterChunkError(env === undefined ? browserEnv() : env);
    const Empty: ComponentType<P> = () => null;
    return Empty;
  });
}
