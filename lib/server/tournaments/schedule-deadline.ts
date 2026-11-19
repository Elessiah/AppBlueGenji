/**
 * Date butoir de planification des matchs (`docs/features/SCHEDULE_DEADLINE.md`).
 *
 * - **Écriture** (permission `tournaments`) : une date butoir par match
 *   (`setMatchScheduleDeadline`) ou d'un coup pour tous les matchs à planifier
 *   d'un tournoi (`setTournamentScheduleDeadlines`), sous le verrou du tournoi
 *   puis du match. Changer la date butoir efface les avis déjà partis pour
 *   l'ancienne, dans la même transaction.
 * - **Balayage** (`sweepScheduleDeadlines`, chaque minute, verrou nommé
 *   `bg_schedule_deadlines` : un seul processus à la fois, idempotent) :
 *   annonce et rappels aux engagées (sujet `SCHEDULE_DEADLINE`, palier réservé
 *   dans `bg_schedule_deadline_notices` avant l'envoi), puis, à l'échéance, le
 *   **double forfait** d'un match toujours à planifier — par la chaîne d'un
 *   forfait d'arbitrage (`adminResolveMatch`, réconciliations, clôture) — ou
 *   l'extinction d'une date butoir devenue sans objet.
 *
 * Toute la règle vit dans `lib/shared/schedule-deadline.ts`.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { loadEntrantMatchLeaderIds, loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { toIso } from "@/lib/server/serialization";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { auditStaffAction } from "@/lib/server/staff-audit";
import type { StaffActor } from "@/lib/shared/log-privacy";
import { launchPairingKey, matchLaunchPhase } from "@/lib/shared/match-launch";
import { nullableId } from "@/lib/shared/nullable-id";
import { scheduleDeadlinePush } from "@/lib/shared/push-messages";
import {
  acceptsScheduleDeadline,
  deadlineOutcome,
  dueDeadlineReminder,
  readScheduleDeadline,
  SCHEDULE_DEADLINE_FORFEIT_KEY,
  type DeadlineMatch,
} from "@/lib/shared/schedule-deadline";
import { formatScheduleDeadlineDm, type DeadlineNotice, type DeadlineNoticeKey } from "@/lib/shared/schedule-deadline-notices";
import type { MatchStatus } from "@/lib/shared/types";
import { visibleText } from "@/lib/shared/visible-text";
import { adminResolveMatch } from "./admin";
import { retryOnDeadlock } from "./deadlock-retry";
import { publishMatchUpdatedEvent } from "./notifications";
import { lockTournamentRow } from "./registration";

/** Verrou nommé du balayage : un seul processus balaie à la fois. */
export const SCHEDULE_DEADLINES_LOCK = "bg_schedule_deadlines";
const SWEEP_TICK_MS = 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 90 * 1000;
/** Matchs lus par passage au plus (les suivants attendent la minute d'après). */
const SWEEP_BATCH = 200;

type DeadlineRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: MatchStatus;
  team1_id: number | null;
  team2_id: number | null;
  start_at: Date | string | null;
  launched_at: Date | string | null;
  launch_pairing: string | null;
  schedule_deadline_at: Date | string | null;
};

/** Ce que la règle lit d'une ligne de match (lancement compté pour la paire actuelle seulement). */
export function deadlineMatchOf(row: DeadlineRow, refereeScheduling: boolean): DeadlineMatch {
  const team1Id = nullableId(row.team1_id);
  const team2Id = nullableId(row.team2_id);
  const launchedAt = launchPairingKey(team1Id, team2Id) === (row.launch_pairing ?? null) ? toIso(row.launched_at) : null;
  return { status: row.status, team1Id, team2Id, startAt: toIso(row.start_at), launchedAt, refereeScheduling };
}

const MATCH_COLUMNS = `id, tournament_id, status, team1_id, team2_id, start_at, launched_at, launch_pairing, schedule_deadline_at`;

/** Le tournoi, lu sous son verrou (`lockTournamentRow` en première instruction). */
async function lockDeadlineTournament(
  connection: PoolConnection,
  tournamentId: number,
): Promise<{ refereeScheduling: boolean; state: string | null } | null> {
  await lockTournamentRow(connection, tournamentId);
  const [rows] = await connection.execute<(RowDataPacket & { referee_scheduling: number | null; state: string })[]>(
    `SELECT referee_scheduling, state FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  if (!rows[0]) return null;
  return { refereeScheduling: Number(rows[0].referee_scheduling ?? 0) === 1, state: rows[0].state };
}

async function matchTournamentId(connection: PoolConnection, matchId: number): Promise<number | null> {
  const [rows] = await connection.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT tournament_id FROM bg_matches WHERE id = ? LIMIT 1`,
    [matchId],
  );
  return rows[0] ? Number(rows[0].tournament_id) : null;
}

async function inTransaction<T>(connection: PoolConnection, run: () => Promise<T>): Promise<T> {
  await connection.beginTransaction();
  try {
    const result = await run();
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  }
}

/** Écrit la date butoir d'un match et efface les avis de l'ancienne (même transaction). */
async function writeDeadline(connection: PoolConnection, matchId: number, deadlineAt: number | null): Promise<void> {
  await connection.execute(`UPDATE bg_matches SET schedule_deadline_at = ? WHERE id = ?`, [
    deadlineAt === null ? null : new Date(deadlineAt),
    matchId,
  ]);
  await connection.execute(`DELETE FROM bg_schedule_deadline_notices WHERE match_id = ?`, [matchId]);
}

function wakeSweep(): void {
  // L'annonce part sans attendre la minute suivante ; un balayage déjà en cours
  // (verrou pris) la fera au prochain passage.
  void sweepScheduleDeadlines().catch((error) => {
    console.error("[schedule-deadline] balayage après écriture en échec", failureReason(error));
  });
}

/**
 * Fixe (ou efface, `null`) la date butoir d'un match.
 *
 * @returns la date butoir écrite (ISO), `null` si effacée.
 * @throws `MATCH_NOT_FOUND` | `INVALID_SCHEDULE_DEADLINE` | `SCHEDULE_DEADLINE_TOO_SOON`
 *         | `SCHEDULE_DEADLINE_TOO_FAR` | `SCHEDULE_DEADLINE_NOT_ALLOWED` (tournoi
 *         sans planification par l'arbitrage, terminé, ou match déjà programmé,
 *         lancé ou joué)
 */
export async function setMatchScheduleDeadline(
  matchId: number,
  raw: unknown,
  actor: StaffActor,
  now: number = Date.now(),
): Promise<string | null> {
  const input = readScheduleDeadline(raw, now);
  if (input.kind === "invalid") throw new Error(input.code);
  const deadlineAt = input.kind === "set" ? input.at : null;
  const tournamentId = await retryOnDeadlock(() =>
    withConnection(async (connection) => {
      const id = await matchTournamentId(connection, matchId);
      if (id === null) throw new Error("MATCH_NOT_FOUND");
      return inTransaction(connection, async () => {
        const tournament = await lockDeadlineTournament(connection, id);
        if (!tournament) throw new Error("MATCH_NOT_FOUND");
        const [rows] = await connection.execute<DeadlineRow[]>(
          `SELECT ${MATCH_COLUMNS} FROM bg_matches WHERE id = ? LIMIT 1 FOR UPDATE`,
          [matchId],
        );
        const row = rows[0];
        if (!row) throw new Error("MATCH_NOT_FOUND");
        // Effacer reste toujours permis (rien ne doit retenir un forfait) ; poser
        // exige un match encore à programmer, dans un tournoi qui se joue encore.
        if (
          deadlineAt !== null &&
          (tournament.state === "FINISHED" || !acceptsScheduleDeadline(deadlineMatchOf(row, tournament.refereeScheduling)))
        ) {
          throw new Error("SCHEDULE_DEADLINE_NOT_ALLOWED");
        }
        await writeDeadline(connection, matchId, deadlineAt);
        return id;
      });
    }),
  );
  const written = deadlineAt === null ? null : new Date(deadlineAt).toISOString();
  auditStaffAction(`[schedule-deadline] match ${matchId} : date butoir ${written ?? "effacée"}`, actor);
  publishMatchUpdatedEvent(tournamentId);
  if (written !== null) wakeSweep();
  return written;
}

/**
 * Fixe (ou efface, `null`) la date butoir de **tous** les matchs encore à
 * planifier d'un tournoi (deux engagées connues, sans horaire) — le geste de
 * l'ouverture d'une manche. Effacer touche toutes les dates butoir des matchs
 * non joués.
 *
 * @returns le nombre de matchs touchés.
 * @throws `TOURNAMENT_NOT_FOUND` | codes de {@link readScheduleDeadline} |
 *         `SCHEDULE_DEADLINE_NOT_ALLOWED` (tournoi sans planification par
 *         l'arbitrage, ou terminé)
 */
export async function setTournamentScheduleDeadlines(
  tournamentId: number,
  raw: unknown,
  actor: StaffActor,
  now: number = Date.now(),
): Promise<number> {
  const input = readScheduleDeadline(raw, now);
  if (input.kind === "invalid") throw new Error(input.code);
  const deadlineAt = input.kind === "set" ? input.at : null;
  const count = await retryOnDeadlock(() =>
    withConnection((connection) =>
      inTransaction(connection, async () => {
        const tournament = await lockDeadlineTournament(connection, tournamentId);
        if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
        if (deadlineAt !== null && (!tournament.refereeScheduling || tournament.state === "FINISHED")) {
          throw new Error("SCHEDULE_DEADLINE_NOT_ALLOWED");
        }
        // Table seule sous verrou (MariaDB : ni jointure ni `FOR UPDATE OF`).
        const [rows] = await connection.execute<DeadlineRow[]>(
          `SELECT ${MATCH_COLUMNS} FROM bg_matches
            WHERE tournament_id = ? AND is_bye = 0 AND status <> 'COMPLETED'
            FOR UPDATE`,
          [tournamentId],
        );
        const targets = rows.filter((row) => {
          if (deadlineAt === null) return row.schedule_deadline_at !== null;
          return matchLaunchPhase(deadlineMatchOf(row, tournament.refereeScheduling), now) === "TO_PLAN";
        });
        for (const row of targets) await writeDeadline(connection, Number(row.id), deadlineAt);
        return targets.length;
      }),
    ),
  );
  const written = deadlineAt === null ? "effacée" : new Date(deadlineAt).toISOString();
  auditStaffAction(`[schedule-deadline] tournoi ${tournamentId} : date butoir ${written} sur ${count} match(s)`, actor);
  if (count > 0) {
    publishMatchUpdatedEvent(tournamentId);
    if (deadlineAt !== null) wakeSweep();
  }
  return count;
}

/**
 * Le double forfait d'un match dont la date butoir est passée sans horaire,
 * sur la transaction de l'appelant (`forfeitMissedScheduleDeadlinePublic`, qui
 * enchaîne réconciliations et clôture). Tout se relit **sous verrou** — le
 * tournoi d'abord (`lockTournamentRow`), puis la ligne du match : un horaire
 * posé, une date butoir repoussée ou un résultat saisi entre le relevé du
 * balayage et ce verrou annulent le forfait.
 *
 * @returns vrai si le forfait est prononcé.
 */
export async function forfeitMissedScheduleDeadline(
  connection: PoolConnection,
  tournamentId: number,
  matchId: number,
  expectedDeadlineAt: number,
  now: number,
): Promise<boolean> {
  const tournament = await lockDeadlineTournament(connection, tournamentId);
  if (!tournament || tournament.state !== "RUNNING") return false;
  const [rows] = await connection.execute<DeadlineRow[]>(
    `SELECT ${MATCH_COLUMNS} FROM bg_matches WHERE id = ? AND tournament_id = ? LIMIT 1 FOR UPDATE`,
    [matchId, tournamentId],
  );
  const row = rows[0];
  if (!row || row.schedule_deadline_at === null) return false;
  const deadlineAt = new Date(row.schedule_deadline_at).getTime();
  if (deadlineAt !== expectedDeadlineAt) return false;
  if (deadlineOutcome(deadlineMatchOf(row, tournament.refereeScheduling), deadlineAt, now) !== "FORFEIT") return false;
  await adminResolveMatch(connection, matchId, { doubleForfeit: true });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Balayage
// ─────────────────────────────────────────────────────────────────────────────

type SweepRow = DeadlineRow & {
  referee_scheduling: number | null;
  tournament_state: string;
  tournament_name: string;
  team1_name: string | null;
  team2_name: string | null;
  team1_solo: number | null;
  team2_solo: number | null;
};

type NoticeRow = RowDataPacket & { match_id: number; notice_key: string };

/** Ce que fait le balayage d'un match lu. */
export type SweepAction =
  | { kind: "forfeit"; deadlineAt: number }
  | { kind: "lapse"; deadlineAt: number }
  | { kind: "remind"; key: DeadlineNoticeKey; consumes: DeadlineNoticeKey[]; deadlineAt: number }
  | { kind: "none" };

/**
 * La décision du balayage pour un match (pure, testée sans base) : un tournoi
 * qui ne se joue plus éteint la date butoir ; une date échue forfaite ou
 * s'éteint (`deadlineOutcome`) ; avant elle, un match à planifier reçoit le
 * palier d'avis dû (`dueDeadlineReminder`).
 */
export function sweepAction(row: SweepRow, sent: ReadonlySet<string>, now: number): SweepAction {
  if (row.schedule_deadline_at === null) return { kind: "none" };
  const deadlineAt = new Date(row.schedule_deadline_at).getTime();
  const refereeScheduling = Number(row.referee_scheduling ?? 0) === 1;
  const match = deadlineMatchOf(row, refereeScheduling);
  if (row.tournament_state === "FINISHED") return { kind: "lapse", deadlineAt };
  const outcome = deadlineOutcome(match, deadlineAt, now);
  if (outcome === "FORFEIT") return row.tournament_state === "RUNNING" ? { kind: "forfeit", deadlineAt } : { kind: "lapse", deadlineAt };
  if (outcome === "LAPSE") return { kind: "lapse", deadlineAt };
  if (deadlineAt <= now || matchLaunchPhase(match, now) !== "TO_PLAN") return { kind: "none" };
  const due = dueDeadlineReminder(deadlineAt, now, sent);
  return due ? { kind: "remind", key: due.key, consumes: due.consumes, deadlineAt } : { kind: "none" };
}

/**
 * Réserve des paliers d'avis, **seulement** si la date butoir est toujours
 * celle lue (insertion conditionnelle) : un avis ne part jamais pour une date
 * butoir que l'arbitrage vient de changer. Rend vrai si le palier `key` est à
 * nous.
 */
async function claimNotices(
  executor: Pick<PoolConnection, "execute">,
  matchId: number,
  deadlineAt: number,
  keys: readonly DeadlineNoticeKey[],
  key: DeadlineNoticeKey,
): Promise<boolean> {
  let mine = false;
  for (const each of keys) {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT IGNORE INTO bg_schedule_deadline_notices (match_id, notice_key, deadline_at)
       SELECT id, ?, schedule_deadline_at FROM bg_matches WHERE id = ? AND schedule_deadline_at = ?`,
      [each, matchId, new Date(deadlineAt)],
    );
    if (each === key) mine = Number(result.affectedRows ?? 0) > 0;
  }
  return mine;
}

/** Les deux points de vue d'un match : chaque engagée lit « son équipe contre l'adversaire ». */
export function deadlineNoticesFor(row: SweepRow, key: DeadlineNoticeKey, deadlineAt: number): { teamId: number; notice: DeadlineNotice }[] {
  const team1Id = nullableId(row.team1_id);
  const team2Id = nullableId(row.team2_id);
  if (team1Id === null || team2Id === null) return [];
  const solo = row.team1_solo !== null || row.team2_solo !== null;
  const base = {
    key,
    matchId: Number(row.id),
    tournamentId: Number(row.tournament_id),
    tournamentName: visibleText(row.tournament_name),
    solo,
    deadlineAt: new Date(deadlineAt).toISOString(),
  };
  const name1 = visibleText(row.team1_name ?? "");
  const name2 = visibleText(row.team2_name ?? "");
  return [
    { teamId: team1Id, notice: { ...base, teamName: name1, opponentName: name2 } },
    { teamId: team2Id, notice: { ...base, teamName: name2, opponentName: name1 } },
  ];
}

/** Envoie l'avis aux responsables de match (capitaine, manager, owner ; le joueur d'une entrée solo) des deux engagées. */
export async function sendDeadlineNotices(row: SweepRow, key: DeadlineNoticeKey, deadlineAt: number): Promise<number> {
  const sides = deadlineNoticesFor(row, key, deadlineAt);
  if (sides.length === 0) return 0;
  const leaders = await loadEntrantMatchLeaderIds(sides.map((side) => side.teamId));
  const base = siteCanonicalBase();
  let sent = 0;
  for (const side of sides) {
    const ids = leaders.get(side.teamId) ?? [];
    if (ids.length === 0) continue;
    const recipients = await loadNotificationRecipients(ids, "proven", { matchDm: true });
    if (recipients.length === 0) continue;
    await notifyUsers(recipients, {
      topic: "SCHEDULE_DEADLINE",
      push: (locale) => scheduleDeadlinePush(side.notice, locale),
      discord: { message: (locale) => formatScheduleDeadlineDm(side.notice, base, locale), context: "schedule-deadline" },
      dmFollowsTopic: true,
    });
    sent += 1;
  }
  return sent;
}

/** Un passage du balayage, sous le verrou nommé : rend ce qu'il a fait. */
export type SweepReport = { forfeited: number; lapsed: number; reminded: number };

async function readSweepRows(connection: PoolConnection): Promise<SweepRow[]> {
  const [rows] = await connection.execute<SweepRow[]>(
    `SELECT m.id, m.tournament_id, m.status, m.team1_id, m.team2_id, m.start_at, m.launched_at, m.launch_pairing,
            m.schedule_deadline_at, t.referee_scheduling, t.state AS tournament_state, t.name AS tournament_name,
            t1.name AS team1_name, t2.name AS team2_name, t1.solo_user_id AS team1_solo, t2.solo_user_id AS team2_solo
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.schedule_deadline_at IS NOT NULL
        AND m.status NOT IN ('COMPLETED', 'AWAITING_CONFIRMATION')
        AND m.start_at IS NULL
      ORDER BY m.schedule_deadline_at, m.id
      LIMIT ${SWEEP_BATCH}`,
  );
  return rows;
}

async function readSentKeys(connection: PoolConnection, matchIds: readonly number[]): Promise<Map<number, Set<string>>> {
  const sent = new Map<number, Set<string>>();
  if (matchIds.length === 0) return sent;
  const [rows] = await connection.execute<NoticeRow[]>(
    `SELECT match_id, notice_key FROM bg_schedule_deadline_notices WHERE match_id IN (${matchIds.map(() => "?").join(", ")})`,
    [...matchIds],
  );
  for (const row of rows) {
    const id = Number(row.match_id);
    const keys = sent.get(id) ?? new Set<string>();
    keys.add(row.notice_key);
    sent.set(id, keys);
  }
  return sent;
}

/**
 * Joue la décision du balayage pour un match ; rend ce qui a été fait
 * (`null` : rien — un autre passage, un horaire posé ou une date butoir
 * changée l'a devancé).
 */
async function applySweepAction(
  connection: PoolConnection,
  row: SweepRow,
  action: SweepAction,
  now: number,
): Promise<keyof SweepReport | null> {
  const matchId = Number(row.id);
  if (action.kind === "forfeit") {
    const { forfeitMissedScheduleDeadlinePublic } = await import("./index");
    if (!(await forfeitMissedScheduleDeadlinePublic(Number(row.tournament_id), matchId, action.deadlineAt, now))) return null;
    console.info(`[schedule-deadline] match ${matchId} : date butoir passée sans horaire, double forfait`);
    const key = SCHEDULE_DEADLINE_FORFEIT_KEY;
    if (await claimNotices(connection, matchId, action.deadlineAt, [key], key)) await sendDeadlineNotices(row, key, action.deadlineAt);
    return "forfeited";
  }
  if (action.kind === "lapse") {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE bg_matches SET schedule_deadline_at = NULL WHERE id = ? AND schedule_deadline_at = ?`,
      [matchId, new Date(action.deadlineAt)],
    );
    if (Number(result.affectedRows ?? 0) === 0) return null;
    await connection.execute(`DELETE FROM bg_schedule_deadline_notices WHERE match_id = ?`, [matchId]);
    publishMatchUpdatedEvent(Number(row.tournament_id));
    return "lapsed";
  }
  if (action.kind === "remind" && (await claimNotices(connection, matchId, action.deadlineAt, action.consumes, action.key))) {
    await sendDeadlineNotices(row, action.key, action.deadlineAt);
    return "reminded";
  }
  return null;
}

/**
 * Un passage : forfaits, extinctions, avis. Idempotent — un forfait se relit
 * sous verrou, un avis se réserve avant l'envoi, une extinction ne touche que
 * la date butoir lue —, et un seul processus à la fois (verrou nommé, pris
 * sans attendre : un autre passage en cours fera le travail).
 */
export async function sweepScheduleDeadlines(now: number = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { forfeited: 0, lapsed: 0, reminded: 0 };
  const db = await getDatabase();
  try {
    await withNamedLock(db, SCHEDULE_DEADLINES_LOCK, 0, async (connection) => {
      const rows = await readSweepRows(connection);
      const sent = await readSentKeys(connection, rows.map((row) => Number(row.id)));
      for (const row of rows) {
        const matchId = Number(row.id);
        try {
          const done = await applySweepAction(connection, row, sweepAction(row, sent.get(matchId) ?? new Set(), now), now);
          if (done !== null) report[done] += 1;
        } catch (error) {
          // Un match en échec n'arrête pas les autres ; il sera repris à la minute suivante.
          console.error(`[schedule-deadline] match ${matchId} : passage en échec`, failureReason(error));
        }
      }
    });
  } catch (error) {
    if (error instanceof NamedLockUnavailableError) return report;
    throw error;
  }
  return report;
}

type ClockState = { timer: ReturnType<typeof setInterval> | null; failing: boolean; running: boolean };
const globalClock = globalThis as typeof globalThis & { __bgScheduleDeadlines?: ClockState };

async function sweepOnce(state: ClockState): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    await sweepScheduleDeadlines();
    state.failing = false;
  } catch (error) {
    if (!state.failing) console.error("[schedule-deadline] Balayage des dates butoir impossible.", failureReason(error));
    state.failing = true;
  } finally {
    state.running = false;
  }
}

/** Lance le balayage des dates butoir (une fois par processus). */
export function startScheduleDeadlineClock(): void {
  const state = (globalClock.__bgScheduleDeadlines ??= { timer: null, failing: false, running: false });
  if (state.timer) return;
  const first = setTimeout(() => void sweepOnce(state), FIRST_SWEEP_DELAY_MS);
  first.unref?.();
  state.timer = setInterval(() => void sweepOnce(state), SWEEP_TICK_MS);
  state.timer.unref?.();
}
