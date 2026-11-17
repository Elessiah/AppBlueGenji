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
 * **Trois réserves bornées**, éviction LRU chacune :
 * - `fixed` : les cartes en nombre fini (pages, modes de règles, podium, carte
 *   générique d'équipe, dans chaque langue) — jamais chassées par les autres ;
 * - `team` : les cartes nominatives, une par équipe du classement public ;
 * - `embed` : les cartes d'un tournoi ou d'un match partagé (`SHARE_EMBEDS.md`),
 *   une par contenu dessiné (l'empreinte est dans la clé).
 *
 * Et **au plus `MAX_CONCURRENT_RENDERS` rendus à la fois** : un robot qui fait
 * tourner plus d'équipes que la réserve n'en garde n'obtient que des réponses
 * plus lentes, jamais un processeur saturé (le site tourne sur un Raspberry Pi).
 */
import { cached, invalidateCachedPrefix, isCachedOrLoading } from "./cache";

export type ShareImagePool = "fixed" | "team" | "embed";

/**
 * Plafond de chaque réserve : une centaine de Ko par carte. `embed` en garde
 * plus : un tableau de 63 matchs partagé en deux langues fait déjà 126 cartes,
 * et chaque score saisi laisse l'ancienne version dans la réserve jusqu'à son
 * éviction (192 cartes : une vingtaine de Mo au plus).
 */
export const SHARE_IMAGE_POOL_LIMITS: Readonly<Record<ShareImagePool, number>> = { fixed: 128, team: 64, embed: 192 };

/** Rendus simultanés au plus (Satori + `sharp`), toutes cartes confondues. */
export const MAX_CONCURRENT_RENDERS = 2;

export type CachedShareImage = { body: ArrayBuffer; cacheControl: string };

/**
 * Un PNG déjà lu, que `build` rend à la place d'une `Response` (pas de seconde
 * copie du tampon). `ttlMs` raccourcit la garde de cette image-là — une carte
 * de repli (`DEGRADED_SHARE_IMAGE_TTL_MS`) ne survit pas des heures à un échec
 * peut-être passager.
 */
export type ShareImageRender = CachedShareImage & { ttlMs?: number };

/** Garde d'une carte de repli (dessinée sans ses lettres de droite à gauche). */
export const DEGRADED_SHARE_IMAGE_TTL_MS = 10 * 60_000;

/**
 * Garde d'un **nouveau** rendu (ni en mémoire, ni en vol) : la réserve `embed`
 * a des clés en nombre ouvert (un tournoi, un match, une langue), qu'un client
 * peut parcourir plus vite que la réserve ne les garde.
 * - `client` : réseau de la requête (`clientNetworkKey`, ou une clé commune
 *   « inconnu ») ; sert au partage de la file.
 * - `admit` : le plafond du réseau (`SHARE_EMBED_RENDER_RULE`) ; `false` :
 *   refusé, aucun rendu.
 * - `refund` : rend le jeton pris par `admit` quand le rendu n'a rien produit
 *   (`build` rend `null` : rien n'a été dessiné). Un rendu qui **échoue** a,
 *   lui, coûté Satori : son jeton n'est pas rendu (sinon une carte cassée se
 *   ferait rendre en boucle sans plafond).
 * - `maxQueued` : rendus **de cette réserve** déjà en attente d'une place
 *   au-delà desquels on refuse plutôt que d'allonger la file (les attentes des
 *   autres réserves ne comptent pas : un parcours des cartes d'équipe ne fait
 *   pas refuser l'aperçu d'un match).
 * - `maxQueuedPerClient` : attentes d'un même réseau, au plus — un client qui
 *   insiste ne remplit pas seul la file des autres.
 */
export type ShareRenderAdmission = {
  client: string;
  admit: () => boolean;
  refund: () => void;
  maxQueued: number;
  maxQueuedPerClient: number;
};

/** Rendus d'aperçu de tournoi ou de match en attente d'une place, au plus. */
export const MAX_QUEUED_EMBED_RENDERS = 8;

/** Rendus d'aperçu en attente d'une place pour un même réseau, au plus. */
export const MAX_QUEUED_EMBED_RENDERS_PER_CLIENT = 2;

/** Rendus en attente d'une place, toutes réserves ou une seule (tests). */
export function queuedShareRenders(pool?: ShareImagePool): number {
  return pool === undefined ? waiting.length : waiting.filter((entry) => entry.pool === pool).length;
}

/** Attentes de `client` dans la réserve `pool`. */
function queuedFor(pool: ShareImagePool, client: string): number {
  let count = 0;
  for (const entry of waiting) if (entry.pool === pool && entry.client === client) count += 1;
  return count;
}

type Entry = CachedShareImage & { expiresAt: number; followsRanking: boolean };

const pools: Record<ShareImagePool, Map<string, Entry>> = { fixed: new Map(), team: new Map(), embed: new Map() };

/**
 * Compteur d'invalidation des cartes tirées du classement : un rendu lancé
 * avant {@link invalidateRankingShareImages} et fini après ne doit pas être
 * gardé — il porte l'ancien nom, l'ancien logo ou l'ancien podium.
 */
let rankingGeneration = 0;

/** Préfixe du vol unique des cartes tirées du classement (vidé avec elles). */
const RANKING_FLIGHT_PREFIX = "share-image:ranking:";

/**
 * Durée au plus pendant laquelle une attente garde le réseau de sa requête
 * (`client`, une adresse IP ou un /64) : un rendu bloqué (Satori, `sharp`)
 * ne doit pas le retenir au-delà des deux minutes promises par le registre
 * (T03). Passé ce délai, l'attente continue mais n'est plus rattachée à aucun
 * réseau (elle ne compte plus dans sa part de la file).
 */
export const MAX_RENDER_WAIT_CLIENT_MS = 30_000;

let activeRenders = 0;
type Waiter = { resolve: () => void; pool: ShareImagePool; client: string | null };
const waiting: Waiter[] = [];

/** Réseaux encore rattachés à une attente (tests). */
export function queuedShareRenderClients(): (string | null)[] {
  return waiting.map((entry) => entry.client);
}

function waitForRenderSlot(pool: ShareImagePool, client: string | null): Promise<void> {
  return new Promise<void>((resolve) => {
    const waiter: Waiter = { resolve, pool, client };
    if (client !== null) {
      const forget = setTimeout(() => {
        waiter.client = null;
      }, MAX_RENDER_WAIT_CLIENT_MS);
      forget.unref?.();
      waiter.resolve = () => {
        clearTimeout(forget);
        resolve();
      };
    }
    waiting.push(waiter);
  });
}

async function withRenderSlot<T>(task: () => Promise<T>, pool: ShareImagePool, client: string | null): Promise<T> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await waitForRenderSlot(pool, client);
  } else {
    activeRenders += 1;
  }
  try {
    return await task();
  } finally {
    // La place passe directement au suivant : le compte ne bouge pas.
    const next = waiting.shift();
    if (next) next.resolve();
    else activeRenders -= 1;
  }
}

/** File de la réserve, part du réseau, puis jeton : un refus de file ne prend pas de jeton. */
function admitsNewRender(pool: ShareImagePool, admission: ShareRenderAdmission): boolean {
  if (queuedShareRenders(pool) >= admission.maxQueued) return false;
  if (queuedFor(pool, admission.client) >= admission.maxQueuedPerClient) return false;
  return admission.admit();
}

/**
 * Le PNG de la carte `key`, rendu par `build` au plus une fois par `ttlMs` ;
 * `null` si `build` n'en rend pas (rien n'est alors gardé), ou si
 * `admission` refuse un nouveau rendu. Un échec n'est jamais gardé : la
 * requête suivante retente.
 */
export async function cachedShareImage(
  key: string,
  ttlMs: number,
  build: () => Promise<Response | ShareImageRender | null>,
  pool: ShareImagePool = "fixed",
  followsRanking = false,
  admission?: ShareRenderAdmission,
): Promise<CachedShareImage | null> {
  const store = pools[pool];
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    store.delete(key);
    store.set(key, hit);
    return hit;
  }
  const generationAtStart = rankingGeneration;
  const flightKey = `${followsRanking ? RANKING_FLIGHT_PREFIX : "share-image:"}${pool}:${key}`;
  // Rejoindre un rendu en vol ne coûte rien ; un nouveau rendu passe la garde
  // (file d'abord : un refus pour file pleine ne prend pas de jeton).
  // File de la réserve et part du réseau d'abord : un refus pour file pleine
  // ne prend pas de jeton.
  let guarded: ShareRenderAdmission | null = null;
  if (admission && !isCachedOrLoading(flightKey)) {
    if (!admitsNewRender(pool, admission)) return null;
    guarded = admission;
  }
  const image = await cached(flightKey, 0, () =>
    withRenderSlot(
      async () => {
        const response = await build();
        if (!response) {
          guarded?.refund();
          return null;
        }
        if (!(response instanceof Response)) return response;
        return { body: await response.arrayBuffer(), cacheControl: response.headers.get("cache-control") ?? "" };
      },
      pool,
      guarded?.client ?? null,
    ),
  );
  if (!image) return null;
  const { ttlMs: imageTtlMs, ...kept } = image as ShareImageRender;
  // Invalidée pendant le rendu : servie à qui l'attendait, jamais gardée.
  if (followsRanking && rankingGeneration !== generationAtStart) return kept;
  store.delete(key);
  while (store.size >= SHARE_IMAGE_POOL_LIMITS[pool]) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  const keptMs = imageTtlMs === undefined ? ttlMs : Math.min(ttlMs, imageTtlMs);
  store.set(key, { ...kept, expiresAt: Date.now() + keptMs, followsRanking });
  return kept;
}

/**
 * Oublie les cartes **tirées du classement** (`followsRanking` : podium, carte
 * nominative d'une équipe), rendues ou en cours de rendu. Appelé avec le cache
 * du classement (`ranking-cache.ts`) : un score, un renommage, un logo changé ou
 * une dissolution ne restent pas une minute de plus sur l'aperçu. Les cartes
 * fixes (pages, règles, carte générique) ne bougent qu'au déploiement : elles
 * restent.
 */
export function invalidateRankingShareImages(): void {
  rankingGeneration += 1;
  for (const store of Object.values(pools)) {
    for (const [key, entry] of [...store]) {
      if (entry.followsRanking) store.delete(key);
    }
  }
  // Un rendu en vol n'est plus rejoint : la requête suivante en relance un.
  invalidateCachedPrefix(RANKING_FLIGHT_PREFIX);
}

/** Vide le cache des cartes (tests). */
export function clearShareImageCache(): void {
  pools.fixed.clear();
  pools.team.clear();
  pools.embed.clear();
}
