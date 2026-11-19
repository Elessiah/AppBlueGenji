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
 *   forfait d'arbitrage (`adminResolveMatch`, réconciliations, clôture) —, le
 *   retrait d'une date butoir échue sur un match programmé (gardée pour le
 *   planning) ou l'extinction d'une date butoir devenue sans objet.
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
  deadlineArmed,
  deadlineOutcome,
  dueDeadlineReminder,
  readScheduleDeadline,
  SCHEDULE_DEADLINE_FORFEIT_KEY,
  SCHEDULE_DEADLINE_RETIRED_KEY,
  type DeadlineMatch,
} from "@/lib/shared/schedule-deadline";
import { formatScheduleDeadlineDm, type DeadlineNotice, type DeadlineNoticeKey } from "@/lib/shared/schedule-deadline-notices";
import type { MatchStatus } from "@/lib/shared/types";
import { visibleText } from "@/lib/shared/visible-text";
import { adminResolveMatch } from "./admin";
import { retryOnDeadlock } from "./deadlock-retry";
import { publishMatchUpdatedEvent } from "./notifications";
import { lockTournamentRow } from "./registration";
import { transact } from "./transaction";

/** Verrou nommé du balayage : un seul processus balaie à la fois. */
export const SCHEDULE_DEADLINES_LOCK = "bg_schedule_deadlines";
const SWEEP_TICK_MS = 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 90 * 1000;
/** Matchs lus par page (le passage enchaîne les pages, jusqu'à {@link SWEEP_MAX_PAGES}). */
export const SWEEP_BATCH = 200;
/** Pages lues par passage au plus : au-delà, la suite attend la minute d'après. */
export const SWEEP_MAX_PAGES = 10;
/**
 * Gestes (forfaits, retraits, extinctions, avis envoyés) par passage au plus :
 * les messages privés partent un à un sous le verrou ; au-delà, la suite
 * attend la minute d'après.
 */
export const SWEEP_MAX_ACTIONS = 100;
/**
 * Passages en échec d'affilée sur un même match (pour la même date butoir)
 * avant qu'il ne soit mis de côté {@link SWEEP_FAILURE_BACKOFF_MS} : un
 * forfait qui échoue toujours (résultat déjà saisi plus loin dans l'arbre, par
 * exemple) ne relance pas son échec chaque minute. La date butoir reste : une
 * panne passagère (verrou tenu longtemps) ne la fait jamais perdre.
 */
export const SWEEP_MAX_FAILURES = 5;
/** Mise de côté d'un match en échec répété (voir {@link SWEEP_MAX_FAILURES}). */
export const SWEEP_FAILURE_BACKOFF_MS = 15 * 60 * 1000;

/** Une colonne `DATETIME` lue (ou absente). */
type SqlDateTime = Date | string | null;

type DeadlineRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: MatchStatus;
  team1_id: number | null;
  team2_id: number | null;
  start_at: SqlDateTime;
  launched_at: SqlDateTime;
  launch_pairing: string | null;
  schedule_deadline_at: SqlDateTime;
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

/** Même instant (à la seconde, comme la colonne) : la date butoir en place, ou aucune des deux. */
function sameDeadline(stored: SqlDateTime, deadlineAt: number | null): boolean {
  if (stored === null || deadlineAt === null) return stored === null && deadlineAt === null;
  return Math.floor(new Date(stored).getTime() / 1000) === Math.floor(deadlineAt / 1000);
}

/**
 * Écrit la date butoir d'un match et efface les avis de l'ancienne (même
 * transaction). Inchangée, rien n'est écrit : les avis déjà partis restent, et
 * reposer la même date (geste commun relancé pour de nouveaux matchs) ne les
 * renvoie pas.
 *
 * @returns vrai si la date butoir a changé.
 */
async function writeDeadline(
  connection: PoolConnection,
  matchId: number,
  current: SqlDateTime,
  deadlineAt: number | null,
): Promise<boolean> {
  if (sameDeadline(current, deadlineAt)) return false;
  await connection.execute(`UPDATE bg_matches SET schedule_deadline_at = ? WHERE id = ?`, [
    deadlineAt === null ? null : new Date(deadlineAt),
    matchId,
  ]);
  await connection.execute(`DELETE FROM bg_schedule_deadline_notices WHERE match_id = ?`, [matchId]);
  return true;
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
      return transact(connection, async () => {
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
        await writeDeadline(connection, matchId, row.schedule_deadline_at, deadlineAt);
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
 * @returns le nombre de matchs visés, qui portent désormais cette date butoir
 *          (une date identique déjà en place n'est ni réécrite ni réannoncée).
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
  const { count, changed } = await retryOnDeadlock(() =>
    withConnection((connection) =>
      transact(connection, async () => {
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
        let changed = 0;
        for (const row of targets) {
          if (await writeDeadline(connection, Number(row.id), row.schedule_deadline_at, deadlineAt)) changed += 1;
        }
        return { count: targets.length, changed };
      }),
    ),
  );
  const written = deadlineAt === null ? "effacée" : new Date(deadlineAt).toISOString();
  auditStaffAction(`[schedule-deadline] tournoi ${tournamentId} : date butoir ${written} sur ${count} match(s) (${changed} changée(s))`, actor);
  if (changed > 0) {
    publishMatchUpdatedEvent(tournamentId);
    if (deadlineAt !== null) wakeSweep();
  }
  return count;
}

/**
 * Le double forfait d'un match dont la date butoir est passée sans horaire,
 * armée pour la paire actuelle (`deadlineArmed`), sur la transaction de l'appelant (`forfeitMissedScheduleDeadlinePublic`, qui
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
  const match = deadlineMatchOf(row, tournament.refereeScheduling);
  if (deadlineOutcome(match, deadlineAt, now) !== "FORFEIT") return false;
  const guard = await readForfeitGuard(connection, matchId, launchPairingKey(match.team1Id, match.team2Id));
  if (guard.retired || !deadlineArmed(guard.armedAt, deadlineAt)) return false;
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

type NoticeRow = RowDataPacket & { match_id: number; notice_key: string; pairing: string | null; sent_at: Date | string };

/**
 * Les avis d'un match **pour sa paire actuelle** : paliers déjà partis, et
 * l'instant du premier (`armedAt` : la date butoir est alors « armée »).
 * `stale` : des avis d'une paire précédente restent, à effacer. `retired` :
 * la date butoir a été retirée (`SCHEDULE_DEADLINE_RETIRED_KEY`, quelle que
 * soit la paire).
 */
export type SentNotices = { keys: ReadonlySet<string>; armedAt: number | null; stale: boolean; retired: boolean };

export const NO_NOTICES: SentNotices = { keys: new Set(), armedAt: null, stale: false, retired: false };

/** Ce que fait le balayage d'un match lu. */
export type SweepAction =
  | { kind: "forfeit"; deadlineAt: number }
  | { kind: "lapse"; deadlineAt: number }
  | { kind: "retire"; deadlineAt: number }
  | { kind: "remind"; key: DeadlineNoticeKey; consumes: DeadlineNoticeKey[]; deadlineAt: number }
  | { kind: "none" };

/** La paire actuelle d'une ligne (`null` : une engagée manque). */
function rowPairing(row: DeadlineRow): string | null {
  return launchPairingKey(nullableId(row.team1_id), nullableId(row.team2_id));
}

/**
 * La décision du balayage pour un match (pure, testée sans base) : un tournoi
 * qui ne se joue plus éteint la date butoir ; une date échue forfaite — si
 * elle a été armée à temps pour la paire actuelle (`deadlineArmed`) et n'a
 * pas été retirée —, est retirée (match programmé ou lancé : gardée pour le
 * planning, une fois) ou s'éteint (`deadlineOutcome`) ; avant elle, un match
 * à planifier reçoit le palier d'avis dû (`dueDeadlineReminder`).
 */
export function sweepAction(row: SweepRow, sent: SentNotices, now: number): SweepAction {
  if (row.schedule_deadline_at === null) return { kind: "none" };
  const deadlineAt = new Date(row.schedule_deadline_at).getTime();
  const refereeScheduling = Number(row.referee_scheduling ?? 0) === 1;
  const match = deadlineMatchOf(row, refereeScheduling);
  if (row.tournament_state === "FINISHED") return { kind: "lapse", deadlineAt };
  const outcome = deadlineOutcome(match, deadlineAt, now);
  if (outcome === "FORFEIT") {
    return row.tournament_state === "RUNNING" && !sent.retired && deadlineArmed(sent.armedAt, deadlineAt)
      ? { kind: "forfeit", deadlineAt }
      : { kind: "lapse", deadlineAt };
  }
  if (outcome === "RETIRE") return sent.retired ? { kind: "none" } : { kind: "retire", deadlineAt };
  if (outcome === "LAPSE") return { kind: "lapse", deadlineAt };
  if (deadlineAt <= now || matchLaunchPhase(match, now) !== "TO_PLAN") return { kind: "none" };
  const due = dueDeadlineReminder(deadlineAt, now, sent.keys);
  return due ? { kind: "remind", key: due.key, consumes: due.consumes, deadlineAt } : { kind: "none" };
}

/**
 * Réserve des paliers d'avis, **seulement** si la date butoir et la paire sont
 * toujours celles lues (insertion conditionnelle) : un avis ne part jamais
 * pour une date butoir que l'arbitrage vient de changer, ni pour une paire
 * remplacée. Rend vrai si le palier `key` est à nous.
 */
async function claimNotices(
  executor: Pick<PoolConnection, "execute">,
  row: DeadlineRow,
  deadlineAt: number,
  keys: readonly DeadlineNoticeKey[],
  key: DeadlineNoticeKey,
  now: number,
): Promise<boolean> {
  let mine = false;
  for (const each of keys) {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT IGNORE INTO bg_schedule_deadline_notices (match_id, notice_key, pairing, deadline_at, sent_at)
       SELECT id, ?, ?, schedule_deadline_at, ? FROM bg_matches
        WHERE id = ? AND schedule_deadline_at = ? AND team1_id <=> ? AND team2_id <=> ?`,
      [each, rowPairing(row), new Date(now), Number(row.id), new Date(deadlineAt), nullableId(row.team1_id), nullableId(row.team2_id)],
    );
    if (each === key) mine = Number(result.affectedRows ?? 0) > 0;
  }
  return mine;
}

/** Un avis réellement parti aux engagées avant l'échéance (ni l'avis de forfait, ni la marque de retrait). */
function armsDeadline(key: string): boolean {
  return key !== SCHEDULE_DEADLINE_FORFEIT_KEY && key !== SCHEDULE_DEADLINE_RETIRED_KEY;
}

/**
 * Relu sous verrou avant un forfait : l'instant du premier avis parti pour
 * cette paire (`armsDeadline` ; `null` : jamais armée), et la marque de
 * retrait (toute paire).
 */
async function readForfeitGuard(
  executor: Pick<PoolConnection, "execute">,
  matchId: number,
  pairing: string | null,
): Promise<{ armedAt: number | null; retired: boolean }> {
  const [rows] = await executor.execute<(RowDataPacket & { notice_key: string; pairing: string | null; sent_at: SqlDateTime })[]>(
    `SELECT notice_key, pairing, sent_at FROM bg_schedule_deadline_notices WHERE match_id = ?`,
    [matchId],
  );
  let armedAt: number | null = null;
  let retired = false;
  for (const row of rows) {
    if (row.notice_key === SCHEDULE_DEADLINE_RETIRED_KEY) retired = true;
    if (pairing === null || row.pairing !== pairing || !armsDeadline(row.notice_key) || row.sent_at === null) continue;
    const at = new Date(row.sent_at).getTime();
    armedAt = armedAt === null ? at : Math.min(armedAt, at);
  }
  return { armedAt, retired };
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
export type SweepReport = { forfeited: number; lapsed: number; retired: number; reminded: number };

/** Où reprendre la lecture : après ce match (même ordre que la lecture). */
type SweepCursor = { deadlineAt: Date; id: number };

/**
 * Une page des dates butoir à examiner, de la plus urgente : celles d'un match
 * sans horaire, et celles **échues** d'un match programmé ou lancé pas encore
 * retirées. Les matchs mis de côté (`skipIds`, échecs répétés) sont sautés ;
 * `after` reprend derrière la page précédente.
 */
async function readSweepRows(
  connection: PoolConnection,
  now: number,
  skipIds: readonly number[],
  after: SweepCursor | null,
): Promise<SweepRow[]> {
  const params: (Date | number | string)[] = [new Date(now), SCHEDULE_DEADLINE_RETIRED_KEY];
  let extra = "";
  if (skipIds.length > 0) {
    extra += ` AND m.id NOT IN (${skipIds.map(() => "?").join(", ")})`;
    params.push(...skipIds);
  }
  if (after !== null) {
    extra += ` AND (m.schedule_deadline_at > ? OR (m.schedule_deadline_at = ? AND m.id > ?))`;
    params.push(after.deadlineAt, after.deadlineAt, after.id);
  }
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
        AND (m.start_at IS NULL OR m.schedule_deadline_at <= ?)
        AND NOT ((m.start_at IS NOT NULL OR m.launched_at IS NOT NULL) AND EXISTS (
              SELECT 1 FROM bg_schedule_deadline_notices n WHERE n.match_id = m.id AND n.notice_key = ?))${extra}
      ORDER BY m.schedule_deadline_at, m.id
      LIMIT ${SWEEP_BATCH}`,
    params,
  );
  return rows;
}

/** Les avis de chaque match lu, rapportés à sa paire actuelle (pur, testé sans base). */
export function sentNoticesByMatch(
  rows: readonly DeadlineRow[],
  notices: readonly Pick<NoticeRow, "match_id" | "notice_key" | "pairing" | "sent_at">[],
): Map<number, SentNotices> {
  const pairings = new Map(rows.map((row) => [Number(row.id), rowPairing(row)]));
  const sent = new Map<number, SentNotices>();
  for (const notice of notices) {
    const id = Number(notice.match_id);
    const current = sent.get(id) ?? NO_NOTICES;
    if (notice.notice_key === SCHEDULE_DEADLINE_RETIRED_KEY) {
      sent.set(id, { ...current, retired: true });
      continue;
    }
    const pairing = pairings.get(id) ?? null;
    if (pairing === null || notice.pairing !== pairing) {
      sent.set(id, { ...current, stale: true });
      continue;
    }
    const keys = new Set(current.keys);
    keys.add(notice.notice_key);
    let armedAt = current.armedAt;
    if (armsDeadline(notice.notice_key)) {
      const at = new Date(notice.sent_at).getTime();
      armedAt = armedAt === null ? at : Math.min(armedAt, at);
    }
    sent.set(id, { keys, armedAt, stale: current.stale, retired: current.retired });
  }
  return sent;
}

async function readSentNotices(connection: PoolConnection, rows: readonly SweepRow[]): Promise<Map<number, SentNotices>> {
  if (rows.length === 0) return new Map();
  const [notices] = await connection.execute<NoticeRow[]>(
    `SELECT match_id, notice_key, pairing, sent_at FROM bg_schedule_deadline_notices
      WHERE match_id IN (${rows.map(() => "?").join(", ")})`,
    rows.map((row) => Number(row.id)),
  );
  return sentNoticesByMatch(rows, notices);
}

/** Éteint une date butoir, si c'est toujours celle lue ; efface ses avis. */
async function lapseDeadline(connection: PoolConnection, row: SweepRow, deadlineAt: number): Promise<boolean> {
  const matchId = Number(row.id);
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE bg_matches SET schedule_deadline_at = NULL WHERE id = ? AND schedule_deadline_at = ?`,
    [matchId, new Date(deadlineAt)],
  );
  if (Number(result.affectedRows ?? 0) === 0) return false;
  await connection.execute(`DELETE FROM bg_schedule_deadline_notices WHERE match_id = ?`, [matchId]);
  publishMatchUpdatedEvent(Number(row.tournament_id));
  return true;
}

/**
 * Retire une date butoir échue d'un match programmé ou lancé, si c'est
 * toujours celle lue et que le match est toujours programmé ou lancé (un
 * horaire retiré entre-temps le laisse à planifier, donc au forfait) : marque
 * `SCHEDULE_DEADLINE_RETIRED_KEY` (jamais envoyée), la date reste sur le
 * match pour le planning.
 */
async function retireDeadline(connection: PoolConnection, row: SweepRow, deadlineAt: number, now: number): Promise<boolean> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT IGNORE INTO bg_schedule_deadline_notices (match_id, notice_key, pairing, deadline_at, sent_at)
     SELECT id, ?, ?, schedule_deadline_at, ? FROM bg_matches
      WHERE id = ? AND schedule_deadline_at = ?
        AND (start_at IS NOT NULL OR (launched_at IS NOT NULL AND launch_pairing <=> ?))`,
    [SCHEDULE_DEADLINE_RETIRED_KEY, rowPairing(row), new Date(now), Number(row.id), new Date(deadlineAt), rowPairing(row)],
  );
  return Number(result.affectedRows ?? 0) > 0;
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
  sent: SentNotices,
  now: number,
): Promise<keyof SweepReport | null> {
  const matchId = Number(row.id);
  if (action.kind === "forfeit") {
    const { forfeitMissedScheduleDeadlinePublic } = await import("./index");
    if (!(await forfeitMissedScheduleDeadlinePublic(Number(row.tournament_id), matchId, action.deadlineAt, now))) return null;
    console.info(`[schedule-deadline] match ${matchId} : date butoir passée sans horaire, double forfait`);
    const key = SCHEDULE_DEADLINE_FORFEIT_KEY;
    if (await claimNotices(connection, row, action.deadlineAt, [key], key, now)) await sendDeadlineNotices(row, key, action.deadlineAt);
    return "forfeited";
  }
  if (action.kind === "lapse") return (await lapseDeadline(connection, row, action.deadlineAt)) ? "lapsed" : null;
  if (action.kind === "retire") return (await retireDeadline(connection, row, action.deadlineAt, now)) ? "retired" : null;
  if (action.kind !== "remind") return null;
  // Avis d'une paire précédente : la nouvelle repart de l'annonce. La marque de retrait vaut pour
  // toute paire : elle reste.
  if (sent.stale) {
    await connection.execute(
      `DELETE FROM bg_schedule_deadline_notices WHERE match_id = ? AND NOT (pairing <=> ?) AND notice_key <> ?`,
      [matchId, rowPairing(row), SCHEDULE_DEADLINE_RETIRED_KEY],
    );
  }
  if (await claimNotices(connection, row, action.deadlineAt, action.consumes, action.key, now)) {
    await sendDeadlineNotices(row, action.key, action.deadlineAt);
    return "reminded";
  }
  return null;
}

/** Échecs d'affilée d'un match, pour une date butoir (une autre date repart de zéro). */
type FailureState = { deadlineAt: number | null; failures: number; retryAt: number };

const globalFailures = globalThis as typeof globalThis & { __bgScheduleDeadlineFailures?: Map<number, FailureState> };

/** Échecs d'affilée par match, pour ce processus. */
export function failureCounts(): Map<number, FailureState> {
  globalFailures.__bgScheduleDeadlineFailures ??= new Map();
  return globalFailures.__bgScheduleDeadlineFailures;
}

function deadlineOf(row: DeadlineRow): number | null {
  return row.schedule_deadline_at === null ? null : new Date(row.schedule_deadline_at).getTime();
}

/**
 * Un match en échec n'arrête pas les autres ; il est repris à la minute
 * suivante. Au bout de {@link SWEEP_MAX_FAILURES} échecs d'affilée, il est mis
 * de côté {@link SWEEP_FAILURE_BACKOFF_MS} (journal d'erreur pour
 * l'arbitrage) ; sa date butoir reste. Repris, il repart d'une série neuve.
 */
export function recordFailure(row: SweepRow, error: unknown, now: number): void {
  const matchId = Number(row.id);
  const deadlineAt = deadlineOf(row);
  const previous = failureCounts().get(matchId);
  // Une série mise de côté puis reprise repart de zéro : le compte reste borné.
  const continued = previous !== undefined && previous.deadlineAt === deadlineAt && previous.retryAt === 0;
  const failures = (continued ? previous.failures : 0) + 1;
  const parked = failures >= SWEEP_MAX_FAILURES;
  failureCounts().set(matchId, { deadlineAt, failures, retryAt: parked ? now + SWEEP_FAILURE_BACKOFF_MS : 0 });
  console.error(`[schedule-deadline] match ${matchId} : passage en échec (${failures}/${SWEEP_MAX_FAILURES})`, failureReason(error));
  if (parked) {
    console.error(
      `[schedule-deadline] match ${matchId} : ${failures} échecs d'affilée, mis de côté ${SWEEP_FAILURE_BACKOFF_MS / 60000} min, à revoir par l'arbitrage`,
    );
  }
}

/** Les matchs mis de côté maintenant. */
function parkedIds(now: number): number[] {
  return [...failureCounts().entries()].filter(([, state]) => state.retryAt > now).map(([id]) => id);
}

/**
 * Oublie les échecs des matchs que la lecture complète n'a plus rendus (joués,
 * date butoir effacée…), hors ceux mis de côté : la table ne grossit pas.
 */
function forgetUnseen(seen: ReadonlySet<number>, now: number): void {
  for (const [id, state] of failureCounts()) {
    if (!seen.has(id) && state.retryAt <= now) failureCounts().delete(id);
  }
}

/**
 * Un passage : forfaits, retraits, extinctions, avis. Idempotent — un forfait
 * se relit sous verrou, un avis se réserve avant l'envoi, une extinction ne
 * touche que la date butoir lue —, et un seul processus à la fois (verrou
 * nommé, pris sans attendre : un autre passage en cours fera le travail). La
 * lecture va par pages ({@link SWEEP_BATCH}), jusqu'à {@link SWEEP_MAX_PAGES}
 * et {@link SWEEP_MAX_ACTIONS} gestes.
 */
export async function sweepScheduleDeadlines(now: number = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { forfeited: 0, lapsed: 0, retired: 0, reminded: 0 };
  const db = await getDatabase();
  try {
    await withNamedLock(db, SCHEDULE_DEADLINES_LOCK, 0, async (connection) => {
      const skipIds = parkedIds(now);
      const seen = new Set<number>();
      let after: SweepCursor | null = null;
      let complete = false;
      for (let page = 0; page < SWEEP_MAX_PAGES; page += 1) {
        const rows = await readSweepRows(connection, now, skipIds, after);
        if (!(await sweepPage(connection, rows, now, report, seen))) break;
        const last = rows[rows.length - 1];
        if (rows.length < SWEEP_BATCH || !last || last.schedule_deadline_at === null) {
          complete = true;
          break;
        }
        after = { deadlineAt: new Date(last.schedule_deadline_at), id: Number(last.id) };
      }
      if (complete) forgetUnseen(seen, now);
    });
  } catch (error) {
    if (error instanceof NamedLockUnavailableError) return report;
    throw error;
  }
  return report;
}

async function sweepPage(
  connection: PoolConnection,
  rows: readonly SweepRow[],
  now: number,
  report: SweepReport,
  seen: Set<number>,
): Promise<boolean> {
  const sent = await readSentNotices(connection, rows);
  for (const row of rows) {
    if (reportTotal(report) >= SWEEP_MAX_ACTIONS) return false;
    const matchId = Number(row.id);
    seen.add(matchId);
    const notices = sent.get(matchId) ?? NO_NOTICES;
    try {
      const done = await applySweepAction(connection, row, sweepAction(row, notices, now), notices, now);
      failureCounts().delete(matchId);
      if (done !== null) report[done] += 1;
    } catch (error) {
      recordFailure(row, error, now);
    }
  }
  return true;
}

function reportTotal(report: SweepReport): number {
  return report.forfeited + report.lapsed + report.retired + report.reminded;
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
