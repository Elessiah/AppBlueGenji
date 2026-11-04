/**
 * Valeur d'une promesse menée par `Promise.allSettled` : son résultat, le
 * repli quand elle n'est pas partie (`null`), son refus relancé sinon — pour
 * envoyer plusieurs gestes indépendants puis dire le premier refus.
 */
export function settledValue<T>(result: PromiseSettledResult<T> | null, fallback: T): T {
  if (result === null) return fallback;
  if (result.status === "rejected") throw result.reason;
  return result.value;
}
