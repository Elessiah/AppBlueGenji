/**
 * Lecture des corps des gestes de lot du planning (calcul, confirmation) :
 * dates ISO, fenêtre bornée à {@link PLANNING_BATCH_MAX_DAYS} jours, clés
 * d'entrées. Pur : se teste sans requête.
 */
import { PLANNING_BATCH_MAX_DAYS } from "@/lib/shared/planning-view";
import { readEntryKey } from "./routes";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Entrées nommées au plus par confirmation. */
export const PLANNING_CONFIRM_MAX_KEYS = 200;

/** Instant lu d'une date ISO ; `null` si absente ou illisible. */
export function readInstant(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Fenêtre d'un lot : `from` < `to`, au plus {@link PLANNING_BATCH_MAX_DAYS} jours. */
export function readWindow(body: Record<string, unknown>): { from: number; to: number } | null {
  const from = readInstant(body.from);
  const to = readInstant(body.to);
  if (from === null || to === null || to <= from || to - from > PLANNING_BATCH_MAX_DAYS * DAY_MS) return null;
  return { from, to };
}

/** Ce qu'une confirmation retient : des clés d'entrées et/ou une échéance ; `null` si rien de lisible. */
export function readConfirmScope(body: Record<string, unknown>): { entryKeys: string[]; until?: number } | null {
  const raw = body.entryKeys ?? [];
  if (!Array.isArray(raw) || raw.length > PLANNING_CONFIRM_MAX_KEYS) return null;
  const entryKeys: string[] = [];
  for (const value of raw) {
    const key = readEntryKey(value);
    if (key === null) return null;
    if (!entryKeys.includes(key)) entryKeys.push(key);
  }
  if (body.until !== undefined) {
    const until = readInstant(body.until);
    if (until === null) return null;
    return { entryKeys, until };
  }
  return entryKeys.length > 0 ? { entryKeys } : null;
}
