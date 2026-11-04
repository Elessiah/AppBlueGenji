/**
 * Annonce Discord des cartes de manche, **une seule** par série d'enregistrements
 * (`docs/features/ROUND_MAPS.md`).
 *
 * Régler cinq manches à la suite envoyait cinq lignes au journal du staff.
 * L'écriture ne parle plus : elle {@link queueRoundMapsNotice} — dans la
 * transaction même, sous le verrou du tournoi — les manches modifiées dans
 * `bg_round_maps_notices` (une ligne par tournoi) et repousse l'envoi de
 * `ROUND_MAPS_NOTICE_WINDOW_SECONDS` après le dernier changement. Un seul
 * message part ensuite, qui liste les manches (remise à zéro comprise : un
 * retrait est un changement).
 *
 * **Survit à un redémarrage** : l'état est en base, et c'est le trafic qui
 * l'entraîne ({@link dispatchDueRoundMapsNotices}, appelé par la liste des
 * tournois, comme les rappels de match), plus un minuteur de processus qui n'est
 * qu'un accélérateur. **Le signal de fermeture de l'écran** n'est qu'un
 * accélérateur aussi ({@link flushRoundMapsNotice}) : un onglet fermé ne perd
 * rien, la fenêtre échue envoie quand même.
 *
 * La ligne est **revendiquée** par un `DELETE … WHERE changes = ?` : deux
 * balayages concurrents n'envoient pas deux fois, et une modification arrivée
 * entre la lecture et la revendication (`changes` a bougé) garde sa ligne et
 * repart pour une nouvelle fenêtre au lieu d'être perdue.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { flushBotLogBatch, sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { formatRoundMapsSummaryLog } from "@/lib/shared/bot-logs";
import { matchRoundLabel } from "@/lib/shared/discord-notifications";
import { ROUND_MAPS_NOTICE_LISTED, ROUND_MAPS_NOTICE_WINDOW_SECONDS } from "@/lib/shared/round-maps";

/** Une manche (phase, tableau, numéro). */
export type NoticeRound = { phaseId: number; bracket: string; roundNumber: number };

type NoticeRow = RowDataPacket & {
  tournament_id: number;
  rounds_json: string;
  changes: number;
  name: string;
  format: string;
};

type PhaseRow = RowDataPacket & { id: number; position: number; format: string };

const SWEEP_THROTTLE_MS = 15_000;
/**
 * Plafond du signal de fermeture, par tournoi : au plus un envoi anticipé par
 * fenêtre. Sans lui, enregistrer puis fermer en boucle postait une ligne par
 * tour de boucle et défaisait le regroupement.
 */
const FLUSH_MIN_INTERVAL_MS = ROUND_MAPS_NOTICE_WINDOW_SECONDS * 1000;
const lastFlushAt = new Map<number, number>();
/** Envois immédiats en cours, par tournoi : chaînés, jamais concurrents. */
const flushing = new Map<number, Promise<boolean>>();
let lastSweepAt = 0;
let sweeping: Promise<number> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function roundKey(round: NoticeRound): string {
  return `${round.phaseId}:${round.bracket}:${round.roundNumber}`;
}

function parsePending(raw: unknown): NoticeRound[] {
  try {
    const parsed: unknown = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is NoticeRound =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as NoticeRound).bracket === "string" &&
        Number.isInteger((entry as NoticeRound).roundNumber) &&
        Number.isInteger((entry as NoticeRound).phaseId),
    );
  } catch {
    return [];
  }
}

/**
 * Note les manches modifiées et (re)lance la fenêtre. À appeler **dans la
 * transaction** d'écriture, le tournoi déjà verrouillé : lecture puis écriture
 * ne se croisent donc pas.
 */
export async function queueRoundMapsNotice(
  connection: PoolConnection,
  tournamentId: number,
  rounds: readonly NoticeRound[],
): Promise<void> {
  if (rounds.length === 0) return;
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT rounds_json FROM bg_round_maps_notices WHERE tournament_id = ? LIMIT 1`,
    [tournamentId],
  );
  const merged = new Map<string, NoticeRound>();
  for (const entry of rows[0] ? parsePending(rows[0].rounds_json) : []) merged.set(roundKey(entry), entry);
  for (const round of rounds) {
    merged.set(roundKey(round), { phaseId: round.phaseId, bracket: round.bracket, roundNumber: round.roundNumber });
  }
  await connection.execute(
    `INSERT INTO bg_round_maps_notices (tournament_id, rounds_json, changes, send_after)
     VALUES (?, ?, 1, DATE_ADD(NOW(), INTERVAL ? SECOND))
     ON DUPLICATE KEY UPDATE rounds_json = VALUES(rounds_json), changes = changes + 1,
       send_after = VALUES(send_after)`,
    [tournamentId, JSON.stringify([...merged.values()]), ROUND_MAPS_NOTICE_WINDOW_SECONDS],
  );
}

/**
 * Libellés des manches. Un multi-phases préfixe la phase (« Phase 2 · Manche 1 »)
 * et lit le format suisse **de la phase** : sans cela, deux « Manche 1 » de
 * phases différentes se confondaient dans le journal.
 */
async function labelRounds(
  db: Awaited<ReturnType<typeof getDatabase>>,
  row: NoticeRow,
  rounds: NoticeRound[],
): Promise<string[]> {
  const phases = new Map<number, PhaseRow>();
  if (rounds.some((round) => round.phaseId > 0)) {
    const [phaseRows] = await db.execute<PhaseRow[]>(
      `SELECT id, position, format FROM bg_tournament_phases WHERE tournament_id = ?`,
      [row.tournament_id],
    );
    for (const phase of phaseRows) phases.set(Number(phase.id), phase);
  }
  const position = (round: NoticeRound) => Number(phases.get(round.phaseId)?.position ?? 0);
  return [...rounds]
    .sort((a, b) => position(a) - position(b) || a.bracket.localeCompare(b.bracket) || a.roundNumber - b.roundNumber)
    .map((round) => {
      const phase = phases.get(round.phaseId);
      const label = matchRoundLabel(round.bracket, round.roundNumber, (phase?.format ?? row.format) === "SWISS");
      return phase ? `Phase ${Number(phase.position)} · ${label}` : label;
    });
}

/** Revendique puis envoie les lignes données ; rend le nombre de messages partis. */
async function sendClaimed(rows: readonly NoticeRow[]): Promise<number> {
  const db = await getDatabase();
  let sent = 0;
  for (const row of rows) {
    const [result] = await db.execute<ResultSetHeader>(
      `DELETE FROM bg_round_maps_notices WHERE tournament_id = ? AND changes = ?`,
      [row.tournament_id, row.changes],
    );
    if (result.affectedRows !== 1) continue; // un autre l'a prise, ou un changement a rouvert la fenêtre
    const rounds = parsePending(row.rounds_json);
    if (rounds.length === 0) continue;
    const roundLabels = await labelRounds(db, row, rounds);
    sendBotLog(
      formatRoundMapsSummaryLog({
        tournament: { id: Number(row.tournament_id), name: row.name },
        roundLabels,
        listed: ROUND_MAPS_NOTICE_LISTED,
      }),
      { tournamentId: Number(row.tournament_id), category: "maps" },
    );
    sent += 1;
  }
  return sent;
}

const NOTICE_SELECT = `SELECT n.tournament_id, n.rounds_json, n.changes, t.name, t.format
    FROM bg_round_maps_notices n JOIN bg_tournaments t ON t.id = n.tournament_id`;

/**
 * Envoie les annonces dont la fenêtre est échue. Jamais bloquant, jamais une
 * exception : l'appelant est une lecture de page. Étranglé à 15 s.
 */
export async function dispatchDueRoundMapsNotices(): Promise<number> {
  if (sweeping) return sweeping;
  if (Date.now() - lastSweepAt < SWEEP_THROTTLE_MS) return 0;
  sweeping = (async () => {
    try {
      const db = await getDatabase();
      const [rows] = await db.execute<NoticeRow[]>(`${NOTICE_SELECT} WHERE n.send_after <= NOW()`);
      return await sendClaimed(rows);
    } catch (error) {
      console.error("[round-maps] annonces en échec", error);
      return 0;
    }
  })();
  try {
    return await sweeping;
  } finally {
    lastSweepAt = Date.now();
    sweeping = null;
  }
}

/**
 * Envoie tout de suite l'annonce de ce tournoi, fenêtre ou non (écran fermé).
 * Au plus une fois par fenêtre et par tournoi ({@link FLUSH_MIN_INTERVAL_MS}) :
 * au-delà, rien ne part et la fenêtre de silence enverra l'annonce.
 *
 * `ownRounds` (clés `phaseId:bracket:roundNumber`) : les manches que l'écran
 * fermé a écrites. L'annonce en attente ne part que si **toutes** ses manches en
 * sont : une manche qu'un autre membre du staff règle encore reste à la fenêtre
 * de silence, sinon sa série partirait en deux lignes. Sans liste, tout part.
 * @returns `true` si un message est parti.
 */
export async function flushRoundMapsNotice(tournamentId: number, ownRounds?: readonly string[]): Promise<boolean> {
  // Un envoi à la fois par tournoi : une seconde fermeture qui tombe pendant la lecture de la
  // première attend son verdict au lieu d'être écartée par le plafond qu'elle a réservé (et qu'elle
  // rend si rien n'est parti) — ses propres manches ne retombent pas à la fenêtre de silence.
  const queued = (flushing.get(tournamentId) ?? Promise.resolve(false))
    .catch(() => false)
    .then(() => flushNow(tournamentId, ownRounds));
  flushing.set(tournamentId, queued);
  try {
    return await queued;
  } finally {
    if (flushing.get(tournamentId) === queued) flushing.delete(tournamentId);
  }
}

async function flushNow(tournamentId: number, ownRounds?: readonly string[]): Promise<boolean> {
  const now = Date.now();
  if (now - (lastFlushAt.get(tournamentId) ?? 0) < FLUSH_MIN_INTERVAL_MS) return false;
  // Réservé avant le premier `await` : deux fermetures simultanées ne passent
  // pas toutes deux le plafond. Rendu si rien n'est parti.
  for (const [id, at] of lastFlushAt) if (now - at >= FLUSH_MIN_INTERVAL_MS) lastFlushAt.delete(id);
  lastFlushAt.set(tournamentId, now);
  let sent = false;
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<NoticeRow[]>(`${NOTICE_SELECT} WHERE n.tournament_id = ?`, [tournamentId]);
    const own = ownRounds ? new Set(ownRounds) : null;
    const claimable = own
      ? rows.filter((row) => {
          const pending = parsePending(row.rounds_json);
          return pending.length > 0 && pending.every((round) => own.has(roundKey(round)));
        })
      : rows;
    sent = (await sendClaimed(claimable)) > 0;
    // L'écran fermé demande un envoi immédiat : le résumé ne reste pas dans le
    // lot du journal du tournoi (`LOG_BATCHING.md`), qui part avec lui.
    // Sans l'attendre : personne n'a besoin de son aboutissement, et un bot lent
    // ne retient ni l'appelant ni la réservation de `lastFlushAt`.
    if (sent) void flushBotLogBatch({ tournamentId, category: "maps" }).catch(() => undefined);
    return sent;
  } finally {
    if (!sent && lastFlushAt.get(tournamentId) === now) lastFlushAt.delete(tournamentId);
  }
}

/**
 * Accélérateur : un minuteur de processus passe au balayage juste après la
 * fenêtre. Perdu au redémarrage sans conséquence — la base garde l'annonce.
 */
export function scheduleRoundMapsNotice(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    lastSweepAt = 0;
    void dispatchDueRoundMapsNotices();
  }, (ROUND_MAPS_NOTICE_WINDOW_SECONDS + 2) * 1000);
  timer.unref?.();
}

/** Remet l'état du processus à zéro. Réservé aux tests. */
export function resetRoundMapsNoticeState(): void {
  lastSweepAt = 0;
  lastFlushAt.clear();
  flushing.clear();
  sweeping = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
