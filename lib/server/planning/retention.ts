/**
 * Durée de conservation du planning (`docs/features/CAST_PLANNING.md`,
 * registre des traitements) : disponibilités, préférences, attributions et
 * leur historique sont effacés {@link PLANNING_RETENTION_DAYS} jours après le
 * début de leur entrée (match, ou tournoi entier) ; le réglage « caster
 * autonome » l'est quand le compte ne tient plus le rôle caster (le seul qui
 * peut le porter, `setSoloCaster`).
 * Une purge par jour, lancée au démarrage (`instrumentation.ts`).
 */
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { PLANNING_RETENTION_DAYS } from "@/lib/shared/planning";
import { jsonRoleLiteral } from "@/lib/server/privacy-consent";
import type { Executor } from "./load";

/** Le réglage « caster autonome » ne sert qu'à un caster : il part avec ce rôle. */
const HOLDS_CASTER_SQL = `JSON_CONTAINS(u.platform_roles_json, ${jsonRoleLiteral("CASTER")})`;

const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_TICK_MS = DAY_MS;
/** Premier passage peu après le démarrage, hors du chemin de la première requête. */
const FIRST_PURGE_DELAY_MS = 5 * 60 * 1000;

const ENTRY_TABLES = [
  "bg_planning_availability",
  "bg_planning_assignments",
  "bg_planning_events",
  "bg_planning_entry_notices",
  "bg_planning_auto_confirms",
] as const;

/** Efface ce que le planning garde au-delà de sa durée de conservation ; rend le nombre de lignes effacées. */
export async function purgeExpiredPlanning(executor: Executor, now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - PLANNING_RETENTION_DAYS * DAY_MS);
  let removed = 0;
  for (const table of ENTRY_TABLES) {
    const [result] = await executor.execute(
      `DELETE p FROM ${table} p
         JOIN bg_tournaments t ON t.id = p.tournament_id
         LEFT JOIN bg_matches m ON m.id = p.match_id
        WHERE COALESCE(m.start_at, t.start_at) < ?`,
      [cutoff],
    );
    removed += Number((result as { affectedRows?: number }).affectedRows ?? 0);
  }
  const [profiles] = await executor.execute(
    `DELETE p FROM bg_planning_profiles p JOIN bg_users u ON u.id = p.user_id
      WHERE u.is_deleted = 1 OR NOT COALESCE(${HOLDS_CASTER_SQL}, 0)`,
  );
  removed += Number((profiles as { affectedRows?: number }).affectedRows ?? 0);
  return removed;
}

type ClockState = { timer: ReturnType<typeof setInterval> | null; failing: boolean };
const globalClock = globalThis as typeof globalThis & { __bgPlanningRetention?: ClockState };

async function purgeOnce(state: ClockState): Promise<void> {
  try {
    const db = await getDatabase();
    await purgeExpiredPlanning(db);
    state.failing = false;
  } catch (error) {
    // Une alerte par panne, pas une par jour.
    if (!state.failing) console.error("[planning] Purge de conservation impossible.", failureReason(error));
    state.failing = true;
  }
}

/** Lance la purge quotidienne (une fois par processus). */
export function startPlanningRetentionClock(): void {
  const state = (globalClock.__bgPlanningRetention ??= { timer: null, failing: false });
  if (state.timer) return;
  const first = setTimeout(() => void purgeOnce(state), FIRST_PURGE_DELAY_MS);
  first.unref?.();
  state.timer = setInterval(() => void purgeOnce(state), PURGE_TICK_MS);
  state.timer.unref?.();
}
