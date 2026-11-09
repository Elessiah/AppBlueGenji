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
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import {
  ensureVoiceChannel,
  releaseVoiceChannel,
  releaseVoiceChannelByKey,
  type VoiceCallOutcome,
} from "@/lib/server/bot-integration";
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
  VOICE_BOT_UNRELEASED_MAX_HOURS,
  VOICE_BOT_ABANDONED_MAX_HOURS,
  matchVoiceInfo,
  voiceChannelKey,
  voiceChannelsDue,
  voiceOptionLive,
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
  // Un rendu refusé note `failed_at` sur un salon encore ouvert : il reste « ouvert ».
  const channelId = row.channel_id ?? null;
  return { channelId, failed: channelId === null && row.failed_at !== null };
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
};

type VoiceTeamRow = RowDataPacket & { id: number; solo: number | null; ghost: number | null };

/**
 * Salons des matchs d'un instantané, deux lectures pour les seuls matchs
 * concernés — et aucune quand l'option est éteinte, le tournoi pas en cours ou
 * pas encore publié (`enabled`, `voiceOptionLive`). Seul un match jouable (prêt ou score en attente de
 * confirmation), programmé, et dont les salons sont dus, en montre — lancé ou
 * non : le lancement n'en dépend pas, et les salons restent jusqu'au score.
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
      (match.status === "READY" || match.status === "AWAITING_CONFIRMATION") &&
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
    // Équipe absente de `bg_teams` : `DUE_CHANNELS_SQL` (jointure interne) ne lui
    // ouvrira jamais de salon — aucun « en attente » sans fin, comme une fantôme.
    if (!row) return { isSolo: false, isGhost: true };
    return { isSolo: Number(row.solo ?? 0) === 1, isGhost: Number(row.ghost ?? 0) === 1 };
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
/**
 * Budget d'une passe pour la création et la revérification : contre un bot lent (mais
 * sous son délai), la passe s'arrête là et le rendu n'attend pas ; la suivante reprend.
 */
const VOICE_PASS_BUDGET_MS = 20_000;
/** Bot indisponible pour tous les salons : aucune passe ne le rappelle avant ce délai. */
const VOICE_BOT_BACKOFF_MS = VOICE_RETRY_SECONDS * 1000;
/** Purge des lignes rendues : au plus une fois par heure, pas à chaque passe. */
const VOICE_PURGE_INTERVAL_MS = 3_600_000;
/** Lignes effacées par requête, et nombre de requêtes au plus par purge. */
const VOICE_PURGE_BATCH = VOICE_SWEEP_BATCH * 5;
const VOICE_PURGE_MAX_BATCHES = 10;
/** Pause avant de reprendre un arriéré de purge plus long qu'une passe. */
const VOICE_PURGE_BACKLOG_PAUSE_MS = 60_000;
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
  /** Salon de l'équipe à demander au bot (`needsChannel`, calculé par la base). */
  team1_ask: number | null;
  team2_ask: number | null;
  /** La page montre déjà la panne de ce salon (`shownFailed`) : pas de seconde ligne pm2. */
  team1_failed: number | null;
  team2_failed: number | null;
};

type ReleaseRow = RowDataPacket & {
  match_id: number;
  team_id: number;
  channel_id: string | null;
  tournament_id: number | null;
  /** Ligne créée il y a plus de `VOICE_BOT_UNRELEASED_MAX_HOURS` : le filet du bot a passé. */
  bot_expired?: number | null;
  /** Ligne créée il y a plus de `VOICE_BOT_ABANDONED_MAX_HOURS` : le bot a oublié le salon. */
  bot_abandoned?: number | null;
};

/**
 * Une équipe de ce match a-t-elle encore un salon à demander ? Non si son
 * salon est ouvert, ou si le bot vient d'échouer (redemandé après
 * `VOICE_RETRY_SECONDS`, même quand l'autre équipe ramène le match). Seule
 * forme de la règle : la sélection des matchs et le choix des équipes la lisent.
 */
function needsChannel(teamColumn: "team1_id" | "team2_id"): string {
  return `NOT EXISTS (SELECT 1 FROM bg_match_voice_channels v
                       WHERE v.match_id = m.id AND v.team_id = m.${teamColumn} AND v.released_at IS NULL
                         AND (v.channel_id IS NOT NULL OR v.failed_at > NOW() - INTERVAL ${VOICE_RETRY_SECONDS} SECOND))`;
}

/** La page montre-t-elle déjà ce salon « indisponible » (ligne ouverte en échec) ? */
function shownFailed(teamColumn: "team1_id" | "team2_id"): string {
  return `EXISTS (SELECT 1 FROM bg_match_voice_channels s
                   WHERE s.match_id = m.id AND s.team_id = m.${teamColumn} AND s.released_at IS NULL
                     AND s.failed_at IS NOT NULL)`;
}

/**
 * Matchs dont un salon reste à créer : tournoi en cours à l'option allumée,
 * match jouable programmé dans le quart d'heure (ou passé l'heure de moins de
 * `VOICE_CHANNEL_LATE_HOURS`), lancé ou non (le lancement n'en dépend pas), deux
 * équipes réelles — **jamais** une entrée solo (le nom du salon serait un
 * pseudo) ni une fantôme. Un match dont les deux salons sont ouverts n'est
 * plus relu.
 */
export const DUE_CHANNELS_SQL = `SELECT m.id, m.tournament_id, m.team1_id, m.team2_id,
       t1.name AS team1_name, t2.name AS team2_name,
       ${needsChannel("team1_id")} AS team1_ask, ${needsChannel("team2_id")} AS team2_ask,
       ${shownFailed("team1_id")} AS team1_failed, ${shownFailed("team2_id")} AS team2_failed
  FROM bg_matches m
  JOIN bg_tournaments t ON t.id = m.tournament_id
  JOIN bg_teams t1 ON t1.id = m.team1_id
  JOIN bg_teams t2 ON t2.id = m.team2_id
 WHERE t.state = 'RUNNING' AND t.team_voice_channels = 1
   AND t.start_visibility_at <= NOW()
   AND m.status IN ('READY', 'AWAITING_CONFIRMATION') AND m.start_at IS NOT NULL
   AND m.start_at <= NOW() + INTERVAL ${VOICE_CHANNEL_LEAD_MINUTES} MINUTE
   AND m.start_at >= NOW() - INTERVAL ${VOICE_CHANNEL_LATE_HOURS} HOUR
   AND t1.solo_user_id IS NULL AND t2.solo_user_id IS NULL
   AND COALESCE(t1.is_ghost, 0) = 0 AND COALESCE(t2.is_ghost, 0) = 0
   AND (${needsChannel("team1_id")} OR ${needsChannel("team2_id")})
 ORDER BY EXISTS (SELECT 1 FROM bg_match_voice_channels f
                  WHERE f.match_id = m.id AND f.released_at IS NULL AND f.channel_id IS NULL
                    AND f.failed_at IS NOT NULL), m.start_at, m.id
 LIMIT ${VOICE_SWEEP_BATCH}`;

/**
 * Salons à rendre au bot : match joué (score confirmé) ou disparu, match
 * retombé en attente ou sorti du programme (heure retirée), équipe sortie de
 * l'appariement, entrée solo ou fantôme dans le match, tournoi qui n'est plus en
 * cours (terminé, ou retombé avant son départ : la page ne montre plus ses salons) ou
 * option éteinte, match resté sans score passé `VOICE_CHANNEL_LATE_HOURS` (sans
 * quoi sa ligne resterait ouverte et la passe ne s'arrêterait plus au garde-fou). Un rendu refusé (ou
 * une création échouée) attend `VOICE_RETRY_SECONDS` avant d'être redemandé. Le bot supprime le salon s'il est vide, sinon dès qu'il se vide
 * (et ses balayages font filet).
 */
export const RELEASABLE_SQL = `SELECT v.match_id, v.team_id, v.channel_id, m.tournament_id,
       (v.created_at < NOW() - INTERVAL ${VOICE_BOT_UNRELEASED_MAX_HOURS} HOUR) AS bot_expired,
       (v.created_at < NOW() - INTERVAL ${VOICE_BOT_ABANDONED_MAX_HOURS} HOUR) AS bot_abandoned
  FROM bg_match_voice_channels v
  LEFT JOIN bg_matches m ON m.id = v.match_id
  LEFT JOIN bg_tournaments t ON t.id = m.tournament_id
 WHERE v.released_at IS NULL
   AND (v.failed_at IS NULL OR v.failed_at <= NOW() - INTERVAL ${VOICE_RETRY_SECONDS} SECOND)
   AND (m.id IS NULL OR t.id IS NULL
        OR m.status IN ('COMPLETED', 'PENDING') OR m.start_at IS NULL
        OR m.start_at < NOW() - INTERVAL ${VOICE_CHANNEL_LATE_HOURS} HOUR
        OR t.state <> 'RUNNING' OR t.team_voice_channels = 0
        OR t.start_visibility_at > NOW()
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

type SweepState = {
  pending: Promise<void> | null;
  lastAt: number;
  again: boolean;
  purgedAt: number;
  /** Dernière vérification de chaque salon ouvert (clé du salon → ms). */
  checkedAt: Map<string, number>;
  /** Dernier salon (match, équipe) de la fenêtre lue : la suivante commence après lui. */
  recheckFrom: [number, number];
  /** Dernier refus journalisé (`release:` / `recheck:` + clé du salon, ou `release:bot` → code) : une ligne pm2 par code. */
  refusalLogged: Map<string, string>;
  /** Bot indisponible pour tous les salons : pas d'appel avant cet instant (ms). */
  botDownUntil: number;
  /** Revérification : pas de lecture des salons ouverts avant cet instant (ms), aucun n'est dû. */
  nextRecheckAt: number;
};
const sweepState = globalThis as typeof globalThis & { __bgVoiceSweep?: Partial<SweepState> };
const sweep = Object.assign(
  {
    pending: null,
    lastAt: 0,
    again: false,
    purgedAt: 0,
    checkedAt: new Map<string, number>(),
    recheckFrom: [0, 0],
    refusalLogged: new Map<string, string>(),
    botDownUntil: 0,
    nextRecheckAt: 0,
  },
  sweepState.__bgVoiceSweep,
) as SweepState;
sweepState.__bgVoiceSweep = sweep;

/** Ligne de pm2 : un identifiant de match et un code, jamais un nom ni un compte. */
function logFailure(matchId: number, code: string): void {
  console.warn(`[match-voice] match ${matchId} : salon vocal indisponible (${code})`);
}

/** Ligne de pm2 d'un rendu refusé par le bot : même forme, une par salon et par code. */
function logReleaseFailure(matchId: number, code: string): void {
  console.warn(`[match-voice] match ${matchId} : rendu du salon vocal refusé (${code})`);
}

/** Ligne de pm2 d'une revérification refusée par le bot pour ce salon : une par salon et par code. */
function logRecheckFailure(matchId: number, code: string): void {
  console.warn(`[match-voice] match ${matchId} : revérification du salon vocal refusée (${code})`);
}

/** Refus retenus pour la journalisation : au-delà, la mémoire repart à vide. */
const VOICE_REFUSAL_LOG_MEMORY = 1000;

/** Journalise un refus une fois par sujet et par code (`refusalLogged`). */
function logRefusalOnce(subject: string, code: string, log: () => void): void {
  if (sweep.refusalLogged.get(subject) === code) return;
  if (sweep.refusalLogged.size >= VOICE_REFUSAL_LOG_MEMORY) sweep.refusalLogged.clear();
  sweep.refusalLogged.set(subject, code);
  log();
}

/** Salon clos ou de nouveau joignable : ses refus pourront être rejournalisés. */
function forgetRefusals(key: string): void {
  sweep.refusalLogged.delete(`release:${key}`);
  sweep.refusalLogged.delete(`recheck:${key}`);
}

/** Exécution sur le pool : la connexion est rendue aussitôt, jamais tenue pendant un appel au bot. */
async function run<T extends RowDataPacket[]>(sql: string, params: (string | number)[] = []): Promise<T> {
  const db = await getDatabase();
  const [rows] = await db.execute<T>(sql, params);
  return rows;
}

// Ligne rouverte ou salon remplacé : `created_at` repart (âge du salon courant, lu par
// `bot_expired` et dit « heure de création » par T18) ; lu avant les autres affectations.
async function writeChannel(matchId: number, teamId: number, channelId: string): Promise<void> {
  await run(
    `INSERT INTO bg_match_voice_channels (match_id, team_id, channel_id, failed_at, released_at)
     VALUES (?, ?, ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       created_at = IF(released_at IS NOT NULL OR NOT (channel_id <=> VALUES(channel_id)), NOW(), created_at),
       channel_id = VALUES(channel_id), failed_at = NULL, released_at = NULL`,
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
       created_at = IF(released_at IS NULL, created_at, NOW()),
       channel_id = IF(released_at IS NULL, channel_id, NULL),
       failed_at = NOW(), released_at = NULL`,
    [matchId, teamId],
  );
}

/**
 * Demande au bot le salon d'une clé (il rend le même pour la même clé, ou un neuf
 * s'il a disparu). Un nom que le bot refuse est remplacé par
 * `VOICE_FALLBACK_CHANNEL_NAME`, une fois — création et revérification.
 */
async function ensureTeamChannel(key: string, name: string): Promise<VoiceCallOutcome<string>> {
  const first = await ensureVoiceChannel(key, name);
  if (first.kind === "ok" || first.code !== "INVALID_VOICE_CHANNEL_NAME") return first;
  return ensureVoiceChannel(key, VOICE_FALLBACK_CHANNEL_NAME);
}

/**
 * Crée le salon d'une équipe. Rend si ce que la page montre a changé (`changed`)
 * et si le bot est indisponible (`down` : le reste de la passe s'arrête, la
 * suivante reprend). `failedShown` : la page montre déjà la panne de ce salon.
 */
async function createTeamChannel(
  matchId: number,
  teamId: number,
  teamName: string,
  failedShown: boolean,
): Promise<{ changed: boolean; down: boolean }> {
  const key = voiceChannelKey(matchId, teamId);
  const created = await ensureTeamChannel(key, teamName);
  if (created.kind === "ok") {
    await writeChannel(matchId, teamId, created.value);
    // Le bot vient de répondre : pas de seconde demande identique dans la même passe.
    sweep.checkedAt.set(key, Date.now());
    return { changed: true, down: false };
  }
  // Une seule ligne pm2 par panne : pas de répétition à chaque nouvel essai.
  if (!failedShown) logFailure(matchId, created.code);
  await writeFailure(matchId, teamId);
  return { changed: !failedShown, down: created.kind === "unavailable" };
}

/** Issue du rendu d'une ligne : la clore, et arrêter le rendu (bot indisponible). */
type ReleaseVerdict = { close: boolean; stop: boolean };

/**
 * Rend le salon d'une ligne au bot. Une ligne sans identifiant (création expirée ou
 * illisible, alors que le bot a pu créer le salon) est rendue par sa clé. Ligne close :
 * rendu fait, salon déjà supprimé, identifiant jamais suivi, filet du bot passé sur un
 * refus. Bot indisponible : le rendu s'arrête, la ligne reste — sauf passé l'oubli du
 * bot (`bot_abandoned`), où elle se clôt sans rien attendre de plus.
 */
async function releaseOne(row: ReleaseRow): Promise<ReleaseVerdict> {
  const matchId = Number(row.match_id);
  const key = voiceChannelKey(matchId, Number(row.team_id));
  const released =
    row.channel_id === null ? await releaseVoiceChannelByKey(key) : await releaseVoiceChannel(String(row.channel_id));
  // `gone` (`VOICE_CHANNEL_NOT_TRACKED`) : déjà supprimé, rien de plus à faire ; un
  // identifiant que le bot refuse (`INVALID_CHANNEL_ID`) ne sera jamais suivi : la
  // ligne se clôt aussi, au lieu d'être redemandée sans fin et jamais purgée.
  if (released.kind === "ok" || released.kind === "gone" || released.code === "INVALID_CHANNEL_ID") {
    forgetRefusals(key);
    return { close: true, stop: false };
  }
  const down = released.kind === "unavailable";
  if (down) {
    // Refus du bot entier (permission, catégorie, stockage) : une ligne pm2 par code, même
    // s'il arrête la passe ; une panne du canal (transport) n'en donne pas.
    if (released.code.startsWith("VOICE_")) {
      logRefusalOnce("release:bot", released.code, () => logReleaseFailure(matchId, released.code));
    }
    // Une panne passagère n'est pas un refus de ce salon : la ligne n'est close que passé
    // l'oubli du bot (`VOICE_BOT_ABANDONED_MAX_HOURS`), et le rendu s'arrête quand même.
    if (Number(row.bot_abandoned ?? 0) === 1) {
      forgetRefusals(key);
      return { close: true, stop: true };
    }
  } else {
    // Rendu refusé passé le filet du bot (salon non rendu supprimé de son côté) : la ligne
    // se clôt au lieu d'être redemandée et gardée pour toujours.
    if (Number(row.bot_expired ?? 0) === 1) {
      forgetRefusals(key);
      return { close: true, stop: false };
    }
    // Refus du bot pour ce salon : une ligne pm2 par salon et par code (le staff voit un
    // salon qui reste sur Discord, et pourquoi).
    logRefusalOnce(`release:${key}`, released.code, () => logReleaseFailure(matchId, released.code));
  }
  // Redemandé après `VOICE_RETRY_SECONDS`, en fin de file : un rendu qui échoue n'affame pas
  // les autres. Seulement si la ligne porte encore ce salon (autre processus).
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_match_voice_channels SET failed_at = NOW()
     WHERE match_id = ? AND team_id = ? AND released_at IS NULL AND channel_id <=> ?`,
    [matchId, Number(row.team_id), row.channel_id === null ? null : String(row.channel_id)],
  );
  return { close: false, stop: down };
}

/**
 * Rend les salons à rendre ; `true` si le bot est indisponible (le rendu s'est arrêté).
 * Une ligne n'est close que si elle porte encore le salon rendu : un salon neuf écrit
 * entre-temps par la revérification d'un autre processus reste ouvert, rendu plus tard.
 */
async function releaseChannels(touched: Set<number>): Promise<boolean> {
  const rows = await run<ReleaseRow[]>(RELEASABLE_SQL);
  for (const row of rows) {
    const verdict = await releaseOne(row);
    if (verdict.close) {
      const db = await getDatabase();
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE bg_match_voice_channels SET released_at = NOW()
         WHERE match_id = ? AND team_id = ? AND released_at IS NULL AND channel_id <=> ?`,
        [Number(row.match_id), Number(row.team_id), row.channel_id === null ? null : String(row.channel_id)],
      );
      if (Number(result.affectedRows) > 0 && row.tournament_id !== null) touched.add(Number(row.tournament_id));
    }
    if (verdict.stop) return true;
  }
  return false;
}

/**
 * Minimisation : une ligne rendue au bot n'a plus d'usage passé une semaine
 * (un match rejoué recrée la sienne par sa clé). Une fois par heure au plus.
 */
async function purgeReleasedRows(): Promise<void> {
  if (Date.now() - sweep.purgedAt < VOICE_PURGE_INTERVAL_MS) return;
  // Arriéré restant ou purge en échec (verrou, interblocage) : reprise dans la minute, pas
  // à chaque passe de dix secondes (ni une pile journalisée toutes les dix secondes).
  const retrySoon = () => Date.now() - VOICE_PURGE_INTERVAL_MS + VOICE_PURGE_BACKLOG_PAUSE_MS;
  try {
    const db = await getDatabase();
    // Un arriéré (plus de lignes échues que d'un lot) se résorbe dans la passe : la durée de garde annoncée tient.
    let caughtUp = false;
    for (let batch = 0; batch < VOICE_PURGE_MAX_BATCHES; batch++) {
      const [result] = await db.execute<ResultSetHeader>(
        `DELETE FROM bg_match_voice_channels
         WHERE released_at IS NOT NULL AND released_at < NOW() - INTERVAL ${VOICE_ROW_RETENTION_DAYS} DAY
         LIMIT ${VOICE_PURGE_BATCH}`,
      );
      if (Number(result.affectedRows) < VOICE_PURGE_BATCH) {
        caughtUp = true;
        break;
      }
    }
    sweep.purgedAt = caughtUp ? Date.now() : retrySoon();
  } catch (error) {
    sweep.purgedAt = retrySoon();
    throw error;
  }
}

/**
 * Salons ouverts lus par passe : plus large que le lot revérifié. Au-delà, la fenêtre
 * tourne (elle commence après le dernier salon de la précédente) : tous sont atteints.
 */
const VOICE_RECHECK_WINDOW = 400;
/** Fenêtre pleine : un horodatage n'est oublié qu'au-delà de cet âge (le salon est alors dû de toute façon). */
const VOICE_RECHECK_FORGET_MS = 10 * 60_000;

/**
 * Salons ouverts des matchs dus : redemandés au bot par leur clé au plus une
 * fois par `VOICE_RECHECK_MS` et par salon. Le bot rend le même salon, ou un
 * neuf s'il a été supprimé à la main — seul moyen pour le site de le savoir,
 * sans jamais demander qui s'y trouve.
 */
export const OPEN_DUE_CHANNELS_SQL = `SELECT v.match_id, v.team_id, v.channel_id, m.tournament_id,
       IF(v.team_id <=> m.team1_id, t1.name, t2.name) AS team_name
  FROM bg_match_voice_channels v
  JOIN bg_matches m ON m.id = v.match_id
  JOIN bg_tournaments t ON t.id = m.tournament_id
  JOIN bg_teams t1 ON t1.id = m.team1_id
  JOIN bg_teams t2 ON t2.id = m.team2_id
 WHERE v.released_at IS NULL AND v.channel_id IS NOT NULL
   AND t.state = 'RUNNING' AND t.team_voice_channels = 1
   AND t.start_visibility_at <= NOW()
   AND m.status IN ('READY', 'AWAITING_CONFIRMATION') AND m.start_at IS NOT NULL
   AND m.start_at <= NOW() + INTERVAL ${VOICE_CHANNEL_LEAD_MINUTES} MINUTE
   AND m.start_at >= NOW() - INTERVAL ${VOICE_CHANNEL_LATE_HOURS} HOUR
   AND (v.team_id <=> m.team1_id OR v.team_id <=> m.team2_id)
   AND t1.solo_user_id IS NULL AND t2.solo_user_id IS NULL
   AND COALESCE(t1.is_ghost, 0) = 0 AND COALESCE(t2.is_ghost, 0) = 0
 ORDER BY (v.match_id > ? OR (v.match_id = ? AND v.team_id > ?)) DESC, v.match_id, v.team_id
 LIMIT ${VOICE_RECHECK_WINDOW}`;

/** Un salon ouvert n'est redemandé qu'une fois par minute. */
const VOICE_RECHECK_MS = 60_000;
/**
 * Horodatage donné à un salon dont la vérification a échoué : « vu il y a
 * `VOICE_RECHECK_MS - VOICE_RECHECK_RETRY_MS` », donc dû dans `VOICE_RECHECK_RETRY_MS`
 * et classé derrière les salons vus plus tôt.
 */
const retryStamp = (): number => Date.now() - Math.max(VOICE_RECHECK_MS - VOICE_RECHECK_RETRY_MS, 0);

/** Délai avant de redemander un salon dont la vérification a échoué sur le canal du bot. */
const VOICE_RECHECK_RETRY_MS = 10_000;
/** Appels au bot en parallèle pendant la revérification : une passe ne s'éternise pas sur un bot lent. */
const VOICE_RECHECK_CONCURRENCY = 5;
/** Au plus tant de salons revérifiés par passe, les plus anciennement vus d'abord. */
const VOICE_RECHECK_BATCH = VOICE_SWEEP_BATCH * 2;

type OpenRow = RowDataPacket & { match_id: number; team_id: number; channel_id: string; tournament_id: number; team_name: string };

/**
 * Même salon rendu par le bot alors que la ligne a été rendue entre-temps (autre
 * processus, rechargement pm2) : le bot l'a repris (rendu annulé), la ligne est
 * rouverte pour que le rendu de la passe le rende de nouveau. `true` si rouverte.
 */
async function reopenReleasedRow(matchId: number, teamId: number, channelId: string): Promise<boolean> {
  const db = await getDatabase();
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bg_match_voice_channels SET created_at = NOW(), failed_at = NULL, released_at = NULL
     WHERE match_id = ? AND team_id = ? AND channel_id = ? AND released_at IS NOT NULL`,
    [matchId, teamId, channelId],
  );
  return Number(result.affectedRows) > 0;
}

/**
 * Revérifie un salon ouvert ; `false` si le bot est indisponible (le reste de la passe
 * s'arrête alors). Un refus propre au salon le laisse tel quel, redemandé après
 * `VOICE_RECHECK_MS`, avec une ligne pm2 par salon et par code.
 */
async function recheckOneChannel(row: OpenRow, touched: Set<number>): Promise<boolean> {
  const matchId = Number(row.match_id);
  const teamId = Number(row.team_id);
  const key = voiceChannelKey(matchId, teamId);
  const ensured = await ensureTeamChannel(key, visibleText(String(row.team_name)));
  // Une panne ici ne dit rien du salon : il reste tel qu'il est, redemandé plus tard.
  if (ensured.kind === "unavailable") return false;
  // Un refus propre au salon non plus : la ligne reste ouverte (le salon suit
  // sur la page), et la revérification suivante redemande (MATCH_VOICE.md).
  if (ensured.kind !== "ok") {
    logRefusalOnce(`recheck:${key}`, ensured.code, () => logRecheckFailure(matchId, ensured.code));
    return true;
  }
  sweep.refusalLogged.delete(`recheck:${key}`);
  if (ensured.value !== String(row.channel_id)) {
    // Upsert qui rouvre, voulu : si la ligne a été rendue entre-temps (autre processus,
    // rechargement pm2), le salon neuf existe déjà sur Discord ; la ligne le suit et le
    // rendu de la même passe (après la revérification) le rend au bot, avec ses reprises.
    await writeChannel(matchId, teamId, ensured.value);
    touched.add(Number(row.tournament_id));
  } else if (await reopenReleasedRow(matchId, teamId, ensured.value)) {
    touched.add(Number(row.tournament_id));
  }
  return true;
}

/**
 * Revérifie les salons ouverts dus ; s'arrête à la première panne du bot ou au budget de
 * la passe (`deadline`). Rend `true` si le bot est indisponible. La lecture des salons
 * ouverts est sautée tant qu'aucun n'est dû (`nextRecheckAt`, une minute au plus : un
 * salon ouvert par un autre processus est atteint dans la minute). Le rendu qui suit
 * n'en dépend pas (il a son propre arrêt sur panne).
 */
async function recheckOpenChannels(touched: Set<number>, deadline: number): Promise<boolean> {
  if (Date.now() < sweep.nextRecheckAt) return false;
  const [fromMatch, fromTeam] = sweep.recheckFrom;
  const rows = await run<OpenRow[]>(OPEN_DUE_CHANNELS_SQL, [fromMatch, fromMatch, fromTeam]);
  const full = rows.length >= VOICE_RECHECK_WINDOW;
  const last = rows.at(-1);
  // Fenêtre pleine : la suivante commence après son dernier salon ; sinon tout a été lu.
  sweep.recheckFrom = full && last ? [Number(last.match_id), Number(last.team_id)] : [0, 0];
  const now = Date.now();
  const seen = new Set<string>();
  const due: { key: string; row: OpenRow }[] = [];
  for (const row of rows) {
    const key = voiceChannelKey(Number(row.match_id), Number(row.team_id));
    seen.add(key);
    if (now - (sweep.checkedAt.get(key) ?? 0) >= VOICE_RECHECK_MS) due.push({ key, row });
  }
  // Les plus anciennement vus d'abord : aucun salon n'est affamé par ceux qui le précèdent.
  due.sort((a, b) => (sweep.checkedAt.get(a.key) ?? 0) - (sweep.checkedAt.get(b.key) ?? 0));
  let botDown = false;
  const queue = due.slice(0, VOICE_RECHECK_BATCH);
  const checkOne = async (next: { key: string; row: OpenRow }): Promise<void> => {
    sweep.checkedAt.set(next.key, Date.now());
    // Bot indisponible ou base en erreur (levée) : les autres ouvriers s'arrêtent, et ce
    // salon n'est pas « vu ».
    let reachable = false;
    try {
      reachable = await recheckOneChannel(next.row, touched);
    } finally {
      if (!reachable) {
        botDown = true;
        // Un salon qui n'a pas pu être vérifié n'est pas « vu » : redemandé dans `VOICE_RECHECK_RETRY_MS`
        // et derrière les salons plus anciennement vus (un salon lent n'ouvre pas chaque passe).
        sweep.checkedAt.set(next.key, retryStamp());
      }
    }
  };
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next && !botDown && Date.now() < deadline; next = queue.shift()) {
      await checkOne(next);
    }
  };
  // Un premier appel seul : une coupure d'une seconde n'en fait échouer qu'un (le
  // coupe-circuit, partagé par le journal et les annonces, ne compte qu'un échec).
  const first = queue.shift();
  if (first && Date.now() < deadline) await checkOne(first);
  if (!botDown) {
    // Tous les ouvriers finissent avant que la passe ne rende la main : aucun n'écrit après
    // la publication de `touched`, ni ne chevauche la passe suivante.
    const settled = await Promise.allSettled(Array.from({ length: VOICE_RECHECK_CONCURRENCY }, worker));
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  forgetRecheckStamps(full, seen);
  sweep.nextRecheckAt = full ? 0 : nextRecheckDue(seen);
  return botDown;
}

/**
 * Mémoire bornée : tout lu, seuls les salons encore dus gardent leur horodatage ;
 * fenêtre pleine, ceux hors fenêtre le gardent (leur tour viendra) jusqu'à vieillir.
 */
function forgetRecheckStamps(full: boolean, seen: ReadonlySet<string>): void {
  const forgetBefore = Date.now() - VOICE_RECHECK_FORGET_MS;
  for (const [key, stamp] of sweep.checkedAt) {
    if (full ? stamp < forgetBefore : !seen.has(key)) sweep.checkedAt.delete(key);
  }
}

/** Prochain salon dû parmi ceux lus (une minute au plus) : avant, la lecture est sautée. */
function nextRecheckDue(seen: ReadonlySet<string>): number {
  let next = Date.now() + VOICE_RECHECK_MS;
  for (const key of seen) next = Math.min(next, (sweep.checkedAt.get(key) ?? 0) + VOICE_RECHECK_MS);
  return next;
}

/**
 * Crée les salons dus : `down` quand le bot est indisponible (le reste de la création
 * s'arrête et la revérification est sautée ; le rendu passe toujours), `budget` quand
 * le budget de la passe est épuisé.
 */
async function createDueChannels(touched: Set<number>, deadline: number): Promise<"done" | "down" | "budget"> {
  const candidates = await run<CandidateRow[]>(DUE_CHANNELS_SQL);
  for (const match of candidates) {
    const matchId = Number(match.id);
    for (const [teamId, teamName, ask, failedShown] of [
      // Nom saisi librement, vers Discord : forme affichable d'abord (`UNTRUSTED_NAMES.md`).
      [Number(match.team1_id), visibleText(String(match.team1_name)), match.team1_ask, match.team1_failed],
      [Number(match.team2_id), visibleText(String(match.team2_name)), match.team2_ask, match.team2_failed],
    ] as const) {
      if (Number(ask ?? 0) !== 1) continue;
      if (Date.now() >= deadline) return "budget";
      const { changed, down } = await createTeamChannel(matchId, teamId, teamName, Number(failedShown ?? 0) === 1);
      if (changed) touched.add(Number(match.tournament_id));
      // Bot injoignable : inutile d'attendre le délai de chaque salon suivant, la prochaine passe reprend.
      if (down) return "down";
    }
  }
  return "done";
}

/** Issue de la création et de la revérification ; l'erreur est rendue, pas levée, pour que le rendu passe. */
type AskOutcome = { down: boolean; failure: { error: unknown } | null };

async function askDueChannels(touched: Set<number>, deadline: number): Promise<AskOutcome> {
  try {
    const created = await createDueChannels(touched, deadline);
    if (created !== "done") return { down: created === "down", failure: null };
    return { down: await recheckOpenChannels(touched, deadline), failure: null };
  } catch (error) {
    return { down: false, failure: { error } };
  }
}

/** Une passe : les tournois dont la page change s'ajoutent à `touched` (publiés par l'appelant, même si la passe échoue). */
async function runSweep(touched: Set<number>): Promise<void> {
  let needed: (RowDataPacket & { due: number | null; open_rows: number | null })[];
  try {
    needed = await run(SWEEP_NEEDED_SQL);
  } catch (error) {
    // Table absente (création avalée au démarrage) : rien à balayer.
    if (isMissingTableError(error)) return;
    throw error;
  }
  const due = Number(needed[0]?.due ?? 0) === 1;
  const open = Number(needed[0]?.open_rows ?? 0) === 1;
  if (!due) {
    // Aucun tournoi dû : les horodatages de revérification n'ont plus d'usage (mémoire bornée).
    sweep.checkedAt.clear();
    sweep.nextRecheckAt = 0;
  }
  try {
    // Bot indisponible à la passe précédente : aucun appel avant `VOICE_BOT_BACKOFF_MS`.
    if (Date.now() < sweep.botDownUntil) return;
    const deadline = Date.now() + VOICE_PASS_BUDGET_MS;
    // Bot en panne : la revérification est sautée (une seule attente de plus), la suivante reprend le reste.
    // Le rendu a son propre arrêt sur panne et ne dépend ni de la création ni de la revérification :
    // même si l'une d'elles échoue, il passe (la rétention n'attend pas), puis l'erreur remonte.
    const ask: AskOutcome = due ? await askDueChannels(touched, deadline) : { down: false, failure: null };
    let releaseDown = false;
    try {
      if (due || open) releaseDown = await releaseChannels(touched);
    } catch (error) {
      // Les deux erreurs atteignent pm2 : celle de la création n'est pas perdue derrière celle du rendu.
      if (ask.failure) console.error("[match-voice] création ou revérification en échec", ask.failure.error);
      throw error;
    }
    if (ask.down || releaseDown) sweep.botDownUntil = Date.now() + VOICE_BOT_BACKOFF_MS;
    if (ask.failure) throw ask.failure.error;
  } finally {
    // La minimisation ne dépend ni du bot ni d'une étape en échec ; après la publication, qu'elle ne retarde pas.
    for (const tournamentId of touched) publishMatchUpdatedEvent(tournamentId);
    touched.clear();
    await purgeReleasedRows().catch((error: unknown) => console.error("[match-voice] purge en échec", error));
  }
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
        await runSweep(new Set<number>());
      } while (sweep.again);
      sweep.again = false;
    } catch (error) {
      console.error("[match-voice] balayage en échec", error);
    } finally {
      sweep.lastAt = Date.now();
      sweep.pending = null;
    }
    // Une bascule pendant une passe en échec garde sa passe de plus (une seule).
    if (sweep.again) {
      sweep.again = false;
      await dispatchMatchVoiceChannels(true);
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
  sweep.checkedAt.clear();
  sweep.recheckFrom = [0, 0];
  sweep.refusalLogged.clear();
  sweep.botDownUntil = 0;
  sweep.nextRecheckAt = 0;
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
 *   leurs salons à T−15 ; ceux déjà dans le quart d'heure ou commencés (sans
 *   score validé, depuis moins de `VOICE_CHANNEL_LATE_HOURS`), lancés ou non,
 *   les reçoivent aussitôt (balayage lancé ici).
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
  return withConnection(async (connection) => {
    const [rows] = await connection.execute<SingleMatchRow[]>(
      `SELECT m.id, m.tournament_id, m.status, m.team1_id, m.team2_id, m.start_at,
              t.team_voice_channels, t.state AS tournament_state, t.start_visibility_at
       FROM bg_matches m JOIN bg_tournaments t ON t.id = m.tournament_id
       WHERE m.id = ? LIMIT 1`,
      [matchId],
    );
    const match = rows[0];
    if (!match || !canViewTournament({ startVisibilityAt: match.start_visibility_at }, { canManage: staff })) {
      return undefined;
    }
    // Après le contrôle d'accès : un lecteur qui ne voit pas le match ne lance aucune passe.
    void dispatchMatchVoiceChannels();
    const team1Id = match.team1_id === null ? null : Number(match.team1_id);
    const team2Id = match.team2_id === null ? null : Number(match.team2_id);
    const enabled = voiceOptionLive(
      {
        teamVoiceChannels: Number(match.team_voice_channels ?? 0) === 1,
        state: match.tournament_state,
        startVisibilityAt: toIso(match.start_visibility_at),
      },
      Date.now(),
    );
    const infos = await loadMatchVoiceInfos(connection, enabled, [
      {
        id: Number(match.id),
        status: match.status,
        team1Id,
        team2Id,
        startAt: toIso(match.start_at),
      },
    ]);
    return infos.get(Number(match.id)) ?? null;
  });
}
