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
 * **Borné** : `SHARE_IMAGE_CACHE_MAX_ENTRIES` cartes au plus, éviction LRU. Une
 * clé n'entre ici que si elle désigne une carte réelle — les cartes fixes (une
 * quarantaine par langue) et les équipes du classement public ; une équipe
 * inconnue partage la carte générique `team`. Un robot qui énumère des
 * identifiants ne remplit donc ni la mémoire ni le processeur.
 */
import { cached } from "./cache";

/** Plafond : une centaine de Ko par carte, quelques Mo en tout. */
export const SHARE_IMAGE_CACHE_MAX_ENTRIES = 96;

export type CachedShareImage = { body: ArrayBuffer; cacheControl: string };

type Entry = CachedShareImage & { expiresAt: number };

const store = new Map<string, Entry>();

/**
 * Le PNG de la carte `key`, rendu par `build` au plus une fois par `ttlMs` ;
 * `null` si `build` n'en rend pas (rien n'est alors gardé). Un échec n'est
 * jamais gardé : la requête suivante retente.
 */
export async function cachedShareImage(
  key: string,
  ttlMs: number,
  build: () => Promise<Response | null>,
): Promise<CachedShareImage | null> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    store.delete(key);
    store.set(key, hit);
    return hit;
  }
  const image = await cached(`share-image:${key}`, 0, async () => {
    const response = await build();
    if (!response) return null;
    return { body: await response.arrayBuffer(), cacheControl: response.headers.get("cache-control") ?? "" };
  });
  if (!image) return null;
  store.delete(key);
  while (store.size >= SHARE_IMAGE_CACHE_MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  store.set(key, { ...image, expiresAt: now + ttlMs });
  return image;
}

/** Vide le cache des cartes (tests). */
export function clearShareImageCache(): void {
  store.clear();
}
