import { refundTokenBucket, takeTokenBucket, type TokenBucketRule } from "@/lib/server/rate-limit";

/**
 * Jetons restants d'une clé, sans en consommer : un jeton est pris puis rendu
 * (le seau ne sait plus lire sans prendre, `peekTokenBucket` ayant été retiré
 * faute d'appelant en production).
 */
export function tokensLeft(rule: TokenBucketRule, key: string, now: number = Date.now()): number {
  const taken = takeTokenBucket(rule, key, now);
  if (!taken.allowed) return taken.remaining;
  refundTokenBucket(rule, key, now);
  return taken.remaining + 1;
}
