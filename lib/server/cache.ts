/**
 * Cache mémoire à durée de vie courte, avec **vol unique** (single-flight).
 *
 * Le site tourne sur un Raspberry Pi : le danger n'est pas la requête coûteuse,
 * c'est la même requête coûteuse lancée cent fois en même temps. Trois causes
 * en produisent ici :
 * - le F5 en rafale sur la page d'accueil, rendue dynamiquement ;
 * - le sondage périodique d'un bandeau « en direct » par chaque visiteur ;
 * - un événement de tournoi qui réveille tous les spectateurs d'un coup.
 *
 * `cached()` répond aux deux : une valeur encore fraîche est resservie telle
 * quelle, et **les appels concurrents sur une clé froide partagent le même
 * calcul** au lieu d'en lancer un chacun. Cent lecteurs simultanés coûtent une
 * requête SQL.
 *
 * Volontairement en mémoire de processus : l'application tourne en un seul
 * processus Node, et une dépendance de plus (Redis) sur cette machine coûterait
 * plus qu'elle ne rapporte. Un échec n'est jamais mis en cache — la tentative
 * suivante retente.
 */

/**
 * `expiresAt` : fin de la durée de vie (la valeur est servie par `cached`).
 * `retainUntil` : fin de la conservation — égale à `expiresAt`, sauf pour une
 * clé écrite avec `retainMs`, que {@link cachedStale} sert encore après son
 * échéance (réponse publique d'un tournoi, servie périmée au refus).
 */
type CacheEntry = { value: unknown; expiresAt: number; retainUntil: number };

/**
 * Pas de la purge des entrées échues. Le plafond ne suffit pas : sous lui, une
 * entrée expirée restait en mémoire jusqu'à ce que 500 clés soient écrites —
 * un parcours de tournois laissait ainsi des instantanés entiers (~1 Mo chacun)
 * bien après leur durée de vie de quelques secondes. La purge passe au plus une
 * fois par pas, à l'écriture : un parcours de 500 entrées au plus, rien de plus.
 */
export const CACHE_SWEEP_INTERVAL_MS = 10_000;
let lastSweepAt = 0;

/**
 * Plafond d'entrées conservées. Deux familles de clés s'y côtoient : quelques
 * agrégats **partagés** et chers (liste publique, rejeu du classement, vitrine,
 * un instantané par tournoi consulté) et des clés **par compte** (`terms-need:`
 * à chaque page vue, fiches `player:` et `team:`), bien plus nombreuses lors
 * d'un gros évènement.
 *
 * L'éviction est donc **LRU** et non par ordre d'insertion : une entrée
 * partagée, relue à chaque page, reste en tête et ne se fait pas chasser par
 * une rafale de clés par compte lues une seule fois — ce qui la ferait
 * recalculer pour rien avant son échéance.
 */
const MAX_ENTRIES = 500;

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Compteur d'invalidations par clé. Un calcul en vol retient le compteur au
 * moment de son départ et ne conserve son résultat que s'il n'a pas bougé :
 * sans cela, une écriture survenue *pendant* la lecture verrait la valeur
 * d'avant s'installer en cache juste après elle.
 */
const generations = new Map<string, number>();

function generationOf(key: string): number {
  return generations.get(key) ?? 0;
}

/**
 * Chargeurs encore en vol, par clé.
 *
 * `inflight` ne peut pas en tenir lieu : `invalidateCached` l'en retire
 * justement pour que les lecteurs suivants repartent sur un calcul neuf. Sans
 * ce compte, la purge des compteurs ci-dessous supprimerait celui d'une clé
 * encore en vol et le ramènerait ainsi à zéro — soit la génération de départ du
 * chargeur, qui rangerait alors en cache la valeur lue **avant** l'écriture,
 * exactement ce que le compteur existe pour empêcher.
 */
const pending = new Map<string, number>();

function retainPending(key: string): void {
  pending.set(key, (pending.get(key) ?? 0) + 1);
}

function releasePending(key: string): void {
  const current = pending.get(key) ?? 0;
  if (current <= 1) pending.delete(key);
  else pending.set(key, current - 1);
}

/** Retire les entrées dont la conservation est échue. */
function sweepExpired(now: number): void {
  lastSweepAt = now;
  for (const [key, entry] of store) {
    if (entry.retainUntil <= now) store.delete(key);
  }
}

/**
 * Purge les entrées échues (au plus une fois par {@link CACHE_SWEEP_INTERVAL_MS},
 * ou dès que le plafond est atteint), puis évince les moins récemment lues si
 * le plafond tient encore.
 */
function evictIfNeeded(now: number): void {
  if (store.size < MAX_ENTRIES) {
    if (now - lastSweepAt >= CACHE_SWEEP_INTERVAL_MS) sweepExpired(now);
    return;
  }

  sweepExpired(now);

  // `Map` itère dans l'ordre d'insertion, et une lecture réinsère sa clé
  // (`cached`) : les premières clés sont les moins récemment servies.
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }

  // Un compteur d'invalidation ne sert plus dès que la clé n'est ni en cache ni
  // en vol : le remettre à zéro à ce moment-là ne peut plus fausser personne.
  // `pending` en plus de `inflight` : une clé invalidée pendant sa lecture a
  // quitté `inflight` alors que son chargeur, lui, va encore comparer son
  // compteur au retour.
  if (generations.size >= MAX_ENTRIES) {
    for (const key of generations.keys()) {
      if (!store.has(key) && !inflight.has(key) && !pending.has(key)) generations.delete(key);
    }
  }
}

/** Réglages facultatifs de {@link cached}. */
export type CachedOptions = {
  /**
   * Appelé **juste avant** le chargeur, de façon synchrone, et seulement quand
   * cet appel le lance (ni valeur fraîche ni calcul en vol) : c'est là qu'un
   * appelant fait payer le calcul qu'il provoque, sans écart possible entre ce
   * contrôle et le lancement. S'il lève, rien n'est lancé ni mis en vol, et
   * l'erreur ne touche que cet appel.
   */
  beforeLoad?: () => void;
  /**
   * Conservation, depuis l'écriture, au-delà de la durée de vie : la valeur
   * reste lisible par {@link cachedStale} jusque-là (jamais par `cached`).
   */
  retainMs?: number;
};

/**
 * Valeur associée à `key`, calculée par `loader` au plus une fois par fenêtre de
 * `ttlMs` — et au plus une fois à la fois.
 *
 * Un `ttlMs` nul ou négatif désactive la mise en cache mais **conserve le vol
 * unique** : c'est le réglage utile pour une donnée qui doit rester exacte tout
 * en supportant une pointe de lecteurs simultanés. Une fonction le calcule
 * d'après la valeur obtenue (une durée selon l'état d'un tournoi).
 */
export async function cached<T>(
  key: string,
  ttlMs: number | ((value: T) => number),
  loader: () => Promise<T>,
  options: CachedOptions = {},
): Promise<T> {
  const now = Date.now();

  const entry = store.get(key);
  if (entry && entry.expiresAt > now) {
    // Relue : repasse en fin d'ordre, loin de l'éviction.
    store.delete(key);
    store.set(key, entry);
    return entry.value as T;
  }

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  options.beforeLoad?.();

  const generationAtStart = generationOf(key);
  retainPending(key);
  const promise = (async () => {
    const value = await loader();
    const lifeMs = typeof ttlMs === "function" ? ttlMs(value) : ttlMs;
    if (lifeMs > 0 && generationOf(key) === generationAtStart) {
      // Retirée d'abord : `Map.set` sur une clé présente (valeur expirée) la
      // laisserait à sa place d'origine, en tête de l'éviction.
      store.delete(key);
      const writtenAt = Date.now();
      evictIfNeeded(writtenAt);
      const expiresAt = writtenAt + lifeMs;
      store.set(key, { value, expiresAt, retainUntil: Math.max(expiresAt, writtenAt + (options.retainMs ?? 0)) });
    }
    return value;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    // Retiré dans tous les cas : un échec ne doit pas condamner la clé.
    if (inflight.get(key) === promise) inflight.delete(key);
    // Après `inflight` : le compteur doit rester protégé tant que le chargeur
    // peut encore le lire, c'est-à-dire jusqu'ici.
    releasePending(key);
  }
}

/**
 * Dernière valeur écrite pour `key`, **même échue**, tant que sa conservation
 * (`retainMs` de {@link cached}) court ; `undefined` sinon. Pour servir une
 * réponse périmée, bornée, quand le calcul est refusé. Ne change pas l'ordre
 * d'éviction : une valeur seulement relue périmée part la première.
 */
export function cachedStale<T>(key: string, now: number = Date.now()): T | undefined {
  const entry = store.get(key);
  return entry !== undefined && entry.retainUntil > now ? (entry.value as T) : undefined;
}

/**
 * Oublie une clé. À appeler dès qu'une écriture rend la valeur fausse — c'est
 * ce qui permet de garder des durées de vie confortables sans jamais afficher
 * un score périmé.
 *
 * Le calcul déjà en vol n'est pas annulé — ses lecteurs recevront la valeur
 * lue avant l'écriture —, mais son résultat ne sera pas conservé.
 */
export function invalidateCached(key: string): void {
  store.delete(key);
  inflight.delete(key);
  generations.set(key, generationOf(key) + 1);
}

/** Oublie toutes les clés commençant par `prefix`. */
export function invalidateCachedPrefix(prefix: string): void {
  const keys = new Set([...store.keys(), ...inflight.keys()]);
  for (const key of keys) {
    if (key.startsWith(prefix)) invalidateCached(key);
  }
}

/**
 * `key` a-t-elle une valeur encore fraîche, ou un calcul en vol ? Si oui, un
 * appel à `cached` sur cette clé ne lancerait pas son chargeur : c'est ce qui
 * permet de ne faire payer à un appelant que les calculs qu'il provoque.
 */
export function isCachedOrLoading(key: string, now: number = Date.now()): boolean {
  const entry = store.get(key);
  return (entry !== undefined && entry.expiresAt > now) || inflight.has(key);
}

/** Entrées gardées, échues comprises. Réservé aux tests (purge). */
export function cachedEntryCount(): number {
  return store.size;
}

/** Vide le cache. Réservé aux tests. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
  generations.clear();
  pending.clear();
  lastSweepAt = 0;
}
