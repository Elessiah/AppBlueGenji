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

type CacheEntry = { value: unknown; expiresAt: number };

/**
 * Plafond d'entrées conservées. Les clés sont peu nombreuses et stables
 * (quelques agrégats de la vitrine, un instantané par tournoi consulté) ; le
 * plafond n'est qu'un garde-fou contre une clé construite à partir d'une entrée
 * utilisateur qui aurait échappé à la vigilance.
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

/** Évince les entrées expirées, puis les plus anciennes si le plafond tient encore. */
function evictIfNeeded(now: number): void {
  if (store.size < MAX_ENTRIES) return;

  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }

  // `Map` itère dans l'ordre d'insertion : les premières clés sont les plus
  // anciennes écritures.
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }

  // Un compteur d'invalidation ne sert plus dès que la clé n'est ni en cache ni
  // en vol : le remettre à zéro à ce moment-là ne peut plus fausser personne.
  if (generations.size >= MAX_ENTRIES) {
    for (const key of [...generations.keys()]) {
      if (!store.has(key) && !inflight.has(key)) generations.delete(key);
    }
  }
}

/**
 * Valeur associée à `key`, calculée par `loader` au plus une fois par fenêtre de
 * `ttlMs` — et au plus une fois à la fois.
 *
 * Un `ttlMs` nul ou négatif désactive la mise en cache mais **conserve le vol
 * unique** : c'est le réglage utile pour une donnée qui doit rester exacte tout
 * en supportant une pointe de lecteurs simultanés.
 */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();

  const entry = store.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.value as T;
  }

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const generationAtStart = generationOf(key);
  const promise = (async () => {
    const value = await loader();
    if (ttlMs > 0 && generationOf(key) === generationAtStart) {
      evictIfNeeded(Date.now());
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
    return value;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    // Retiré dans tous les cas : un échec ne doit pas condamner la clé.
    if (inflight.get(key) === promise) inflight.delete(key);
  }
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

/** Vide le cache. Réservé aux tests. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
  generations.clear();
}
