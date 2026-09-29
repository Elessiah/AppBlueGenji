import type { ComponentType } from "react";

/**
 * Filet d'un composant chargé à la demande (`next/dynamic`) sur la fiche
 * tournoi. Le chargement peut survenir des heures après l'ouverture de la page
 * — c'est celle qu'on garde ouverte tout un tournoi — et un déploiement entre
 * les deux supprime les anciens fichiers : le chargement rendrait 404, lèverait
 * un `ChunkLoadError` au rendu et, faute de frontière d'erreur, remplacerait
 * toute la page par l'écran d'erreur de Next.
 *
 * Un échec recharge donc la page (le code neuf est la seule réparation), **une
 * fois par minute au plus** — un réseau réellement coupé ne doit pas la faire
 * boucler. Au-delà, le composant est remplacé par un rendu vide : le dialogue
 * ne s'ouvre pas, mais la page reste.
 */

export const LAZY_RELOAD_KEY = "bg_lazy_chunk_reload_at";
export const LAZY_RELOAD_COOLDOWN_MS = 60_000;

export interface LazyReloadEnv {
  now: () => number;
  readStamp: () => string | null;
  writeStamp: (value: string) => void;
  reload: () => void;
}

function browserEnv(): LazyReloadEnv | null {
  if (typeof window === "undefined") return null;
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
      } catch {
        // Stockage indisponible : on recharge quand même, une fois.
      }
    },
    reload: () => window.location.reload(),
  };
}

/** Recharge la page si aucun rechargement de ce type n'a eu lieu depuis une minute. */
export function reloadAfterChunkError(env: LazyReloadEnv | null = browserEnv()): boolean {
  if (!env) return false;
  const last = Number(env.readStamp());
  const now = env.now();
  if (Number.isFinite(last) && last > 0 && now - last < LAZY_RELOAD_COOLDOWN_MS) return false;
  env.writeStamp(String(now));
  env.reload();
  return true;
}

/** Enveloppe le chargement d'un composant : un échec recharge la page ou rend un composant vide. */
export function orReload<P>(
  load: Promise<ComponentType<P>>,
  env?: LazyReloadEnv | null,
): Promise<ComponentType<P>> {
  return load.catch(() => {
    reloadAfterChunkError(env === undefined ? browserEnv() : env);
    const Empty: ComponentType<P> = () => null;
    return Empty;
  });
}
