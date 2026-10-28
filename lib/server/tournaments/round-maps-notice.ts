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
import { sendBotLog } from "@/lib/server/bot-integration";
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

const SWEEP_THROTTLE_MS = 15_000;
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
    const swiss = row.format === "SWISS";
    const roundLabels = parsePending(row.rounds_json)
      .sort((a, b) => a.phaseId - b.phaseId || a.bracket.localeCompare(b.bracket) || a.roundNumber - b.roundNumber)
      .map((round) => matchRoundLabel(round.bracket, round.roundNumber, swiss));
    if (roundLabels.length === 0) continue;
    await sendBotLog(
      formatRoundMapsSummaryLog({
        tournament: { id: Number(row.tournament_id), name: row.name },
        roundLabels,
        listed: ROUND_MAPS_NOTICE_LISTED,
      }),
    ).catch((error: unknown) => console.error("[round-maps] journal non envoyé", error));
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
 * @returns `true` si un message est parti.
 */
export async function flushRoundMapsNotice(tournamentId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<NoticeRow[]>(`${NOTICE_SELECT} WHERE n.tournament_id = ?`, [tournamentId]);
  return (await sendClaimed(rows)) > 0;
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
  sweeping = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
