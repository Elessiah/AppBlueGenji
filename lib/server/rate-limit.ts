/**
 * Limiteur de débit à fenêtre fixe, en mémoire du processus.
 *
 * Il existe pour une raison très concrète : rien n'empêche aujourd'hui un
 * navigateur de marteler F5 sur une page dont chaque chargement déclenche
 * plusieurs agrégations SQL. Sur un Raspberry Pi partagé par une centaine de
 * joueurs, c'est le seul geste capable de mettre le site à genoux — sans la
 * moindre intention de nuire.
 *
 * Le cache ({@link lib/server/cache}) rend ces rafales presque gratuites ; le
 * limiteur pose la borne haute qui reste, en refusant poliment (429) plutôt que
 * de laisser la file d'attente du pool MySQL déborder.
 *
 * Volontairement approximatif : compteurs en mémoire, fenêtre fixe, un seul
 * processus. On ne cherche pas l'équité au jeton près, seulement un plafond.
 * Le contrôle et le débit sont **séparés** ({@link checkRateLimit} /
 * {@link chargeRateLimit}) pour les cas où l'on ne veut décompter qu'une action
 * réellement effectuée ; {@link consumeRateLimit} enchaîne les deux.
 */

/** Réglage d'un seau : combien d'actions, sur quelle fenêtre. */
export type RateLimitRule = {
  /** Nom du seau, préfixé aux clés (une route, une action). */
  name: string;
  /** Nombre maximal d'actions décomptées par fenêtre. */
  limit: number;
  /** Durée de la fenêtre, en millisecondes. */
  windowMs: number;
  /**
   * Plafond de clés suivies simultanément pour ce seau, pour que la mémoire
   * reste bornée face à des identités fabriquées.
   */
  maxKeys?: number;
};

const DEFAULT_MAX_KEYS = 10_000;

type Counter = { count: number; resetAt: number };

const counters = new Map<string, Map<string, Counter>>();

function bucketOf(rule: RateLimitRule): Map<string, Counter> {
  let bucket = counters.get(rule.name);
  if (!bucket) {
    bucket = new Map<string, Counter>();
    counters.set(rule.name, bucket);
  }
  return bucket;
}

/**
 * Clé rendue pour une identité absente ou vide. Les appelants qui ne peuvent
 * pas distinguer leurs clients doivent la reconnaître plutôt que de tout
 * compter ensemble — voir `api-guard.enforceRateLimit`.
 */
export const ANONYMOUS_IDENTITY = "anonymous";

/** Clé d'identité normalisée. */
export function rateLimitIdentity(value: string | number | null | undefined): string {
  const text = typeof value === "number" ? String(value) : (value ?? "").trim();
  return text || ANONYMOUS_IDENTITY;
}

/** État courant d'une clé, sans rien décompter. */
export function checkRateLimit(
  rule: RateLimitRule,
  key: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const counter = bucketOf(rule).get(key);
  if (!counter || now >= counter.resetAt) {
    return { allowed: true, remaining: rule.limit, retryAfterMs: 0 };
  }

  const remaining = Math.max(0, rule.limit - counter.count);
  return {
    allowed: remaining > 0,
    remaining,
    retryAfterMs: remaining > 0 ? 0 : counter.resetAt - now,
  };
}

/** Décompte une action. Renvoie l'état après décompte. */
export function chargeRateLimit(
  rule: RateLimitRule,
  key: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const bucket = bucketOf(rule);
  const counter = bucket.get(key);

  if (counter && now < counter.resetAt) {
    counter.count += 1;
    const remaining = Math.max(0, rule.limit - counter.count);
    return {
      allowed: counter.count <= rule.limit,
      remaining,
      retryAfterMs: remaining > 0 ? 0 : counter.resetAt - now,
    };
  }

  // Purge opportuniste : on ne balaie le seau qu'au moment où il déborde, pour
  // ne pas payer un parcours à chaque appel.
  const maxKeys = rule.maxKeys ?? DEFAULT_MAX_KEYS;
  if (bucket.size >= maxKeys) {
    for (const [trackedKey, tracked] of bucket) {
      if (now >= tracked.resetAt) bucket.delete(trackedKey);
    }
    // Toujours plein de fenêtres actives : on repart de zéro plutôt que de
    // laisser la mémoire filer.
    if (bucket.size >= maxKeys) bucket.clear();
  }

  bucket.set(key, { count: 1, resetAt: now + rule.windowMs });
  return { allowed: rule.limit >= 1, remaining: Math.max(0, rule.limit - 1), retryAfterMs: 0 };
}

/**
 * Contrôle **et** décompte en une fois. `allowed: false` signifie que le quota
 * était déjà épuisé : rien n'a été décompté de plus.
 */
export function consumeRateLimit(
  rule: RateLimitRule,
  key: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const state = checkRateLimit(rule, key, now);
  if (!state.allowed) return state;
  return chargeRateLimit(rule, key, now);
}

/**
 * Seau **à jetons** : un débit, pas une fenêtre. La fenêtre fixe laisse passer
 * deux plafonds d'affilée de part et d'autre de sa remise à zéro (60 actions
 * juste avant, 60 juste après : ~120 en une seconde) ; ici, une rafale ne
 * dépasse jamais `capacity`, puis le seau ne rend qu'un jeton par `refillMs`.
 */
export type TokenBucketRule = {
  /** Nom du seau, préfixé aux clés. */
  name: string;
  /** Jetons au plus (la rafale permise). */
  capacity: number;
  /** Délai de retour d'un jeton, en millisecondes. */
  refillMs: number;
  /** Plafond de clés suivies, comme {@link RateLimitRule.maxKeys}. */
  maxKeys?: number;
};

type Tokens = { tokens: number; updatedAt: number };

const tokenBuckets = new Map<string, Map<string, Tokens>>();

function tokenBucketOf(rule: TokenBucketRule): Map<string, Tokens> {
  let bucket = tokenBuckets.get(rule.name);
  if (!bucket) {
    bucket = new Map<string, Tokens>();
    tokenBuckets.set(rule.name, bucket);
  }
  return bucket;
}

/** Jetons disponibles à l'instant (fractions comprises). */
function tokensAt(rule: TokenBucketRule, state: Tokens | undefined, now: number): number {
  if (!state) return rule.capacity;
  return Math.min(rule.capacity, state.tokens + Math.max(0, now - state.updatedAt) / rule.refillMs);
}

function tokenState(rule: TokenBucketRule, tokens: number): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const allowed = tokens >= 1;
  return {
    allowed,
    remaining: Math.floor(tokens),
    retryAfterMs: allowed ? 0 : Math.ceil((1 - tokens) * rule.refillMs),
  };
}

/** Le seau de cette clé permet-il une action ? Rien n'est pris. */
export function peekTokenBucket(
  rule: TokenBucketRule,
  key: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  return tokenState(rule, tokensAt(rule, tokenBucketOf(rule).get(key), now));
}

/** Prend un jeton s'il y en a un ; `allowed: false` : rien n'est pris. */
export function takeTokenBucket(
  rule: TokenBucketRule,
  key: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const bucket = tokenBucketOf(rule);
  const tokens = tokensAt(rule, bucket.get(key), now);
  if (tokens < 1) return tokenState(rule, tokens);
  if (!bucket.has(key) && bucket.size >= (rule.maxKeys ?? DEFAULT_MAX_KEYS)) {
    // Un seau plein vaut un seau absent : on les oublie d'abord, et on repart
    // de zéro si cela ne suffit pas (mémoire bornée).
    for (const [trackedKey, tracked] of bucket) {
      if (tokensAt(rule, tracked, now) >= rule.capacity) bucket.delete(trackedKey);
    }
    if (bucket.size >= (rule.maxKeys ?? DEFAULT_MAX_KEYS)) bucket.clear();
  }
  bucket.set(key, { tokens: tokens - 1, updatedAt: now });
  // Accordé : le dernier jeton pris laisse un seau vide, pas un refus.
  return { ...tokenState(rule, tokens - 1), allowed: true, retryAfterMs: 0 };
}

/** Rend un jeton pris pour une action qui n'a finalement rien coûté. */
export function refundTokenBucket(rule: TokenBucketRule, key: string, now: number = Date.now()): void {
  const bucket = tokenBucketOf(rule);
  const state = bucket.get(key);
  if (!state) return;
  const tokens = Math.min(rule.capacity, tokensAt(rule, state, now) + 1);
  if (tokens >= rule.capacity) bucket.delete(key);
  else bucket.set(key, { tokens, updatedAt: now });
}

/** Vide un seau, ou tous les seaux. Réservé aux tests. */
export function resetRateLimit(ruleName?: string): void {
  if (ruleName === undefined) {
    counters.clear();
    tokenBuckets.clear();
    return;
  }
  counters.delete(ruleName);
  tokenBuckets.delete(ruleName);
}
