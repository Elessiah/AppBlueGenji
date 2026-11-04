/**
 * Salons vocaux d'équipe des matchs (`docs/features/MATCH_VOICE.md`).
 *
 * Deux morceaux — le lancement d'un match **ne dépend pas** des salons
 * (décision du 2026-11-04) :
 *
 * - **le balayage** (`dispatchMatchVoiceChannels`), hors transaction : crée
 *   les salons dus et rend au bot ceux dont le match est joué (score
 *   confirmé), annulé, sorti de l'appariement, passé contre une entrée solo ou
 *   une fantôme, ou dont le tournoi a éteint l'option ou s'est terminé.
 *   Comme les rappels de match, c'est le trafic qui l'entraîne (liste des
 *   tournois, modale de lancement, page du match), étranglé à une passe toutes
 *   les dix secondes ; aucune connexion n'est tenue pendant un appel au bot ;
 * - **la bascule** de l'option (`setTeamVoiceChannels`), à tout moment.
 *
 * Le site ne garde que l'identifiant de chaque salon et ses horaires : il ne
 * demande jamais au bot qui s'y trouve, ni combien.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { ensureVoiceChannel, releaseVoiceChannel } from "@/lib/server/bot-integration";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { toIso } from "@/lib/server/serialization";
import { sqlPlaceholders } from "@/lib/server/sql-placeholders";
import { visibleText } from "@/lib/shared/visible-text";
import { canToggleRefereeScheduling } from "@/lib/shared/match-planning";
import { canViewTournament } from "@/lib/shared/tournament-visibility";
import type { TournamentState } from "@/lib/shared/types";
import {
  VOICE_CHANNEL_LATE_HOURS,
  VOICE_CHANNEL_LEAD_MINUTES,
  VOICE_RETRY_SECONDS,
  VOICE_ROW_RETENTION_DAYS,
  VOICE_SWEEP_THROTTLE_SECONDS,
  matchVoiceInfo,
  voiceChannelKey,
  voiceChannelsDue,
  type MatchVoiceInfo,
  type VoiceChannelState,
} from "@/lib/shared/match-voice";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "./notifications";
import { lockTournamentRow } from "./registration";
import { inTransaction } from "./transaction";

type VoiceRow = RowDataPacket & {
  match_id: number;
  team_id: number;
  channel_id: string | null;
  failed_at: Date | string | null;
  released_at: Date | string | null;
};

/** État d'un salon tel que l'instantané le lit : ouvert, en panne, ou rien. */
function channelState(row: VoiceRow | undefined): VoiceChannelState | null {
  if (!row || row.released_at !== null) return null;
  return { channelId: row.channel_id ?? null, failed: row.failed_at !== null };
}

function rowFor<R extends VoiceRow>(rows: readonly R[], matchId: number, teamId: number | null): R | undefined {
  if (teamId === null) return undefined;
  return rows.find((row) => Number(row.match_id) === matchId && Number(row.team_id) === teamId);
}

/** Ce que l'instantané lit d'un match pour dire l'état de ses salons. */
export type VoiceSnapshotMatch = {
  id: number;
  status: string;
  team1Id: number | null;
  team2Id: number | null;
  startAt: string | null;
  /** Lancement valable pour l'appariement courant ; `null` : pas lancé. */
  launchedAt: string | null;
};

type VoiceTeamRow = RowDataPacket & { id: number; solo: number | null; ghost: number | null };

/**
 * Salons des matchs d'un instantané, deux lectures pour les seuls matchs
 * concernés — et aucune quand l'option est éteinte ou le tournoi pas en cours
 * (`enabled`). Seul un match jouable, programmé, pas encore lancé, et dont les
 * salons sont dus, en montre : ce sont ceux que le balayage ouvre.
 */
export async function loadMatchVoiceInfos(
  connection: PoolConnection,
  enabled: boolean,
  matches: readonly VoiceSnapshotMatch[],
): Promise<Map<number, MatchVoiceInfo>> {
  const result = new Map<number, MatchVoiceInfo>();
  if (!enabled) return result;
  const now = Date.now();
  const candidates = matches.filter(
    (match) =>
      match.status === "READY" &&
      match.launchedAt === null &&
      match.team1Id !== null &&
      match.team2Id !== null &&
      voiceChannelsDue(match.startAt, now),
  );
  if (candidates.length === 0) return result;
  const matchIds = candidates.map((match) => match.id);
  let rows: VoiceRow[];
  try {
    [rows] = await connection.execute<VoiceRow[]>(
      `SELECT match_id, team_id, channel_id, failed_at, released_at
       FROM bg_match_voice_channels
       WHERE match_id IN (${sqlPlaceholders(matchIds.length)}) AND released_at IS NULL`,
      matchIds,
    );
  } catch (error) {
    // Table absente (création avalée au démarrage) : aucun salon.
    if (isMissingTableError(error)) return result;
    throw error;
  }
  const teamIds = [...new Set(candidates.flatMap((match) => [Number(match.team1Id), Number(match.team2Id)]))];
  const [teamRows] = await connection.execute<VoiceTeamRow[]>(
    `SELECT id, solo_user_id IS NOT NULL AS solo, is_ghost AS ghost FROM bg_teams WHERE id IN (${sqlPlaceholders(teamIds.length)})`,
    teamIds,
  );
  const team = (teamId: number | null) => {
    const row = teamRows.find((candidate) => Number(candidate.id) === teamId);
    return { isSolo: Number(row?.solo ?? 0) === 1, isGhost: Number(row?.ghost ?? 0) === 1 };
  };
  for (const match of candidates) {
    const info = matchVoiceInfo(
      { enabled, startAt: match.startAt, team1: team(match.team1Id), team2: team(match.team2Id) },
      channelState(rowFor(rows, match.id, match.team1Id)),
      channelState(rowFor(rows, match.id, match.team2Id)),
    );
    if (info) result.set(match.id, info);
  }
  return result;
}

/* ── Balayage ─────────────────────────────────────────────────────────────── */

/** Une passe au plus toutes les dix secondes : la création suit sans harceler le bot. */
const VOICE_SWEEP_THROTTLE_MS = VOICE_SWEEP_THROTTLE_SECONDS * 1000;
/** Au plus tant de matchs par passe : le reste attend la suivante. */
const VOICE_SWEEP_BATCH = 40;
/** Purge des lignes rendues : au plus une fois par heure, pas à chaque passe. */
const VOICE_PURGE_INTERVAL_MS = 3_600_000;
/**
 * Nom envoyé au bot quand il refuse celui de l'équipe (`INVALID_VOICE_CHANNEL_NAME`) :
 * le même repli que le sien (`FALLBACK_VOICE_NAME`), jamais un pseudo.
 */
export const VOICE_FALLBACK_CHANNEL_NAME = "Salon d'équipe";

type CandidateRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  team1_id: number;
  team2_id: number;
  team1_name: string;
  team2_name: string;
};

type ReleaseRow = RowDataPacket & { match_id: number; team_id: number; channel_id: string | null; tournament_id: number | null };

/**
 * Une équipe de ce match a-t-elle encore un salon à demander ? Non si son
 * salon est ouvert, ou si le bot vient d'échouer (redemandé après
 * `VOICE_RETRY_SECONDS`).
 */
function needsChannel(teamColumn: "team1_id" | "team2_id"): string {
  return `NOT EXISTS (SELECT 1 FROM bg_match_voice_channels v
                       WHERE v.match_id = m.id AND v.team_id = m.${teamColumn} AND v.released_at IS NULL
                         AND (v.channel_id IS NOT NULL OR v.failed_at > NOW() - INTERVAL ${VOICE_RETRY_SECONDS} SECOND))`;
}

/**
 * Matchs dont un salon reste à créer : tournoi en cours à l'option allumée,
 * match jouable programmé dans le quart d'heure (ou passé l'heure de moins de
 * `VOICE_CHANNEL_LATE_HOURS`) et pas encore lancé pour son appariement, deux
 * équipes réelles — **jamais** une entrée solo (le nom du salon serait un
 * pseudo) ni une fantôme. Un match dont les deux salons sont ouverts n'est
 * plus relu.
 */
export const DUE_CHANNELS_SQL = `SELECT m.id, m.tournament_id, m.team1_id, m.team2_id,
       t1.name AS team1_name, t2.name AS team2_name
  FROM bg_matches m
  JOIN bg_tournaments t ON t.id = m.tournament_id
  JOIN bg_teams t1 ON t1.id = m.team1_id
  JOIN bg_teams t2 ON t2.id = m.team2_id
 WHERE t.state = 'RUNNING' AND t.team_voice_channels = 1
   AND m.status = 'READY' AND m.start_at IS NOT NULL
   AND m.start_at <= NOW() + INTERVAL ${VOICE_CHANNEL_LEAD_MINUTES} MINUTE
   AND m.start_at >= NOW() - INTERVAL ${VOICE_CHANNEL_LATE_HOURS} HOUR
   AND (m.launched_at IS NULL OR NOT (m.launch_pairing <=> CONCAT(m.team1_id, ':', m.team2_id)))
   AND t1.solo_user_id IS NULL AND t2.solo_user_id IS NULL
   AND COALESCE(t1.is_ghost, 0) = 0 AND COALESCE(t2.is_ghost, 0) = 0
   AND (${needsChannel("team1_id")} OR ${needsChannel("team2_id")})
 ORDER BY m.start_at, m.id
 LIMIT ${VOICE_SWEEP_BATCH}`;

/**
 * Salons à rendre au bot : match joué (score confirmé) ou disparu, match
 * retombé en attente ou sorti du programme (heure retirée), équipe sortie de
 * l'appariement, entrée solo ou fantôme dans le match, tournoi terminé ou
 * option éteinte. Un rendu refusé attend `VOICE_RETRY_SECONDS` avant d'être
 * redemandé. Le bot supprime le salon s'il est vide, sinon dès qu'il se vide
 * (et ses balayages font filet).
 */
export const RELEASABLE_SQL = `SELECT v.match_id, v.team_id, v.channel_id, m.tournament_id
  FROM bg_match_voice_channels v
  LEFT JOIN bg_matches m ON m.id = v.match_id
  LEFT JOIN bg_tournaments t ON t.id = m.tournament_id
 WHERE v.released_at IS NULL
   AND (v.channel_id IS NULL OR v.failed_at IS NULL
        OR v.failed_at <= NOW() - INTERVAL ${VOICE_RETRY_SECONDS} SECOND)
   AND (m.id IS NULL OR t.id IS NULL
        OR m.status IN ('COMPLETED', 'PENDING') OR m.start_at IS NULL
        OR t.state = 'FINISHED' OR t.team_voice_channels = 0
        OR NOT (v.team_id <=> m.team1_id OR v.team_id <=> m.team2_id)
        OR EXISTS (SELECT 1 FROM bg_teams x
                    WHERE x.id IN (m.team1_id, m.team2_id)
                      AND (x.solo_user_id IS NOT NULL OR COALESCE(x.is_ghost, 0) = 1)))
 ORDER BY v.failed_at IS NOT NULL, v.failed_at, v.match_id, v.team_id
 LIMIT ${VOICE_SWEEP_BATCH}`;

/** Y a-t-il de quoi balayer ? Deux lectures d'index : la plupart des passes s'arrêtent là. */
const SWEEP_NEEDED_SQL = `SELECT
   EXISTS (SELECT 1 FROM bg_tournaments WHERE state = 'RUNNING' AND team_voice_channels = 1) AS due,
   EXISTS (SELECT 1 FROM bg_match_voice_channels WHERE released_at IS NULL) AS open_rows`;

type SweepState = { pending: Promise<void> | null; lastAt: number; again: boolean; purgedAt: number };
const sweepState = globalThis as typeof globalThis & { __bgVoiceSweep?: Partial<SweepState> };
const sweep = Object.assign(
  { pending: null, lastAt: 0, again: false, purgedAt: 0 },
  sweepState.__bgVoiceSweep,
) as SweepState;
sweepState.__bgVoiceSweep = sweep;

/** Ligne de pm2 : un identifiant de match et un code, jamais un nom ni un compte. */
function logFailure(matchId: number, code: string): void {
  console.warn(`[match-voice] match ${matchId} : salon vocal indisponible (${code})`);
}

/** Exécution sur le pool : la connexion est rendue aussitôt, jamais tenue pendant un appel au bot. */
async function run<T extends RowDataPacket[]>(sql: string, params: (string | number)[] = []): Promise<T> {
  const db = await getDatabase();
  const [rows] = await db.execute<T>(sql, params);
  return rows;
}

async function writeChannel(matchId: number, teamId: number, channelId: string): Promise<void> {
  await run(
    `INSERT INTO bg_match_voice_channels (match_id, team_id, channel_id, failed_at, released_at)
     VALUES (?, ?, ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), failed_at = NULL, released_at = NULL`,
    [matchId, teamId, channelId],
  );
}

/**
 * Panne sur la création du salon d'une équipe : `failed_at` (la page dit
 * « indisponible », le balayage redemande après `VOICE_RETRY_SECONDS`). Une
 * ligne déjà rendue (match sorti du programme puis revenu) est **rouverte**
 * sans salon. Les colonnes se lisent avant que `released_at` ne soit remis à
 * `NULL` (affectations de gauche à droite).
 */
async function writeFailure(matchId: number, teamId: number): Promise<void> {
  await run(
    `INSERT INTO bg_match_voice_channels (match_id, team_id, failed_at) VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       channel_id = IF(released_at IS NULL, channel_id, NULL),
       failed_at = NOW(), released_at = NULL`,
    [matchId, teamId],
  );
}

/**
 * Crée le salon d'une équipe (le bot rend le même pour la même clé). Un nom
 * que le bot refuse est remplacé par `VOICE_FALLBACK_CHANNEL_NAME`, une fois.
 * Rend `true` quand ce que la page montre a changé.
 */
async function createTeamChannel(
  matchId: number,
  teamId: number,
  teamName: string,
  existing: VoiceRow | undefined,
): Promise<boolean> {
  const key = voiceChannelKey(matchId, teamId);
  let created = await ensureVoiceChannel(key, teamName);
  if (created.kind !== "ok" && created.code === "INVALID_VOICE_CHANNEL_NAME") {
    created = await ensureVoiceChannel(key, VOICE_FALLBACK_CHANNEL_NAME);
  }
  if (created.kind === "ok") {
    await writeChannel(matchId, teamId, created.value);
    return true;
  }
  const shownFailed = existing?.released_at === null && existing.failed_at !== null;
  // Une seule ligne pm2 par panne : pas de répétition à chaque nouvel essai.
  if (!shownFailed) logFailure(matchId, created.code);
  await writeFailure(matchId, teamId);
  return !shownFailed;
}

async function releaseChannels(touched: Set<number>): Promise<void> {
  const rows = await run<ReleaseRow[]>(RELEASABLE_SQL);
  for (const row of rows) {
    // Une ligne sans salon (création échouée) se clôt sans appel au bot.
    if (row.channel_id !== null) {
      const released = await releaseVoiceChannel(String(row.channel_id));
      // `gone` (`VOICE_CHANNEL_NOT_TRACKED`) : déjà supprimé, rien de plus à faire.
      if (released.kind === "failed") {
        // Redemandé après `VOICE_RETRY_SECONDS`, en fin de file : un rendu qui
        // échoue n'affame pas les autres.
        await run(
          `UPDATE bg_match_voice_channels SET failed_at = NOW() WHERE match_id = ? AND team_id = ? AND released_at IS NULL`,
          [Number(row.match_id), Number(row.team_id)],
        );
        continue;
      }
    }
    await run(
      `UPDATE bg_match_voice_channels SET released_at = NOW() WHERE match_id = ? AND team_id = ? AND released_at IS NULL`,
      [Number(row.match_id), Number(row.team_id)],
    );
    if (row.tournament_id !== null) touched.add(Number(row.tournament_id));
  }
}

async function loadVoiceRows(matchIds: readonly number[]): Promise<VoiceRow[]> {
  if (matchIds.length === 0) return [];
  return run<VoiceRow[]>(
    `SELECT match_id, team_id, channel_id, failed_at, released_at
     FROM bg_match_voice_channels WHERE match_id IN (${sqlPlaceholders(matchIds.length)})`,
    [...matchIds],
  );
}

/**
 * Minimisation : une ligne rendue au bot n'a plus d'usage passé une semaine
 * (un match rejoué recrée la sienne par sa clé). Une fois par heure au plus.
 */
async function purgeReleasedRows(): Promise<void> {
  if (Date.now() - sweep.purgedAt < VOICE_PURGE_INTERVAL_MS) return;
  sweep.purgedAt = Date.now();
  await run(
    `DELETE FROM bg_match_voice_channels
     WHERE released_at IS NOT NULL AND released_at < NOW() - INTERVAL ${VOICE_ROW_RETENTION_DAYS} DAY
     LIMIT ${VOICE_SWEEP_BATCH * 5}`,
  );
}

async function createDueChannels(touched: Set<number>): Promise<void> {
  const candidates = await run<CandidateRow[]>(DUE_CHANNELS_SQL);
  const rows = await loadVoiceRows(candidates.map((row) => Number(row.id)));
  for (const match of candidates) {
    const matchId = Number(match.id);
    for (const [teamId, teamName] of [
      // Nom saisi librement, vers Discord : forme affichable d'abord (`UNTRUSTED_NAMES.md`).
      [Number(match.team1_id), visibleText(String(match.team1_name))],
      [Number(match.team2_id), visibleText(String(match.team2_name))],
    ] as const) {
      const before = rowFor(rows, matchId, teamId);
      // Salon déjà ouvert : rien à demander au bot.
      if (before?.released_at === null && before.channel_id !== null) continue;
      if (await createTeamChannel(matchId, teamId, teamName, before)) touched.add(Number(match.tournament_id));
    }
  }
}

async function runSweep(): Promise<Set<number>> {
  const touched = new Set<number>();
  let needed: (RowDataPacket & { due: number | null; open_rows: number | null })[];
  try {
    needed = await run(SWEEP_NEEDED_SQL);
  } catch (error) {
    // Table absente (création avalée au démarrage) : rien à balayer.
    if (isMissingTableError(error)) return touched;
    throw error;
  }
  const due = Number(needed[0]?.due ?? 0) === 1;
  const open = Number(needed[0]?.open_rows ?? 0) === 1;
  if (due) await createDueChannels(touched);
  if (due || open) await releaseChannels(touched);
  await purgeReleasedRows();
  return touched;
}

/**
 * Passe du balayage des salons, sans attente pour l'appelant (comme les
 * rappels de match) : un bot lent ne retarde aucune lecture. Une seule passe
 * à la fois par processus, au plus une toutes les dix secondes. `rerun` : la
 * passe en cours a pu lire l'état d'avant (bascule de l'option) — une passe
 * de plus suit aussitôt la sienne, et l'étranglement ne la retient pas.
 */
export function dispatchMatchVoiceChannels(rerun = false): Promise<void> {
  if (sweep.pending) {
    if (rerun) sweep.again = true;
    return sweep.pending;
  }
  if (!rerun && Date.now() - sweep.lastAt < VOICE_SWEEP_THROTTLE_MS) return Promise.resolve();
  sweep.lastAt = Date.now();
  sweep.pending = (async () => {
    try {
      do {
        sweep.again = false;
        const touched = await runSweep();
        for (const tournamentId of touched) publishMatchUpdatedEvent(tournamentId);
      } while (sweep.again);
    } catch (error) {
      console.error("[match-voice] balayage en échec", error);
    } finally {
      sweep.lastAt = Date.now();
      sweep.again = false;
      sweep.pending = null;
    }
  })();
  return sweep.pending;
}

/** Remet l'étranglement à zéro (tests). */
export function resetVoiceSweepForTests(): void {
  sweep.pending = null;
  sweep.lastAt = 0;
  sweep.again = false;
  sweep.purgedAt = 0;
}

/* ── Bascule de l'option ──────────────────────────────────────────────────── */

export type TeamVoiceChannelsResult = {
  tournamentId: number;
  tournamentName: string;
  enabled: boolean;
  /** L'option a réellement changé (le journal ne note que ce cas). */
  changed: boolean;
};

/**
 * Allume ou éteint l'option « Salons vocaux d'équipe », à tout moment jusqu'à
 * la clôture du tournoi, en cours compris (décision de l'utilisateur,
 * 2026-11-02) — même règle que la planification par l'arbitrage
 * (`canToggleRefereeScheduling`), que le formulaire applique déjà : un tournoi
 * terminé n'a plus de match à qui ouvrir un salon.
 *
 * - Allumée en cours de tournoi : les matchs à plus d'un quart d'heure ont
 *   leurs salons à T−15 ; ceux déjà dans le quart d'heure, et pas encore
 *   lancés, les reçoivent aussitôt (balayage lancé ici). Un match déjà lancé
 *   n'est pas concerné.
 * - Éteinte : les salons existants sont rendus au bot (balayage lancé ici).
 *
 * Une passe déjà en cours a pu lire l'option d'avant : une passe de plus la
 * suit (`dispatchMatchVoiceChannels(true)`).
 *
 * @throws `TOURNAMENT_NOT_FOUND` | `TOURNAMENT_FINISHED`
 */
export async function setTeamVoiceChannels(tournamentId: number, enabled: boolean): Promise<TeamVoiceChannelsResult> {
  const result = await inTransaction(async (connection) => {
    // Verrou en toute première instruction (piège `REPEATABLE READ`).
    await lockTournamentRow(connection, tournamentId);
    const [rows] = await connection.execute<
      (RowDataPacket & { name: string; state: TournamentState; team_voice_channels: number | null })[]
    >(`SELECT name, state, team_voice_channels FROM bg_tournaments WHERE id = ? LIMIT 1`, [tournamentId]);
    const tournament = rows[0];
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
    if (!canToggleRefereeScheduling(tournament.state)) throw new Error("TOURNAMENT_FINISHED");
    const changed = (Number(tournament.team_voice_channels ?? 0) === 1) !== enabled;
    if (changed) {
      await connection.execute(`UPDATE bg_tournaments SET team_voice_channels = ? WHERE id = ?`, [
        enabled ? 1 : 0,
        tournamentId,
      ]);
    }
    return { tournamentName: tournament.name, changed };
  });

  if (result.changed) {
    publishUpdatedEvent(tournamentId);
    // Création (ou libération) sans attendre le prochain passage du trafic.
    void dispatchMatchVoiceChannels(true);
  }
  return { tournamentId, enabled, tournamentName: result.tournamentName, changed: result.changed };
}

/* ── Lecture d'un match (page du match) ───────────────────────────────────── */

type SingleMatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: string;
  team1_id: number | null;
  team2_id: number | null;
  start_at: Date | string | null;
  launched_at: Date | string | null;
  launch_pairing: string | null;
  team_voice_channels: number | null;
  tournament_state: TournamentState;
  start_visibility_at: Date | string;
};

/**
 * État des salons d'un match pour la page du match, qui le relit, flux coupé
 * seulement (`GET /api/matches/[matchId]/voice`) : la lecture REST de
 * secours de `TournamentMatch.voice`. Lit la base seulement — la création
 * auprès du bot reste au balayage, qu'elle relance sans l'attendre : autant
 * de lecteurs qu'on voudra, jamais plus d'un appel au bot par salon et par
 * passe. `undefined` : match introuvable, ou tournoi pas encore publié pour
 * un lecteur sans la permission `tournaments` (`canViewTournament`, la règle
 * de la fiche du tournoi).
 */
export async function readMatchVoice(matchId: number, staff: boolean): Promise<MatchVoiceInfo | null | undefined> {
  void dispatchMatchVoiceChannels();
  return withConnection(async (connection) => {
    const [rows] = await connection.execute<SingleMatchRow[]>(
      `SELECT m.id, m.tournament_id, m.status, m.team1_id, m.team2_id, m.start_at, m.launched_at,
              m.launch_pairing, t.team_voice_channels, t.state AS tournament_state, t.start_visibility_at
       FROM bg_matches m JOIN bg_tournaments t ON t.id = m.tournament_id
       WHERE m.id = ? LIMIT 1`,
      [matchId],
    );
    const match = rows[0];
    if (!match || !canViewTournament({ startVisibilityAt: match.start_visibility_at }, { canManage: staff })) {
      return undefined;
    }
    const team1Id = match.team1_id === null ? null : Number(match.team1_id);
    const team2Id = match.team2_id === null ? null : Number(match.team2_id);
    const currentPairing = team1Id !== null && team2Id !== null && match.launch_pairing === `${team1Id}:${team2Id}`;
    const enabled = Number(match.team_voice_channels ?? 0) === 1 && match.tournament_state === "RUNNING";
    const infos = await loadMatchVoiceInfos(connection, enabled, [
      {
        id: Number(match.id),
        status: match.status,
        team1Id,
        team2Id,
        startAt: toIso(match.start_at),
        launchedAt: currentPairing ? toIso(match.launched_at) : null,
      },
    ]);
    return infos.get(Number(match.id)) ?? null;
  });
}
