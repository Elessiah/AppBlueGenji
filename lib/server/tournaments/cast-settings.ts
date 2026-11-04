/**
 * Réglages du cast par son caster (`docs/features/CAST_SETTINGS.md`) : le mode
 * de passage à l'antenne du match, le lien de **son** stream, et le BattleTag
 * qu'il donne pour ce cast.
 *
 * Les mêmes écritures servent deux chemins — l'inscription (`claimMatchCast`,
 * qui les applique dans sa transaction, sous le verrou qu'elle tient déjà) et
 * la fenêtre « Configurer ma diffusion » (`setCastSettings`) : une seule
 * définition, pour qu'un réglage posé à l'inscription et le même réglage posé
 * ensuite ne puissent pas diverger.
 *
 * Toute la règle de refus vit dans les modules purs (`lib/shared/live-streams.ts`,
 * `lib/shared/cast-settings.ts`) : ce fichier ne fait que l'appliquer à la base.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { casterStreamEditable, parseCastBattletagInput } from "@/lib/shared/cast-settings";
import {
  isMatchCastable,
  isMatchLiveTrigger,
  parseStreamUrlInput,
  requiresMatchStartAt,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import { lockMatchStreams, pruneMatchStreams, type MatchStreamRow } from "./match-casters";
// Type seul : aucune dépendance d'exécution vers le lancement, qui importe ce
// module (le verrou de la ligne du match et la transaction y vivent).
import type { LaunchMatchRow } from "./match-launch";

/**
 * Ce qu'un caster règle pour son cast. Chaque champ est **facultatif** :
 * absent, il n'est pas touché — la fenêtre n'envoie que ce qu'elle montre, et
 * l'inscription n'envoie que ce que son choix offrait.
 */
export type CastSettings = {
  /** Mode d'antenne du match (`null` : le match n'est plus casté). */
  trigger?: MatchLiveTrigger | null;
  /** Lien de **son** stream (`null` : aucun lien public). */
  liveUrl?: string | null;
  /** BattleTag donné pour ce cast (`null` : celui de son compte). */
  battletag?: string | null;
  /**
   * Le lien posé est celui de l'organisation — dit par un porteur de
   * `tournaments` seulement, la route refusant `true` aux autres
   * (`MatchLiveSetter.asOrganisation`).
   */
  asOrganisation?: boolean;
};

/**
 * Le match accepte-t-il encore ce mode d'antenne ? Même verdict que la
 * configuration du staff (`assertConfigurable`) : un match dont le score est
 * saisi ne se démarque que, et un mode posé sur lui remplacerait le lien d'un
 * match joué.
 *
 * @throws `MATCH_NOT_CASTABLE` | `MATCH_START_AT_REQUIRED`
 */
export function assertCastTriggerWritable(row: LaunchMatchRow, trigger: MatchLiveTrigger | null): void {
  const match = {
    status: row.status,
    liveTrigger: row.live_trigger ?? null,
    liveStartedAt: row.live_started_at ?? null,
    launchedAt: null,
  };
  const configurable = trigger === null ? isMatchCastable(match) || match.liveTrigger !== null : isMatchCastable(match);
  if (!configurable) throw new Error("MATCH_NOT_CASTABLE");
  if (requiresMatchStartAt(trigger) && (row.start_at ?? null) === null) {
    throw new Error("MATCH_START_AT_REQUIRED");
  }
}

/**
 * Pose le mode d'antenne du match, sous le verrou de sa ligne que l'appelant
 * tient déjà.
 *
 * Les deux effacements de la configuration du staff (`setMatchLiveConfig`) sont
 * repris mot pour mot : démarquer le match referme son antenne, et un mode qui
 * n'est plus manuel la referme aussi — sans quoi un match passé en automatique
 * garderait une ouverture d'antenne qui reprendrait effet à la moindre remise
 * en manuel. Le lien du staff, lui, n'est **pas** touché : un caster ne retire
 * pas la chaîne de l'organisation (seule sa fenêtre à elle le fait).
 *
 * @throws `INVALID_LIVE_TRIGGER` | `MATCH_NOT_CASTABLE` | `MATCH_START_AT_REQUIRED`
 */
export async function applyCastTrigger(
  connection: PoolConnection,
  row: LaunchMatchRow,
  trigger: MatchLiveTrigger | null,
): Promise<void> {
  if (trigger !== null && !isMatchLiveTrigger(trigger)) throw new Error("INVALID_LIVE_TRIGGER");
  assertCastTriggerWritable(row, trigger);
  const matchId = Number(row.id);
  if (trigger === null) {
    await connection.execute(
      `UPDATE bg_matches SET live_trigger = NULL, live_started_at = NULL WHERE id = ?`,
      [matchId],
    );
  } else {
    await connection.execute(
      trigger === "MANUAL"
        ? `UPDATE bg_matches SET live_trigger = ? WHERE id = ?`
        : `UPDATE bg_matches SET live_trigger = ?, live_started_at = NULL WHERE id = ?`,
      [trigger, matchId],
    );
  }
  row.live_trigger = trigger;
  if (trigger !== "MANUAL") row.live_started_at = null;
}

/**
 * Pose (ou efface) le lien du stream que **tient** ce caster.
 *
 * Jamais celui du staff (`casterStreamEditable`) : un caster qui a rejoint « le
 * stream du match » lit la chaîne de l'organisation, il ne la réécrit pas
 * (`CAST_STREAM_NOT_OWNED`). Le lien posé lui est rattaché (`link_user_id`) et
 * part avec son compte (`withdrawUserCasts`), sauf s'il le dit de
 * l'organisation — ce que seule la permission `tournaments` peut dire.
 *
 * Rend les streams du match **tels qu'ils sont après l'écriture**, pour le
 * ménage de l'appelant.
 *
 * Un lien ne s'efface pas : le stream d'un caster sans lien n'apparaîtrait
 * sur aucune vue, et le staff le prendrait pour le sien (`staffStream`, le
 * premier stream sans lien) — exigé ici comme à l'inscription.
 *
 * @throws `STREAM_NOT_FOUND` | `CAST_STREAM_NOT_OWNED` | `INVALID_STREAM_URL`
 *   | `STREAM_URL_REQUIRED`
 */
export async function setCasterStreamUrl(
  connection: PoolConnection,
  matchId: number,
  streamId: number,
  url: string | null,
  linkUserId: number | null,
): Promise<MatchStreamRow[]> {
  const streams = await lockMatchStreams(connection, matchId, true);
  const target = streams.find((stream) => stream.id === streamId);
  if (!target) throw new Error("STREAM_NOT_FOUND");
  if (!casterStreamEditable(target)) throw new Error("CAST_STREAM_NOT_OWNED");
  if (url === null) throw new Error("STREAM_URL_REQUIRED");
  // Un lien inchangé n'est pas réécrit : il reste à qui l'a fourni, comme dans
  // la configuration du staff (`setStaffStreamUrl`).
  if (target.liveUrl === url) return streams;
  await connection.execute(
    `UPDATE bg_match_streams SET live_url = ?, link_user_id = ? WHERE id = ? AND staff_owned = 0`,
    [url, url === null ? null : linkUserId, streamId],
  );
  return streams.map((stream) => (stream.id === streamId ? { ...stream, liveUrl: url } : stream));
}

/**
 * Écrit le BattleTag de cast d'un caster (`bg_match_casters.cast_battletag`).
 * `null` l'efface : le BattleTag de son compte reprend sa place.
 */
export async function writeCastBattletag(
  connection: PoolConnection,
  matchId: number,
  userId: number,
  battletag: string | null,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_match_casters SET cast_battletag = ? WHERE match_id = ? AND user_id = ?`,
    [battletag, matchId, userId],
  );
}

/**
 * Applique les réglages d'un caster **dans la transaction de l'appelant**, sous
 * le verrou de la ligne du match qu'il tient déjà. `streamId` est le stream
 * que ce caster tient.
 *
 * L'ordre est celui de la configuration du staff : le match d'abord (mode
 * d'antenne), puis les streams, puis le ménage.
 */
export async function applyCastSettings(
  connection: PoolConnection,
  row: LaunchMatchRow,
  userId: number,
  streamId: number,
  settings: CastSettings,
): Promise<void> {
  const matchId = Number(row.id);
  if (settings.trigger !== undefined) await applyCastTrigger(connection, row, settings.trigger);
  let streams: MatchStreamRow[] | undefined;
  if (settings.liveUrl !== undefined) {
    const url = parseStreamUrlInput(settings.liveUrl);
    streams = await setCasterStreamUrl(
      connection,
      matchId,
      streamId,
      url,
      settings.asOrganisation === true ? null : userId,
    );
  }
  if (settings.battletag !== undefined) {
    await writeCastBattletag(connection, matchId, userId, parseCastBattletagInput(settings.battletag));
  }
  // Un lien retiré peut laisser un stream que plus personne ne tient : le même
  // ménage que la configuration du staff et que le retrait d'un caster.
  if (streams !== undefined) await pruneMatchStreams(connection, matchId, { streams });
}

/** Ce qu'un caster lit de **son** cast pour le régler (`CastSettingsDialog`). */
export type OwnCastSettings = {
  streamId: number;
  /** Lien de son stream, `null` sans lien. */
  liveUrl: string | null;
  /** Son stream est celui du staff : il en lit le lien, il ne l'écrit pas. */
  staffStream: boolean;
  /** BattleTag donné pour ce cast, `null` = celui de son compte. */
  battletag: string | null;
};

type OwnCastRow = RowDataPacket & {
  stream_id: number;
  cast_battletag: string | null;
  live_url: string | null;
  staff_owned: number;
};

/**
 * Les réglages de **son** cast, pour le caster lui-même : le seul endroit où le
 * BattleTag d'un cast se relit — il ne voyage pas dans l'instantané du plateau,
 * qui est commun à tous les lecteurs (`docs/features/CAST_SETTINGS.md`).
 *
 * Lecture ordinaire : rien n'est écrit, et un réglage posé entre-temps n'a pas
 * à être vu — la fenêtre s'ouvre sur ce qui est enregistré.
 *
 * @throws `NOT_MATCH_CASTER` — le lecteur ne caste pas ce match.
 */
export async function loadOwnCastSettings(matchId: number, userId: number): Promise<OwnCastSettings> {
  const db = await getDatabase();
  const [rows] = await db.execute<OwnCastRow[]>(
    `SELECT c.stream_id, c.cast_battletag, s.live_url, s.staff_owned
     FROM bg_match_casters c
     JOIN bg_match_streams s ON s.match_id = c.match_id AND s.id = c.stream_id
     WHERE c.match_id = ? AND c.user_id = ? LIMIT 1`,
    [matchId, userId],
  );
  const row = rows[0];
  if (!row) throw new Error("NOT_MATCH_CASTER");
  return {
    streamId: Number(row.stream_id),
    liveUrl: row.live_url ?? null,
    staffStream: Number(row.staff_owned) === 1,
    battletag: row.cast_battletag ?? null,
  };
}
