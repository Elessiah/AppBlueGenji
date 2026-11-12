/**
 * Double de la fenêtre de réactivation calculée par la base (D67,
 * `lib/server/users/reactivation-window.ts`) : une base simulée ajoute aux
 * lignes relues les colonnes `window_open` / `deletion_due` que `NOW()` aurait
 * calculées, d'après leur `deletion_requested_at` et l'horloge du test.
 */

const WINDOW_MS = 30 * 24 * 3600 * 1000;

type Row = Record<string, unknown>;

function requestedAtMs(row: Row): number | null {
  const value = row.deletion_requested_at;
  if (value === null || value === undefined) return null;
  const ms = new Date(value as string | Date).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Les colonnes calculées qu'une requête demande, posées sur chaque ligne qui ne les a pas déjà. */
export function withWindowFlags<T>(sql: string, rows: T[], now: number = Date.now()): T[] {
  const wantsOpen = sql.includes("AS window_open");
  const wantsDue = sql.includes("AS deletion_due");
  if (!wantsOpen && !wantsDue) return rows;
  return rows.map((row) => {
    const record = row as Row;
    const at = requestedAtMs(record);
    const flags: Row = {};
    if (wantsOpen && !("window_open" in record)) flags.window_open = at !== null && at > now - WINDOW_MS ? 1 : 0;
    if (wantsDue && !("deletion_due" in record)) flags.deletion_due = at !== null && at <= now - WINDOW_MS ? 1 : 0;
    return { ...record, ...flags } as T;
  });
}
