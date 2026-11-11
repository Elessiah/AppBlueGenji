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
import {
  ROUND_MAPS_NOTICE_KEYS_MAX,
  ROUND_MAPS_NOTICE_LISTED,
  ROUND_MAPS_NOTICE_WINDOW_SECONDS,
} from "@/lib/shared/round-maps";

/**
 * Une manche (phase, tableau, numéro). `tiebreak` : seule sa **map de
 * départage** a changé — l'annonce le dit, au lieu de laisser croire que les
 * cartes du tour ont bougé.
 */
export type NoticeRound = { phaseId: number; bracket: string; roundNumber: number; tiebreak?: true };

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
/** Un balayage demandé pendant qu'un autre était en vol : rejoué à sa suite. */
let sweepAgain = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Clé d'une manche en attente — celle de sa map de départage est à part. */
function pendingKey(round: NoticeRound): string {
  return `${roundKey(round)}${round.tiebreak ? ":T" : ""}`;
}

/** Clé d'une manche (`phaseId:bracket:roundNumber`), celle que l'écran envoie à la fermeture. */
function roundKey(round: NoticeRound): string {
  return `${round.phaseId}:${round.bracket}:${round.roundNumber}`;
}

/** Manches au-delà du plafond : un dernier élément `{ more: n }` de `rounds_json`. */
type Overflow = { more: number };

function parseStored(raw: unknown): unknown[] {
  try {
    const parsed: unknown = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parsePending(raw: unknown): NoticeRound[] {
  return parseStored(raw).filter(
    (entry): entry is NoticeRound =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as NoticeRound).bracket === "string" &&
      Number.isInteger((entry as NoticeRound).roundNumber) &&
      Number.isInteger((entry as NoticeRound).phaseId),
  );
}

/** Nombre de manches comptées sans être retenues (`ROUND_MAPS_NOTICE_KEYS_MAX`). */
function parseOverflow(raw: unknown): number {
  let more = 0;
  for (const entry of parseStored(raw)) {
    const value = typeof entry === "object" && entry !== null ? (entry as Partial<Overflow>).more : undefined;
    if (typeof value === "number" && Number.isInteger(value) && value > 0) more += value;
  }
  return more;
}

/**
 * Note les manches modifiées et (re)lance la fenêtre. À appeler **dans la
 * transaction** d'écriture, le tournoi déjà verrouillé : deux mises en attente
 * ne se croisent donc pas.
 *
 * Un **balayage**, lui, ne prend pas le verrou du tournoi : la ligne est donc
 * **prise d'abord** (l'écriture qui avance `changes` et repousse la fenêtre),
 * lue ensuite. Lue d'abord, sans verrou, un balayage pouvait la revendiquer
 * entre la lecture et l'écriture : ses manches, déjà annoncées, reparaissaient
 * dans le résumé suivant. Une fois la ligne prise, le `DELETE … WHERE changes
 * = ?` du balayage attend le commit, puis ne la trouve plus à son compte. Un
 * `SELECT … FOR UPDATE` aurait le même effet sur une ligne présente, mais
 * poserait un verrou d'intervalle sur une ligne absente (interblocage entre
 * deux tournois réglés en même temps).
 *
 * `tiebreak` : le changement ne porte que sur la map de départage du tour.
 */
export async function queueRoundMapsNotice(
  connection: PoolConnection,
  tournamentId: number,
  rounds: readonly NoticeRound[],
  options: { tiebreak?: boolean } = {},
): Promise<void> {
  if (rounds.length === 0) return;
  await connection.execute(
    `INSERT INTO bg_round_maps_notices (tournament_id, rounds_json, changes, send_after)
     VALUES (?, '[]', 1, DATE_ADD(NOW(), INTERVAL ? SECOND))
     ON DUPLICATE KEY UPDATE changes = changes + 1, send_after = VALUES(send_after)`,
    [tournamentId, ROUND_MAPS_NOTICE_WINDOW_SECONDS],
  );
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT rounds_json FROM bg_round_maps_notices WHERE tournament_id = ? LIMIT 1`,
    [tournamentId],
  );
  const stored = rows[0]?.rounds_json;
  const merged = new Map<string, NoticeRound>();
  for (const entry of parsePending(stored)) merged.set(pendingKey(entry), entry);
  let more = parseOverflow(stored);
  for (const round of rounds) {
    const entry: NoticeRound = {
      phaseId: round.phaseId,
      bracket: round.bracket,
      roundNumber: round.roundNumber,
      ...(options.tiebreak ? { tiebreak: true as const } : {}),
    };
    const key = pendingKey(entry);
    // Plafond : une manche de plus n'est que comptée (jamais « Data too long »).
    // Compte approché : faute de clé retenue, une manche réglée deux fois
    // au-delà du plafond compte deux fois.
    if (!merged.has(key) && merged.size >= ROUND_MAPS_NOTICE_KEYS_MAX) more += 1;
    else merged.set(key, entry);
  }
  const pending: (NoticeRound | Overflow)[] = [...merged.values()];
  if (more > 0) pending.push({ more });
  await connection.execute(`UPDATE bg_round_maps_notices SET rounds_json = ? WHERE tournament_id = ?`, [
    JSON.stringify(pending),
    tournamentId,
  ]);
}

/**
 * Ordre des tableaux dans l'annonce : principal, perdants, grande finale,
 * petite finale. Trié par nom, la grande finale et les perdants passaient avant
 * le tableau principal, dont les tours se repliaient dans « et N autres ».
 */
const BRACKET_ORDER: readonly string[] = ["UPPER", "LOWER", "GRAND", "THIRD_PLACE"];

function bracketRank(bracket: string): number {
  const rank = BRACKET_ORDER.indexOf(bracket);
  return rank === -1 ? BRACKET_ORDER.length : rank;
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
    .sort(
      (a, b) =>
        position(a) - position(b) ||
        bracketRank(a.bracket) - bracketRank(b.bracket) ||
        a.bracket.localeCompare(b.bracket) ||
        a.roundNumber - b.roundNumber ||
        Number(a.tiebreak ?? false) - Number(b.tiebreak ?? false),
    )
    .map((round) => {
      const phase = phases.get(round.phaseId);
      const name = matchRoundLabel(round.bracket, round.roundNumber, (phase?.format ?? row.format) === "SWISS");
      const label = round.tiebreak ? `${name} (map de départage)` : name;
      return phase ? `Phase ${Number(phase.position)} · ${label}` : label;
    });
}

/**
 * Une manche dont les cartes **et** la map de départage ont changé n'est dite
 * (et comptée) qu'une fois : « cartes de manche modifiées » couvre son départage.
 */
function withoutCoveredTiebreaks(rounds: readonly NoticeRound[]): NoticeRound[] {
  const mapsChanged = new Set(rounds.filter((round) => !round.tiebreak).map(roundKey));
  return rounds.filter((round) => !round.tiebreak || !mapsChanged.has(roundKey(round)));
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
    const rounds = withoutCoveredTiebreaks(parsePending(row.rounds_json));
    if (rounds.length === 0) continue;
    const roundLabels = await labelRounds(db, row, rounds);
    sendBotLog(
      formatRoundMapsSummaryLog({
        tournament: { id: Number(row.tournament_id), name: row.name },
        roundLabels,
        listed: ROUND_MAPS_NOTICE_LISTED,
        more: parseOverflow(row.rounds_json),
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
 *
 * `rerun` (le minuteur de fin de fenêtre) : si un balayage est déjà en vol, il
 * a pu lire `send_after` juste avant l'échéance — un autre part à sa suite, au
 * lieu de laisser l'annonce attendre la prochaine lecture de la liste.
 */
export async function dispatchDueRoundMapsNotices(rerun = false): Promise<number> {
  if (sweeping) {
    if (rerun) sweepAgain = true;
    return sweeping;
  }
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
    if (sweepAgain) {
      sweepAgain = false;
      lastSweepAt = 0;
      void dispatchDueRoundMapsNotices();
    }
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
          // Des manches seulement comptées (plafond) peuvent être celles d'un
          // autre : on ne sait pas, l'annonce reste à la fenêtre de silence.
          return (
            pending.length > 0 &&
            parseOverflow(row.rounds_json) === 0 &&
            pending.every((round) => own.has(roundKey(round)))
          );
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
    void dispatchDueRoundMapsNotices(true);
  }, (ROUND_MAPS_NOTICE_WINDOW_SECONDS + 2) * 1000);
  timer.unref?.();
}

/** Remet l'état du processus à zéro. Réservé aux tests. */
export function resetRoundMapsNoticeState(): void {
  lastSweepAt = 0;
  lastFlushAt.clear();
  flushing.clear();
  sweeping = null;
  sweepAgain = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
