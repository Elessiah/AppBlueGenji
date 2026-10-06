/**
 * Les PNG des cartes d'aperçu, gardés en mémoire du processus
 * (`docs/features/SHARE_METADATA.md` § « Coût d'un rendu »).
 *
 * Un lien collé dans un gros salon fait venir plusieurs robots d'aperçu en
 * même temps, et la route `/og/…` est dynamique : sans ce cache, chacun relance
 * Satori (et `sharp` pour un logo). Ici, une carte se rend **une fois** par
 * fenêtre — et une seule fois à la fois (vol unique de `cached`, sans
 * stockage dans le cache général : des PNG de 100 Ko y chasseraient les
 * agrégats partagés).
 *
 * **Deux réserves bornées**, éviction LRU chacune :
 * - `fixed` : les cartes en nombre fini (pages, modes de règles, podium, carte
 *   générique d'équipe, dans chaque langue) — jamais chassées par les autres ;
 * - `team` : les cartes nominatives, une par équipe du classement public.
 *
 * Et **au plus `MAX_CONCURRENT_RENDERS` rendus à la fois** : un robot qui fait
 * tourner plus d'équipes que la réserve n'en garde n'obtient que des réponses
 * plus lentes, jamais un processeur saturé (le site tourne sur un Raspberry Pi).
 */
import { cached } from "./cache";

export type ShareImagePool = "fixed" | "team";

/** Plafond de chaque réserve : une centaine de Ko par carte. */
export const SHARE_IMAGE_POOL_LIMITS: Readonly<Record<ShareImagePool, number>> = { fixed: 128, team: 64 };

/** Rendus simultanés au plus (Satori + `sharp`), toutes cartes confondues. */
export const MAX_CONCURRENT_RENDERS = 2;

export type CachedShareImage = { body: ArrayBuffer; cacheControl: string };

type Entry = CachedShareImage & { expiresAt: number };

const pools: Record<ShareImagePool, Map<string, Entry>> = { fixed: new Map(), team: new Map() };

let activeRenders = 0;
const waiting: Array<() => void> = [];

async function withRenderSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    activeRenders += 1;
  }
  try {
    return await task();
  } finally {
    // La place passe directement au suivant : le compte ne bouge pas.
    const next = waiting.shift();
    if (next) next();
    else activeRenders -= 1;
  }
}

/**
 * Le PNG de la carte `key`, rendu par `build` au plus une fois par `ttlMs` ;
 * `null` si `build` n'en rend pas (rien n'est alors gardé). Un échec n'est
 * jamais gardé : la requête suivante retente.
 */
export async function cachedShareImage(
  key: string,
  ttlMs: number,
  build: () => Promise<Response | null>,
  pool: ShareImagePool = "fixed",
): Promise<CachedShareImage | null> {
  const store = pools[pool];
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    store.delete(key);
    store.set(key, hit);
    return hit;
  }
  const image = await cached(`share-image:${pool}:${key}`, 0, () =>
    withRenderSlot(async () => {
      const response = await build();
      if (!response) return null;
      return { body: await response.arrayBuffer(), cacheControl: response.headers.get("cache-control") ?? "" };
    }),
  );
  if (!image) return null;
  store.delete(key);
  while (store.size >= SHARE_IMAGE_POOL_LIMITS[pool]) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  store.set(key, { ...image, expiresAt: Date.now() + ttlMs });
  return image;
}

/** Vide le cache des cartes (tests). */
export function clearShareImageCache(): void {
  pools.fixed.clear();
  pools.team.clear();
}
