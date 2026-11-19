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
import { loadEntrantMatchLeaderIds, loadNotificationRecipients, notifyUsers, type NotificationReport } from "@/lib/server/notify";
import { toIso } from "@/lib/server/serialization";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { auditStaffAction, publishStaffAction } from "@/lib/server/staff-audit";
import { formatScheduleDeadlineLog } from "@/lib/shared/bot-logs";
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
  SCHEDULE_DEADLINE_ARM_MIN_MS,
  SCHEDULE_DEADLINE_FORFEIT_KEY,
  SCHEDULE_DEADLINE_REMINDERS,
  SCHEDULE_DEADLINE_RETIRED_KEY,
  type DeadlineMatch,
} from "@/lib/shared/schedule-deadline";
import { formatScheduleDeadlineDm, type DeadlineNotice, type DeadlineNoticeKey } from "@/lib/shared/schedule-deadline-notices";
import type { MatchStatus } from "@/lib/shared/types";
import { visibleText } from "@/lib/shared/visible-text";
import { adminResolveMatch } from "./admin";
import { markDeadlineForfeit } from "./bot-logs";
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
 * Gestes (forfaits, retraits, extinctions, avis réservés) par passage au plus :
 * au-delà, la suite attend la minute d'après. Les messages, eux, partent après
 * le verrou ({@link flushSends}), {@link SEND_CONCURRENCY} à la fois.
 */
export const SWEEP_MAX_ACTIONS = 100;
/** Avis envoyés de front (messages privés et push) une fois le verrou rendu. */
export const SEND_CONCURRENCY = 5;
/**
 * Avance au-delà de laquelle un match à planifier, déjà annoncé pour sa paire
 * actuelle, n'a plus rien à faire au balayage : le premier rappel à venir
 * (24 h avant) ouvre sa lecture.
 */
export const SWEEP_LOOKAHEAD_MS = Math.max(
  ...SCHEDULE_DEADLINE_REMINDERS.map((step) => step.beforeMs).filter((ms) => Number.isFinite(ms)),
);
/** Clé de l'annonce (premier palier) : celle qu'un match sans avis pour sa paire attend. */
const ANNOUNCE_KEY = SCHEDULE_DEADLINE_REMINDERS[0].key;
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
): Promise<DeadlineTournament | null> {
  await lockTournamentRow(connection, tournamentId);
  return readDeadlineTournament(connection, tournamentId);
}

type DeadlineTournament = { refereeScheduling: boolean; state: string | null; name: string };

/** Le tournoi d'une date butoir (sans verrou : à l'appelant d'en prendre un s'il écrit). */
async function readDeadlineTournament(
  executor: Pick<PoolConnection, "execute">,
  tournamentId: number,
): Promise<DeadlineTournament | null> {
  const [rows] = await executor.execute<(RowDataPacket & { referee_scheduling: number | null; state: string; name: string | null })[]>(
    `SELECT referee_scheduling, state, name FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  if (!rows[0]) return null;
  return { refereeScheduling: Number(rows[0].referee_scheduling ?? 0) === 1, state: rows[0].state, name: String(rows[0].name ?? "") };
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
  await writeDeadlines(connection, [matchId], deadlineAt);
  return true;
}

/** Matchs par instruction d'une écriture groupée (liste `IN` bornée). */
export const WRITE_CHUNK = 200;

/**
 * Écrit la date butoir de plusieurs matchs et efface leurs avis : une
 * instruction par paquet de {@link WRITE_CHUNK} (et non une par match), pour
 * que le verrou du tournoi ne se tienne pas sur des centaines d'allers-retours.
 */
async function writeDeadlines(connection: PoolConnection, matchIds: readonly number[], deadlineAt: number | null): Promise<void> {
  for (let from = 0; from < matchIds.length; from += WRITE_CHUNK) {
    const ids = matchIds.slice(from, from + WRITE_CHUNK);
    const marks = ids.map(() => "?").join(", ");
    await connection.execute(`UPDATE bg_matches SET schedule_deadline_at = ? WHERE id IN (${marks})`, [
      deadlineAt === null ? null : new Date(deadlineAt),
      ...ids,
    ]);
    await connection.execute(`DELETE FROM bg_schedule_deadline_notices WHERE match_id IN (${marks})`, ids);
  }
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
  const { tournamentId, tournamentName, changed } = await retryOnDeadlock(() =>
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
        const changed = await writeDeadline(connection, matchId, row.schedule_deadline_at, deadlineAt);
        return { tournamentId: id, tournamentName: tournament.name, changed };
      });
    }),
  );
  const written = deadlineAt === null ? null : new Date(deadlineAt).toISOString();
  const auditLine = `[schedule-deadline] match ${matchId} : date butoir ${written ?? "effacée"}${changed ? "" : " (inchangée)"}`;
  if (!changed) {
    // Rien de changé (même date reposée, ou effacer un match qui n'en avait pas) : la trace pm2 seule.
    auditStaffAction(auditLine, actor);
    return written;
  }
  // Anonyme sur Discord (« le staff »), nominatif dans pm2 : la trace d'un geste qui peut finir en double forfait.
  publishStaffAction(
    formatScheduleDeadlineLog({ tournament: { id: tournamentId, name: tournamentName }, matchId, matches: 1, deadlineAt: written }),
    actor,
    { category: "schedule", tournamentId, auditLine },
  );
  publishMatchUpdatedEvent(tournamentId);
  if (written !== null) wakeSweep();
  return written;
}

/**
 * Fixe (ou efface, `null`) la date butoir de **tous** les matchs encore à
 * planifier d'un tournoi (deux engagées connues, sans horaire) — le geste de
 * l'ouverture d'une manche. Effacer vise les mêmes matchs : celle d'un match
 * déjà programmé ou lancé (retirée, lue par le planning) n'est pas touchée.
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
  let input = readScheduleDeadline(raw, now);
  // Trop proche pour une date neuve, mais peut-être celle de la manche, reposée pour les matchs
  // remplis depuis : permise tant qu'une annonce arme encore (vérifié sous verrou).
  const reapplyOnly = input.kind === "invalid" && input.code === "SCHEDULE_DEADLINE_TOO_SOON";
  if (reapplyOnly) input = readScheduleDeadline(raw, now, SCHEDULE_DEADLINE_ARM_MIN_MS);
  if (input.kind === "invalid") throw new Error(reapplyOnly ? "SCHEDULE_DEADLINE_TOO_SOON" : input.code);
  const deadlineAt = input.kind === "set" ? input.at : null;
  const { count, changed, tournamentName } = await retryOnDeadlock(() =>
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
        // Effacer vise, comme poser, les matchs à planifier : la date butoir retirée d'un match déjà
        // programmé ou lancé reste lue par le planning (confirmation d'office), et celle d'une
        // manche pas encore remplie se retire match par match.
        if (reapplyOnly && !rows.some((row) => sameDeadline(row.schedule_deadline_at, deadlineAt))) {
          throw new Error("SCHEDULE_DEADLINE_TOO_SOON");
        }
        const targets = rows.filter((row) => matchLaunchPhase(deadlineMatchOf(row, tournament.refereeScheduling), now) === "TO_PLAN");
        const changing = targets.filter((row) => !sameDeadline(row.schedule_deadline_at, deadlineAt)).map((row) => Number(row.id));
        await writeDeadlines(connection, changing, deadlineAt);
        return { count: targets.length, changed: changing.length, tournamentName: tournament.name };
      }),
    ),
  );
  const written = deadlineAt === null ? null : new Date(deadlineAt).toISOString();
  const auditLine = `[schedule-deadline] tournoi ${tournamentId} : date butoir ${written ?? "effacée"} sur ${count} match(s) (${changed} changée(s))`;
  if (changed === 0) {
    // Rien de changé : la trace pm2 seule (un geste relancé ne remplit pas le journal Discord).
    auditStaffAction(auditLine, actor);
  } else {
    publishStaffAction(
      formatScheduleDeadlineLog({ tournament: { id: tournamentId, name: tournamentName }, matchId: null, matches: changed, deadlineAt: written }),
      actor,
      { category: "schedule", tournamentId, auditLine },
    );
  }
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
  if (!(await forfeitStillDue(connection, tournament, tournamentId, matchId, expectedDeadlineAt, now, true))) return false;
  await adminResolveMatch(connection, matchId, { doubleForfeit: true });
  // La ligne « Match terminé » en dit la raison : aucun arbitre ne l'a prononcé.
  markDeadlineForfeit(connection, matchId);
  return true;
}

/**
 * Le double forfait est-il toujours dû : tournoi `RUNNING`, même date butoir,
 * échue sur un match toujours à planifier, armée à temps pour la paire
 * actuelle et pas retirée. Sous verrou (`locked`) avant le forfait ; sans,
 * pour écarter d'avance un forfait que le verrou refuserait.
 */
async function forfeitStillDue(
  executor: Pick<PoolConnection, "execute">,
  tournament: DeadlineTournament | null,
  tournamentId: number,
  matchId: number,
  expectedDeadlineAt: number,
  now: number,
  locked: boolean,
): Promise<boolean> {
  if (tournament?.state !== "RUNNING") return false;
  const [rows] = await executor.execute<DeadlineRow[]>(
    `SELECT ${MATCH_COLUMNS} FROM bg_matches WHERE id = ? AND tournament_id = ? LIMIT 1${locked ? " FOR UPDATE" : ""}`,
    [matchId, tournamentId],
  );
  const row = rows[0];
  if (!row || row.schedule_deadline_at === null) return false;
  const deadlineAt = new Date(row.schedule_deadline_at).getTime();
  if (deadlineAt !== expectedDeadlineAt) return false;
  const match = deadlineMatchOf(row, tournament.refereeScheduling);
  if (deadlineOutcome(match, deadlineAt, now) !== "FORFEIT") return false;
  const guard = await readForfeitGuard(executor, matchId, launchPairingKey(match.team1Id, match.team2Id));
  return !guard.retired && deadlineArmed(guard.armedAt, deadlineAt);
}

/**
 * Le même contrôle, **sans verrou**, avant d'entrer dans la chaîne d'un
 * forfait (`forfeitMissedScheduleDeadlinePublic`) : un forfait que le verrou
 * refuserait (horaire posé, date butoir changée, tournoi arrêté) n'y lance ni
 * réconciliations ni clôture. Le verrou relit tout.
 */
export async function scheduleDeadlineForfeitDue(
  tournamentId: number,
  matchId: number,
  expectedDeadlineAt: number,
  now: number,
): Promise<boolean> {
  const db = await getDatabase();
  const tournament = await readDeadlineTournament(db, tournamentId);
  return forfeitStillDue(db, tournament, tournamentId, matchId, expectedDeadlineAt, now, false);
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

type NoticeRow = RowDataPacket & {
  match_id: number;
  notice_key: string;
  pairing: string | null;
  sent_at: Date | string;
  delivered: number | null;
};

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
 * remplacée. Un rappel (`toPlan`) exige en plus un match **toujours à
 * planifier** — ni horaire, ni lancement de cette paire, ni résultat, dans un
 * tournoi toujours planifié par l'arbitrage et pas terminé — : la
 * lecture du balayage précède ce verrou, et un horaire posé entre les deux ne
 * doit pas recevoir « toujours sans horaire ». `mine` : le palier `key` est à
 * nous ; `inserted` : les paliers que **cette** réservation a posés (les seuls
 * à rendre si l'envoi échoue).
 */
async function claimNotices(
  executor: Pick<PoolConnection, "execute">,
  row: DeadlineRow,
  deadlineAt: number,
  keys: readonly DeadlineNoticeKey[],
  key: DeadlineNoticeKey,
  now: number,
  toPlan: boolean,
): Promise<{ mine: boolean; inserted: DeadlineNoticeKey[] }> {
  let mine = false;
  const inserted: DeadlineNoticeKey[] = [];
  const pairing = rowPairing(row);
  const stillToPlan = toPlan
    ? ` AND start_at IS NULL AND status NOT IN ('COMPLETED', 'AWAITING_CONFIRMATION')
        AND NOT (launched_at IS NOT NULL AND launch_pairing <=> ?)
        AND EXISTS (SELECT 1 FROM bg_tournaments t
                     WHERE t.id = bg_matches.tournament_id AND t.referee_scheduling = 1 AND t.state <> 'FINISHED')`
    : "";
  for (const each of keys) {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT IGNORE INTO bg_schedule_deadline_notices (match_id, notice_key, pairing, deadline_at, sent_at)
       SELECT id, ?, ?, schedule_deadline_at, ? FROM bg_matches
        WHERE id = ? AND schedule_deadline_at = ? AND team1_id <=> ? AND team2_id <=> ?${stillToPlan}`,
      [
        each,
        pairing,
        new Date(now),
        Number(row.id),
        new Date(deadlineAt),
        nullableId(row.team1_id),
        nullableId(row.team2_id),
        ...(toPlan ? [pairing] : []),
      ],
    );
    const claimed = Number(result.affectedRows ?? 0) > 0;
    if (claimed) inserted.push(each);
    if (each === key) mine = claimed;
  }
  return { mine, inserted };
}

/**
 * Un avis réellement **remis** aux engagées avant l'échéance (ni l'avis de
 * forfait, ni la marque de retrait) : une réservation dont rien n'est parti
 * (bot injoignable, personne de joignable, sujet coupé par tous) n'arme pas.
 */
function armsDeadline(key: string, delivered: number | boolean | null | undefined): boolean {
  return key !== SCHEDULE_DEADLINE_FORFEIT_KEY && key !== SCHEDULE_DEADLINE_RETIRED_KEY && Number(delivered ?? 0) === 1;
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
  const [rows] = await executor.execute<
    (RowDataPacket & { notice_key: string; pairing: string | null; sent_at: SqlDateTime; delivered: number | null })[]
  >(`SELECT notice_key, pairing, sent_at, delivered FROM bg_schedule_deadline_notices WHERE match_id = ?`, [matchId]);
  let armedAt: number | null = null;
  let retired = false;
  for (const row of rows) {
    if (row.notice_key === SCHEDULE_DEADLINE_RETIRED_KEY) retired = true;
    if (pairing === null || row.pairing !== pairing || !armsDeadline(row.notice_key, row.delivered) || row.sent_at === null) continue;
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
export async function sendDeadlineNotices(
  row: SweepRow,
  key: DeadlineNoticeKey,
  deadlineAt: number,
  progress?: SendProgress,
): Promise<number> {
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
    const report = await notifyUsers(recipients, {
      topic: "SCHEDULE_DEADLINE",
      push: (locale) => scheduleDeadlinePush(side.notice, locale),
      discord: { message: (locale) => formatScheduleDeadlineDm(side.notice, base, locale), context: "schedule-deadline" },
      dmFollowsTopic: true,
    });
    sent += 1;
    if (progress) {
      progress.delivered = sent;
      if (reachedSomeone(report)) progress.reached += 1;
      else if (botUnreachable(report)) progress.unreachable += 1;
    }
  }
  return sent;
}

/**
 * Où en est un envoi : `delivered`, les engagées dont l'envoi a été tenté
 * (rendre le palier les préviendrait deux fois) ; `reached`, celles dont au
 * moins un message privé ou un push est **réellement parti** — seul un avis
 * qui a joint quelqu'un arme le double forfait (`markDelivered`).
 */
export type SendProgress = { delivered: number; reached: number; unreachable: number };

/**
 * Personne de joint **parce que le bot n'a pas répondu** (appel perdu ou pas
 * tenté pour des comptes joignables sur Discord) — une panne passagère, à
 * retenter, et non un refus durable (sujet coupé, aucun moyen de joindre).
 */
export function botUnreachable(report: Pick<NotificationReport, "discordUnreachedUserIds"> | null | undefined): boolean {
  return (report?.discordUnreachedUserIds.length ?? 0) > 0;
}

/** Un message privé ou un push au moins est parti (bot injoignable, sujet coupé, aucun appareil : non). */
export function reachedSomeone(report: Pick<NotificationReport, "discord" | "pushed"> | null | undefined): boolean {
  if (!report) return false;
  return (report.discord?.sent ?? 0) > 0 || Number(report.pushed ?? 0) > 0;
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
  const params: (Date | number | string)[] = [
    new Date(now),
    SCHEDULE_DEADLINE_RETIRED_KEY,
    new Date(now),
    new Date(now + SWEEP_LOOKAHEAD_MS),
    ANNOUNCE_KEY,
  ];
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
              SELECT 1 FROM bg_schedule_deadline_notices n WHERE n.match_id = m.id AND n.notice_key = ?))
        AND (m.schedule_deadline_at <= ? OR t.state = 'FINISHED' OR (
              m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL AND t.referee_scheduling = 1
              AND (m.schedule_deadline_at <= ? OR NOT EXISTS (
                SELECT 1 FROM bg_schedule_deadline_notices a
                 WHERE a.match_id = m.id AND a.notice_key = ? AND a.pairing = CONCAT(m.team1_id, ':', m.team2_id)))))${extra}
      ORDER BY m.schedule_deadline_at, m.id
      LIMIT ${SWEEP_BATCH}`,
    params,
  );
  return rows;
}

/** Les avis de chaque match lu, rapportés à sa paire actuelle (pur, testé sans base). */
export function sentNoticesByMatch(
  rows: readonly DeadlineRow[],
  notices: readonly Pick<NoticeRow, "match_id" | "notice_key" | "pairing" | "sent_at" | "delivered">[],
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
    if (armsDeadline(notice.notice_key, notice.delivered)) {
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
    `SELECT match_id, notice_key, pairing, sent_at, delivered FROM bg_schedule_deadline_notices
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
  outbox: PendingSend[],
): Promise<keyof SweepReport | null> {
  const matchId = Number(row.id);
  if (action.kind === "forfeit") {
    const { forfeitMissedScheduleDeadlinePublic } = await import("./index");
    if (!(await forfeitMissedScheduleDeadlinePublic(Number(row.tournament_id), matchId, action.deadlineAt, now))) return null;
    console.info(`[schedule-deadline] match ${matchId} : date butoir passée sans horaire, double forfait`);
    const key = SCHEDULE_DEADLINE_FORFEIT_KEY;
    if ((await claimNotices(connection, row, action.deadlineAt, [key], key, now, false)).mine) {
      outbox.push({ row, key, deadlineAt: action.deadlineAt, release: null });
    }
    return "forfeited";
  }
  if (action.kind === "lapse") return (await lapseDeadline(connection, row, action.deadlineAt)) ? "lapsed" : null;
  if (action.kind === "retire") return (await retireDeadline(connection, row, action.deadlineAt, now)) ? "retired" : null;
  if (action.kind !== "remind") return null;
  // Avis d'une paire précédente : la nouvelle repart de l'annonce. La marque de retrait vaut pour
  // toute paire : elle reste (précaution — un rappel suppose une date butoir à venir, un retrait une
  // date échue, et une date changée efface tous les avis : aucun état atteignable ne les réunit).
  // Une seule transaction : l'effacement des anciens avis et la réservation des nouveaux ne se
  // séparent pas (un arrêt entre les deux laisserait un match sans aucun avis, donc jamais armé).
  const claimed = await transact(connection, async () => {
    if (sent.stale) {
      await connection.execute(
        `DELETE FROM bg_schedule_deadline_notices WHERE match_id = ? AND NOT (pairing <=> ?) AND notice_key <> ?`,
        [matchId, rowPairing(row), SCHEDULE_DEADLINE_RETIRED_KEY],
      );
    }
    return claimNotices(connection, row, action.deadlineAt, action.consumes, action.key, now, true);
  });
  if (!claimed.mine) return null;
  outbox.push({ row, key: action.key, deadlineAt: action.deadlineAt, release: claimed.inserted });
  return "reminded";
}

/**
 * Un avis réservé (`claimNotices`), à envoyer une fois le verrou rendu.
 * `release` : les paliers posés par **cette** réservation — ceux qu'une remise
 * arme (`markDelivered`), et ceux à rendre si l'envoi échoue avant toute
 * remise (un palier parti à un passage antérieur garde sa date d'envoi ; le
 * passage suivant les renvoie) ; `null` pour l'avis de forfait, que rien ne
 * relira (le match est joué).
 */
export type PendingSend = { row: SweepRow; key: DeadlineNoticeKey; deadlineAt: number; release: readonly DeadlineNoticeKey[] | null };

/**
 * Note les paliers d'un avis comme **remis** (un message privé ou un push est
 * parti) : eux seuls arment le double forfait (`armsDeadline`). Ceux de cette
 * date butoir seulement : une date changée pendant l'envoi a ses propres avis.
 */
async function markDelivered(send: PendingSend): Promise<void> {
  if (send.release === null || send.release.length === 0) return;
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_schedule_deadline_notices SET delivered = 1
      WHERE match_id = ? AND pairing <=> ? AND deadline_at = ? AND notice_key IN (${send.release.map(() => "?").join(", ")})`,
    [Number(send.row.id), rowPairing(send.row), new Date(send.deadlineAt), ...send.release],
  );
}

/**
 * Rend les paliers réservés d'un avis qui n'a pu partir. Même paire **et même
 * date butoir** (comme `markDelivered`) : l'envoi se termine hors verrou, et la
 * réservation d'une date butoir posée entre-temps n'est ni rendue ni armée par lui.
 */
async function releaseNotices(send: PendingSend): Promise<void> {
  if (send.release === null || send.release.length === 0) return;
  const db = await getDatabase();
  await db.execute(
    `DELETE FROM bg_schedule_deadline_notices
      WHERE match_id = ? AND pairing <=> ? AND deadline_at = ? AND notice_key IN (${send.release.map(() => "?").join(", ")})`,
    [Number(send.row.id), rowPairing(send.row), new Date(send.deadlineAt), ...send.release],
  );
}

/**
 * Envoie les avis réservés, **hors** du verrou nommé et de sa connexion
 * (messages privés et push attendent le bot : ils ne tiennent ni le verrou ni
 * une connexion du pool), {@link SEND_CONCURRENCY} de front. Un envoi qui
 * échoue ne défait rien du match : un rappel rend ses paliers (rien n'est
 * parti) et compte comme échec du match ; l'avis de forfait, lui, est
 * seulement journalisé.
 */
export async function flushSends(outbox: readonly PendingSend[], now: number): Promise<void> {
  for (let from = 0; from < outbox.length; from += SEND_CONCURRENCY) {
    await Promise.all(
      outbox.slice(from, from + SEND_CONCURRENCY).map(async (send) => {
        const progress: SendProgress = { delivered: 0, reached: 0, unreachable: 0 };
        const matchId = Number(send.row.id);
        try {
          await sendDeadlineNotices(send.row, send.key, send.deadlineAt, progress);
        } catch (error) {
          if (send.release === null) {
            console.error(`[schedule-deadline] match ${matchId} : avis de forfait non envoyé`, failureReason(error));
            return;
          }
          await settleReached(send, progress);
          // Une partie des responsables déjà prévenue : rendre le palier les préviendrait deux fois.
          if (progress.delivered === 0) await releaseNotices(send).catch(() => undefined);
          recordFailure(send.row, error, now);
          return;
        }
        if (send.release === null) return;
        await settleReached(send, progress);
        // L'échec ne compte qu'une fois l'avis parti : une série d'envois en échec n'est pas remise à zéro par
        // la réservation qui les précède (`sweepPage`).
        failureCounts().delete(matchId);
      }),
    );
  }
}

/**
 * Arme la date butoir si l'avis a joint quelqu'un. Personne de joint parce que
 * le bot n'a pas répondu (panne passagère) : la réservation est rendue, le
 * passage suivant retente — sans quoi une courte panne au moment de l'annonce
 * éteindrait la date butoir. Personne de joignable (aucun responsable
 * joignable, sujet coupé par tous) : la réservation reste — pas de renvoi
 * chaque minute — mais n'arme rien, et sans avis remis à temps la date butoir
 * s'éteindra.
 */
async function settleReached(send: PendingSend, progress: SendProgress): Promise<void> {
  const matchId = Number(send.row.id);
  if (progress.reached === 0) {
    if (progress.unreachable > 0 && send.release !== null) {
      console.warn(`[schedule-deadline] match ${matchId} : avis ${send.key} non remis, bot injoignable — nouvel essai au prochain passage`);
      await releaseNotices(send).catch(() => undefined);
      return;
    }
    console.warn(`[schedule-deadline] match ${matchId} : avis ${send.key} remis à personne, date butoir non armée par lui`);
    return;
  }
  await markDelivered(send).catch((error) => {
    console.error(`[schedule-deadline] match ${matchId} : remise de l'avis ${send.key} non notée`, failureReason(error));
  });
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
  const outbox: PendingSend[] = [];
  try {
    await withNamedLock(db, SCHEDULE_DEADLINES_LOCK, 0, async (connection) => {
      const skipIds = parkedIds(now);
      const seen = new Set<number>();
      let after: SweepCursor | null = null;
      let complete = false;
      let capped = false;
      for (let page = 0; page < SWEEP_MAX_PAGES; page += 1) {
        const rows = await readSweepRows(connection, now, skipIds, after);
        if (!(await sweepPage(connection, rows, now, report, seen, outbox))) {
          capped = true;
          break;
        }
        const last = rows[rows.length - 1];
        if (rows.length < SWEEP_BATCH || !last || last.schedule_deadline_at === null) {
          complete = true;
          break;
        }
        after = { deadlineAt: new Date(last.schedule_deadline_at), id: Number(last.id) };
      }
      if (complete) forgetUnseen(seen, now);
      // Les pages sont épuisées sans que la lecture soit finie ni les gestes plafonnés : le balayage
      // sature (les dates butoir les plus lointaines attendent), à rendre visible plutôt que silencieux.
      if (!complete && !capped) {
        console.warn(`[schedule-deadline] balayage saturé : ${SWEEP_MAX_PAGES * SWEEP_BATCH} matchs lus, la suite attend la minute d'après`);
      }
    });
  } catch (error) {
    if (error instanceof NamedLockUnavailableError) return report;
    throw error;
  } finally {
    // Même si la lecture a échoué en route : les avis déjà réservés doivent partir.
    await flushSends(outbox, now);
  }
  return report;
}

async function sweepPage(
  connection: PoolConnection,
  rows: readonly SweepRow[],
  now: number,
  report: SweepReport,
  seen: Set<number>,
  outbox: PendingSend[],
): Promise<boolean> {
  const sent = await readSentNotices(connection, rows);
  for (const row of rows) {
    if (reportTotal(report) >= SWEEP_MAX_ACTIONS) return false;
    const matchId = Number(row.id);
    seen.add(matchId);
    const notices = sent.get(matchId) ?? NO_NOTICES;
    try {
      const done = await applySweepAction(connection, row, sweepAction(row, notices, now), notices, now, outbox);
      // Un rappel réservé n'est réussi qu'une fois parti : `flushSends` efface (ou compte) l'échec.
      if (done !== "reminded") failureCounts().delete(matchId);
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
