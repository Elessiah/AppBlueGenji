import { CodedError, errorCode } from "@/lib/shared/field-errors";

/**
 * Valeur d'une promesse menée par `Promise.allSettled` : son résultat, ou le
 * repli quand elle n'est pas partie (`null`) ou a été refusée — pour envoyer
 * plusieurs gestes indépendants puis dire ce qui a réussi et chaque refus
 * (`settledRefusals`).
 */
export function settledValue<T>(result: PromiseSettledResult<T> | null, fallback: T): T {
  if (result === null || result.status === "rejected") return fallback;
  return result.value;
}

/** Les motifs de refus, dans l'ordre des gestes envoyés (aucun : tout a réussi ou rien n'est parti). */
export function settledRefusals(...results: (PromiseSettledResult<unknown> | null)[]): unknown[] {
  return results.flatMap((result) => (result?.status === "rejected" ? [result.reason] : []));
}

/**
 * Un seul refus est rendu tel quel ; plusieurs en font une seule erreur dont le
 * texte les dit tous (la notification lit `message`) et dont le code est celui
 * du premier — aucun refus n'en cache un autre.
 */
export function mergeRefusals(refusals: unknown[]): unknown {
  if (refusals.length <= 1) return refusals[0];
  const messages = refusals.map((reason) => (reason instanceof Error ? reason.message : ""));
  return new CodedError(errorCode(refusals[0]) ?? "UNKNOWN", messages.filter(Boolean).join(" "));
}
