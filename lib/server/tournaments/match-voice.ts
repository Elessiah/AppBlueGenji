/**
 * Salons vocaux d'équipe des matchs (`docs/features/MATCH_VOICE.md`).
 *
 * Trois morceaux :
 *
 * - **le verrou** (`voiceGateBlocksLaunch`), lu dans la transaction qui décide
 *   d'un lancement (« Prêt », lancement d'office, départ à l'heure d'un
 *   tournoi sans phase de lancement) : il ne lit que la base — jamais le bot,
 *   aucun appel réseau ne se fait sous verrou ;
 * - **le balayage** (`dispatchMatchVoiceChannels`), hors transaction : crée
 *   les salons dus, recompte ceux qui retiennent un lancement, rend au bot
 *   ceux dont le match est joué (score confirmé), annulé, sorti de
 *   l'appariement, ou dont le tournoi a éteint l'option ou s'est terminé.
 *   Comme les rappels de match, c'est le trafic qui l'entraîne (liste des
 *   tournois, modale de lancement, page du match qui attend ses salons),
 *   étranglé à une passe toutes les dix secondes ;
 * - **la bascule** de l'option (`setTeamVoiceChannels`), à tout moment.
 *
 * Le site ne garde que l'identifiant de chaque salon et le **nombre** de
 * personnes que le bot y compte : jamais qui.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { countVoiceChannel, ensureVoiceChannel, releaseVoiceChannel } from "@/lib/server/bot-integration";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { toIso } from "@/lib/server/serialization";
import { sqlPlaceholders } from "@/lib/server/sql-placeholders";
import {
  VOICE_CHANNEL_LEAD_MINUTES,
  VOICE_ROW_RETENTION_DAYS,
  matchVoiceInfo,
  voiceChannelKey,
  voiceGatePending,
  type MatchVoiceInfo,
  type VoiceChannelState,
} from "@/lib/shared/match-voice";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "./notifications";
import { inTransaction } from "./transaction";

type VoiceRow = RowDataPacket & {
  match_id: number;
  team_id: number;
  channel_id: string | null;
  members: number | null;
  failed_at: Date | string | null;
  released_at: Date | string | null;
};

function channelState(row: VoiceRow | undefined): VoiceChannelState | null {
  if (!row || row.released_at !== null) return null;
  return {
    channelId: row.channel_id ?? null,
    members: row.members === null ? null : Number(row.members),
    failed: row.failed_at !== null,
  };
}

async function loadVoiceRows(connection: PoolConnection, matchIds: readonly number[]): Promise<VoiceRow[]> {
  if (matchIds.length === 0) return [];
  try {
    const [rows] = await connection.execute<VoiceRow[]>(
      `SELECT match_id, team_id, channel_id, members, failed_at, released_at
       FROM bg_match_voice_channels WHERE match_id IN (${sqlPlaceholders(matchIds.length)})`,
      [...matchIds],
    );
    return rows;
  } catch (error) {
    // Table absente (création avalée au démarrage) : aucun salon, aucun verrou.
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

function rowFor<R extends VoiceRow>(rows: readonly R[], matchId: number, teamId: number | null): R | undefined {
  if (teamId === null) return undefined;
  return rows.find((row) => Number(row.match_id) === matchId && Number(row.team_id) === teamId);
}

/** Ce que le verrou lit d'un match en cours de lancement. */
export type VoiceGateMatch = {
  id: number;
  tournament_id: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_is_ghost: number | null;
  team2_is_ghost: number | null;
  start_at: Date | string | null;
};

/**
 * Le verrou des salons retient-il le lancement de ce match ? Lu dans la
 * transaction du lancement, après le verrou du match. Une option éteinte ne
 * coûte qu'une lecture par clé primaire.
 */
export async function voiceGateBlocksLaunch(connection: PoolConnection, match: VoiceGateMatch): Promise<boolean> {
  if (match.team1_id === null || match.team2_id === null || match.start_at === null) return false;
  const [context] = await connection.execute<
    (RowDataPacket & { enabled: number | null; team1_solo: number | null; team2_solo: number | null })[]
  >(
    `SELECT
       (SELECT team_voice_channels FROM bg_tournaments WHERE id = ?) AS enabled,
       (SELECT solo_user_id IS NOT NULL FROM bg_teams WHERE id = ?) AS team1_solo,
       (SELECT solo_user_id IS NOT NULL FROM bg_teams WHERE id = ?) AS team2_solo`,
    [Number(match.tournament_id), Number(match.team1_id), Number(match.team2_id)],
  );
  if (Number(context[0]?.enabled ?? 0) !== 1) return false;
  const rows = await loadVoiceRows(connection, [Number(match.id)]);
  return voiceGatePending({
    enabled: true,
    startAt: toIso(match.start_at),
    team1: { isSolo: Number(context[0]?.team1_solo ?? 0) === 1, isGhost: Number(match.team1_is_ghost ?? 0) === 1 },
    team2: { isSolo: Number(context[0]?.team2_solo ?? 0) === 1, isGhost: Number(match.team2_is_ghost ?? 0) === 1 },
    team1Channel: channelState(rowFor(rows, Number(match.id), Number(match.team1_id))),
    team2Channel: channelState(rowFor(rows, Number(match.id), Number(match.team2_id))),
  });
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

type VoiceTeamRow = VoiceRow & { solo: number | null; ghost: number | null };

/**
 * Salons des matchs d'un instantané, une lecture pour tout le plateau — et
 * aucune quand l'option est éteinte. Seul un match jouable, programmé, pas
 * encore lancé et dont un salon existe en montre : après le départ, le
 * remplissage ne décide plus de rien.
 */
export async function loadMatchVoiceInfos(
  connection: PoolConnection,
  tournamentId: number,
  enabled: boolean,
  matches: readonly VoiceSnapshotMatch[],
): Promise<Map<number, MatchVoiceInfo>> {
  const result = new Map<number, MatchVoiceInfo>();
  if (!enabled) return result;
  let rows: VoiceTeamRow[];
  try {
    [rows] = await connection.execute<VoiceTeamRow[]>(
      `SELECT v.match_id, v.team_id, v.channel_id, v.members, v.failed_at, v.released_at,
              tm.solo_user_id IS NOT NULL AS solo, tm.is_ghost AS ghost
       FROM bg_match_voice_channels v
       JOIN bg_matches m ON m.id = v.match_id
       LEFT JOIN bg_teams tm ON tm.id = v.team_id
       WHERE m.tournament_id = ? AND m.status = 'READY' AND v.released_at IS NULL`,
      [tournamentId],
    );
  } catch (error) {
    if (isMissingTableError(error)) return result;
    throw error;
  }
  if (rows.length === 0) return result;
  const team = (row: VoiceTeamRow | undefined) => ({
    isSolo: Number(row?.solo ?? 0) === 1,
    isGhost: Number(row?.ghost ?? 0) === 1,
  });
  for (const match of matches) {
    if (match.status !== "READY" || match.launchedAt !== null || match.startAt === null) continue;
    const team1 = rowFor(rows, match.id, match.team1Id);
    const team2 = rowFor(rows, match.id, match.team2Id);
    if (!team1 && !team2) continue;
    const info = matchVoiceInfo({
      enabled,
      startAt: match.startAt,
      team1: team(team1),
      team2: team(team2),
      team1Channel: channelState(team1),
      team2Channel: channelState(team2),
    });
    if (info) result.set(match.id, info);
  }
  return result;
}

/* ── Balayage ─────────────────────────────────────────────────────────────── */

/** Une passe au plus toutes les dix secondes : le comptage suit sans harceler le bot. */
const VOICE_SWEEP_THROTTLE_MS = 10_000;
/** Au plus tant de matchs par passe : le reste attend la suivante. */
const VOICE_SWEEP_BATCH = 40;

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
 * Matchs dont les salons sont dus : tournoi en cours à l'option allumée, match
 * jouable programmé dans le quart d'heure (ou passé l'heure) et pas encore
 * lancé pour son appariement, deux équipes réelles — **jamais** une entrée
 * solo (le nom du salon serait un pseudo) ni une fantôme.
 */
const DUE_CHANNELS_SQL = `SELECT m.id, m.tournament_id, m.team1_id, m.team2_id,
       t1.name AS team1_name, t2.name AS team2_name
  FROM bg_matches m
  JOIN bg_tournaments t ON t.id = m.tournament_id
  JOIN bg_teams t1 ON t1.id = m.team1_id
  JOIN bg_teams t2 ON t2.id = m.team2_id
 WHERE t.state = 'RUNNING' AND t.team_voice_channels = 1
   AND m.status = 'READY' AND m.start_at IS NOT NULL
   AND m.start_at <= NOW() + INTERVAL ${VOICE_CHANNEL_LEAD_MINUTES} MINUTE
   AND (m.launched_at IS NULL OR NOT (m.launch_pairing <=> CONCAT(m.team1_id, ':', m.team2_id)))
   AND t1.solo_user_id IS NULL AND t2.solo_user_id IS NULL
   AND COALESCE(t1.is_ghost, 0) = 0 AND COALESCE(t2.is_ghost, 0) = 0
 ORDER BY m.id
 LIMIT ${VOICE_SWEEP_BATCH}`;

/**
 * Salons à rendre au bot : match joué (score confirmé) ou disparu, match
 * retombé en attente, équipe sortie de l'appariement, tournoi terminé ou
 * option éteinte. Le bot supprime le salon s'il est vide, sinon dès qu'il se
 * vide (et ses balayages font filet).
 */
const RELEASABLE_SQL = `SELECT v.match_id, v.team_id, v.channel_id, m.tournament_id
  FROM bg_match_voice_channels v
  LEFT JOIN bg_matches m ON m.id = v.match_id
  LEFT JOIN bg_tournaments t ON t.id = m.tournament_id
 WHERE v.released_at IS NULL
   AND (m.id IS NULL OR t.id IS NULL
        OR m.status IN ('COMPLETED', 'PENDING')
        OR t.state = 'FINISHED' OR t.team_voice_channels = 0
        OR NOT (v.team_id <=> m.team1_id OR v.team_id <=> m.team2_id))
 ORDER BY v.match_id, v.team_id
 LIMIT ${VOICE_SWEEP_BATCH}`;

const sweepState = globalThis as typeof globalThis & {
  __bgVoiceSweep?: { pending: Promise<void> | null; lastAt: number };
};
const sweep = (sweepState.__bgVoiceSweep ??= { pending: null, lastAt: 0 });

/** Ligne de pm2 : un identifiant de match et un code, jamais un nom ni un compte. */
function logBypass(matchId: number, code: string): void {
  console.warn(`[match-voice] match ${matchId} : bot indisponible (${code}) — verrou du lancement levé`);
}

async function writeChannel(
  connection: PoolConnection,
  matchId: number,
  teamId: number,
  channelId: string,
): Promise<void> {
  await connection.execute(
    `INSERT INTO bg_match_voice_channels (match_id, team_id, channel_id, failed_at, released_at)
     VALUES (?, ?, ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       members = IF(channel_id <=> VALUES(channel_id), members, NULL),
       counted_at = IF(channel_id <=> VALUES(channel_id), counted_at, NULL),
       channel_id = VALUES(channel_id), failed_at = NULL, released_at = NULL`,
    [matchId, teamId, channelId],
  );
}

async function writeFailure(connection: PoolConnection, matchId: number, teamId: number): Promise<void> {
  await connection.execute(
    `INSERT INTO bg_match_voice_channels (match_id, team_id, failed_at) VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE failed_at = NOW()`,
    [matchId, teamId],
  );
}

async function writeCount(
  connection: PoolConnection,
  matchId: number,
  teamId: number,
  members: number,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_match_voice_channels SET members = ?, counted_at = NOW(), failed_at = NULL
     WHERE match_id = ? AND team_id = ?`,
    [Math.min(members, 255), matchId, teamId],
  );
}

/** Empreinte de ce qu'un lecteur voit d'un salon : un changement se publie. */
function stateKey(row: VoiceRow | undefined): string {
  if (!row || row.released_at !== null) return "none";
  return `${row.channel_id ?? "-"}:${row.members ?? "-"}:${row.failed_at === null ? 0 : 1}`;
}

/**
 * Crée si besoin, puis compte, le salon d'une équipe. Un salon que le bot ne
 * suit plus (supprimé à la main, sorti de la catégorie) est redemandé par sa
 * clé, une fois. Toute panne lève le verrou du match (`failed_at`).
 */
async function recordFailure(
  connection: PoolConnection,
  matchId: number,
  teamId: number,
  existing: VoiceRow | undefined,
  code: string,
): Promise<void> {
  // Une seule ligne pm2 par panne : pas de répétition à chaque balayage.
  if (existing?.failed_at == null) logBypass(matchId, code);
  await writeFailure(connection, matchId, teamId);
}

async function refreshTeamChannel(
  connection: PoolConnection,
  matchId: number,
  teamId: number,
  teamName: string,
  existing: VoiceRow | undefined,
): Promise<void> {
  const key = voiceChannelKey(matchId, teamId);
  let channelId = existing && existing.released_at === null ? existing.channel_id : null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (channelId === null) {
      const created = await ensureVoiceChannel(key, teamName);
      if (created.kind !== "ok") return recordFailure(connection, matchId, teamId, existing, created.code);
      channelId = created.value;
      await writeChannel(connection, matchId, teamId, channelId);
    }
    const counted = await countVoiceChannel(channelId);
    if (counted.kind === "ok") return writeCount(connection, matchId, teamId, counted.value);
    if (counted.kind === "failed") return recordFailure(connection, matchId, teamId, existing, counted.code);
    // `gone` : le bot ne le suit plus — une nouvelle demande le recrée.
    channelId = null;
  }
}

async function releaseChannels(connection: PoolConnection, touched: Set<number>): Promise<void> {
  const [rows] = await connection.execute<ReleaseRow[]>(RELEASABLE_SQL);
  for (const row of rows) {
    // Une ligne sans salon (création échouée) se clôt sans appel au bot.
    if (row.channel_id !== null) {
      const released = await releaseVoiceChannel(String(row.channel_id));
      // `gone` (`VOICE_CHANNEL_NOT_TRACKED`) : déjà supprimé, rien de plus à faire.
      if (released.kind === "failed") continue;
    }
    await connection.execute(
      `UPDATE bg_match_voice_channels SET released_at = NOW() WHERE match_id = ? AND team_id = ? AND released_at IS NULL`,
      [Number(row.match_id), Number(row.team_id)],
    );
    if (row.tournament_id !== null) touched.add(Number(row.tournament_id));
  }
}

async function runSweep(): Promise<Set<number>> {
  const touched = new Set<number>();
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    let candidates: CandidateRow[];
    try {
      [candidates] = await connection.execute<CandidateRow[]>(DUE_CHANNELS_SQL);
    } catch (error) {
      if (isMissingTableError(error)) return touched;
      throw error;
    }
    const rows = await loadVoiceRows(
      connection,
      candidates.map((row) => Number(row.id)),
    );
    for (const match of candidates) {
      const matchId = Number(match.id);
      for (const [teamId, teamName] of [
        [Number(match.team1_id), String(match.team1_name)],
        [Number(match.team2_id), String(match.team2_name)],
      ] as const) {
        const before = rowFor(rows, matchId, teamId);
        await refreshTeamChannel(connection, matchId, teamId, teamName, before);
        const [after] = await connection.execute<VoiceRow[]>(
          `SELECT match_id, team_id, channel_id, members, failed_at, released_at
           FROM bg_match_voice_channels WHERE match_id = ? AND team_id = ?`,
          [matchId, teamId],
        );
        if (stateKey(before) !== stateKey(after[0])) touched.add(Number(match.tournament_id));
      }
    }
    await releaseChannels(connection, touched);
    // Minimisation : une ligne rendue au bot n'a plus d'usage passé une
    // semaine (un match rejoué recrée la sienne par sa clé).
    await connection.execute(
      `DELETE FROM bg_match_voice_channels
       WHERE released_at IS NOT NULL AND released_at < NOW() - INTERVAL ${VOICE_ROW_RETENTION_DAYS} DAY
       LIMIT ${VOICE_SWEEP_BATCH * 5}`,
    );
  } finally {
    connection.release();
  }
  return touched;
}

/**
 * Rejoue l'entretien des lancements d'un tournoi : un verrou qui vient de se
 * lever (salons pleins, bot en panne, option éteinte) laisse partir le match
 * sans attendre la passe suivante.
 */
export async function maintainVoiceLaunches(tournamentId: number): Promise<void> {
  const { maintainMatchLaunches } = await import("./match-launch");
  await inTransaction((connection) => maintainMatchLaunches(connection, tournamentId));
}

/**
 * Passe du balayage des salons, sans attente pour l'appelant (comme les
 * rappels de match) : un bot lent ne retarde aucune lecture. Une seule passe
 * à la fois par processus, au plus une toutes les dix secondes.
 */
export function dispatchMatchVoiceChannels(): Promise<void> {
  if (sweep.pending) return sweep.pending;
  if (Date.now() - sweep.lastAt < VOICE_SWEEP_THROTTLE_MS) return Promise.resolve();
  sweep.lastAt = Date.now();
  sweep.pending = (async () => {
    try {
      const touched = await runSweep();
      for (const tournamentId of touched) {
        await maintainVoiceLaunches(tournamentId).catch((error: unknown) => {
          console.error("[match-voice] entretien des lancements impossible", error);
        });
        publishMatchUpdatedEvent(tournamentId);
      }
    } catch (error) {
      console.error("[match-voice] balayage en échec", error);
    } finally {
      sweep.lastAt = Date.now();
      sweep.pending = null;
    }
  })();
  return sweep.pending;
}

/** Remet l'étranglement à zéro (tests). */
export function resetVoiceSweepForTests(): void {
  sweep.pending = null;
  sweep.lastAt = 0;
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
 * Allume ou éteint l'option « Salons vocaux d'équipe », dans **tout** état du
 * tournoi (décision de l'utilisateur, 2026-11-02).
 *
 * - Allumée en cours de tournoi : les matchs à plus d'un quart d'heure ont
 *   leurs salons à T−15 ; ceux déjà dans le quart d'heure, et pas encore
 *   lancés, les reçoivent aussitôt (balayage lancé ici) et le verrou s'y
 *   applique. Un match déjà lancé n'est pas concerné.
 * - Éteinte : le verrou tombe aussitôt pour tout match non lancé (l'entretien
 *   est rejoué ici), et les salons existants sont rendus au bot.
 *
 * @throws `TOURNAMENT_NOT_FOUND`
 */
export async function setTeamVoiceChannels(tournamentId: number, enabled: boolean): Promise<TeamVoiceChannelsResult> {
  const result = await withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      // Verrou en toute première instruction (piège `REPEATABLE READ`).
      const [rows] = await connection.execute<
        (RowDataPacket & { name: string; team_voice_channels: number | null })[]
      >(`SELECT name, team_voice_channels FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`, [tournamentId]);
      const tournament = rows[0];
      if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
      const changed = (Number(tournament.team_voice_channels ?? 0) === 1) !== enabled;
      if (changed) {
        await connection.execute(`UPDATE bg_tournaments SET team_voice_channels = ? WHERE id = ?`, [
          enabled ? 1 : 0,
          tournamentId,
        ]);
      }
      await connection.commit();
      return { tournamentName: tournament.name, changed };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    }
  });

  if (result.changed) {
    if (!enabled) {
      // Le verrou tombe : un tournoi sans phase de lancement part à l'heure.
      await maintainVoiceLaunches(tournamentId).catch((error: unknown) => {
        console.error("[match-voice] entretien des lancements impossible", error);
      });
    }
    publishUpdatedEvent(tournamentId);
    // Création (ou libération) sans attendre le prochain passage du trafic.
    sweep.lastAt = 0;
    void dispatchMatchVoiceChannels();
  }
  return { tournamentId, enabled, ...result };
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
  published: number | null;
};

/**
 * État des salons d'un match pour la page du match, qui le relit tant que le
 * verrou tient (`GET /api/matches/[matchId]/voice`) : la lecture REST de
 * secours de `TournamentMatch.voice`. Lit la base seulement — le comptage
 * auprès du bot reste au balayage, qu'elle relance sans l'attendre : autant
 * de lecteurs qu'on voudra, jamais plus d'un appel au bot par salon et par
 * passe. `undefined` : match introuvable, ou tournoi pas encore publié pour
 * un lecteur sans la permission `tournaments`.
 */
export async function readMatchVoice(matchId: number, staff: boolean): Promise<MatchVoiceInfo | null | undefined> {
  void dispatchMatchVoiceChannels();
  return withConnection(async (connection) => {
    const [rows] = await connection.execute<SingleMatchRow[]>(
      `SELECT m.id, m.tournament_id, m.status, m.team1_id, m.team2_id, m.start_at, m.launched_at,
              m.launch_pairing, t.team_voice_channels,
              (t.start_visibility_at IS NULL OR t.start_visibility_at <= NOW()) AS published
       FROM bg_matches m JOIN bg_tournaments t ON t.id = m.tournament_id
       WHERE m.id = ? LIMIT 1`,
      [matchId],
    );
    const match = rows[0];
    if (!match || (!staff && Number(match.published ?? 0) !== 1)) return undefined;
    const team1Id = match.team1_id === null ? null : Number(match.team1_id);
    const team2Id = match.team2_id === null ? null : Number(match.team2_id);
    const currentPairing = team1Id !== null && team2Id !== null && match.launch_pairing === `${team1Id}:${team2Id}`;
    const infos = await loadMatchVoiceInfos(connection, Number(match.tournament_id), Number(match.team_voice_channels ?? 0) === 1, [
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
