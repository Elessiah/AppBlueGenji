import type { ComponentType } from "react";

/**
 * Filet d'un composant chargé à la demande (`next/dynamic`) sur la fiche
 * tournoi. Le chargement peut survenir des heures après l'ouverture de la page
 * — c'est celle qu'on garde ouverte tout un tournoi — et un déploiement entre
 * les deux supprime les anciens fichiers : le chargement rendrait 404, lèverait
 * un `ChunkLoadError` au rendu et, faute de frontière d'erreur, remplacerait
 * toute la page par l'écran d'erreur de Next.
 *
 * Un échec recharge donc la page, le code neuf étant la seule réparation
 * (`next/dynamic` garde le résultat du chargeur en mémoire : un composant de
 * repli y resterait jusqu'au prochain rechargement complet). Deux bornes :
 * - **jamais sous une modale ouverte** — plusieurs de ces chargements partent
 *   sans geste du lecteur (une vue ou un classement de phase qui paraît avec un
 *   instantané du flux), et recharger ferait perdre une saisie en cours pour un
 *   bloc que personne n'a demandé : le rechargement **attend** qu'elle se ferme
 *   (et que le navigateur soit en ligne), et renonce si le lecteur a changé de
 *   page entre-temps ;
 * - **une fois par minute au plus** — si le fichier manque encore juste après
 *   un rechargement, le déploiement lui-même est en cause, et boucler n'y
 *   changerait rien : le composant reste vide, la page reste debout.
 */

export const LAZY_RELOAD_KEY = "bg_lazy_chunk_reload_at";
export const LAZY_RELOAD_COOLDOWN_MS = 60_000;
const SAFE_POLL_MS = 1_000;

export interface LazyReloadEnv {
  now: () => number;
  readStamp: () => string | null;
  /** Rend `false` si la marque n'a pas pu être écrite. */
  writeStamp: (value: string) => boolean;
  reload: () => void;
  /**
   * Recharger maintenant est sûr : aucune modale ouverte (une saisie peut y
   * être en cours) et le navigateur en ligne (hors ligne, le rechargement
   * tomberait sur la page d'erreur du navigateur au lieu de laisser le flux se
   * reconnecter).
   */
  safeNow: () => boolean;
  /**
   * Rappelle `callback` dès que recharger devient sûr — et jamais si le
   * lecteur a quitté la page entre-temps : on rechargerait alors une autre
   * page, peut-être en pleine saisie.
   */
  whenSafe: (callback: () => void) => void;
}

function browserEnv(): LazyReloadEnv | null {
  if (typeof window === "undefined") return null;
  const safeNow = () =>
    navigator.onLine !== false && document.querySelector('[aria-modal="true"]') === null;
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
    safeNow,
    whenSafe: (callback) => {
      const path = window.location.pathname;
      const timer = window.setInterval(() => {
        if (window.location.pathname !== path) {
          window.clearInterval(timer);
          return;
        }
        if (!safeNow()) return;
        window.clearInterval(timer);
        callback();
      }, SAFE_POLL_MS);
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

/**
 * Recharge la page après un chargement raté — tout de suite si c'est sûr
 * (`safeNow`), sinon dès que ça le devient. Rend `false` quand rien n'est (encore)
 * rechargé.
 */
export function reloadAfterChunkError(env: LazyReloadEnv | null = browserEnv()): boolean {
  if (!env) return false;
  if (!env.safeNow()) {
    env.whenSafe(() => reloadNow(env));
    return false;
  }
  return reloadNow(env);
}

/** Enveloppe le chargement d'un composant : un échec recharge la page et rend un composant vide d'ici là. */
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
