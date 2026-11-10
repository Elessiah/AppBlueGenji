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
import { liveTriggerOwnerAfter, mayChangeLiveTrigger, mayUnmarkLiveTrigger } from "@/lib/shared/live-trigger-owner";
import { castBeforeLaunch } from "@/lib/shared/match-launch";
import type { TournamentGame } from "@/lib/shared/types";
import { nullableId } from "@/lib/shared/nullable-id";
import { loadShownCasterIds } from "./cast-eligibility";
import { hasStaffLink, lockMatchStreams, pruneMatchStreams, streamLinkHolder, type MatchStreamRow } from "./match-casters";
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
  /** Lien de **son** stream (`null` est refusé : `STREAM_URL_REQUIRED`). */
  liveUrl?: string | null;
  /** BattleTag donné pour ce cast (`null` : celui de son compte). */
  battletag?: string | null;
  /**
   * Inscription : un mode d'antenne qu'un autre a posé **entre-temps** (la
   * fenêtre le croyait libre) est laissé tel quel, sans refuser l'inscription
   * (`CastSettingsOutcome.triggerSkipped`) — l'inscription est le geste, le
   * mode n'en est qu'un réglage.
   */
  skipLockedTrigger?: boolean;
};

/** Ce que les réglages ont fait : `triggerSkipped`, le mode laissé à qui le tient (`skipLockedTrigger`). */
export type CastSettingsOutcome = { triggerSkipped: boolean };

/**
 * Ce que la route établit du caster pour la règle du mode d'antenne
 * (`lib/shared/live-trigger-owner.ts`) : admin, permission `tournaments`.
 */
export type CastAccess = {
  oversees: boolean;
  manages: boolean;
};

/** Sans droit particulier : un caster ordinaire. */
export const PLAIN_CAST_ACCESS: CastAccess = { oversees: false, manages: false };

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
 * tient déjà, pour `userId` — un caster du match, qui en devient le
 * propriétaire (`live_trigger_user_id`) s'il y est montré (un caster tu,
 * devenu inéligible, ne tient rien).
 *
 * Un mode inchangé n'écrit rien. Un mode déjà posé ne change que pour son
 * propriétaire, l'arbitre désigné ou un admin (`mayChangeLiveTrigger`) :
 * `LIVE_TRIGGER_NOT_OWNED` sinon — un co-caster ne décide pas pour celui qui
 * l'a posé. Le propriétaire ne compte que s'il caste encore le match en
 * caster montré (`loadShownCasterIds`), la règle de l'instantané : parti ou
 * tu, il laisse le mode au staff. `skip` : rend `false` au lieu de refuser.
 *
 * Les deux effacements de la configuration du staff (`setMatchLiveConfig`) sont
 * repris mot pour mot : démarquer le match referme son antenne, et un mode qui
 * n'est plus manuel la referme aussi — sans quoi un match passé en automatique
 * garderait une ouverture d'antenne qui reprendrait effet à la moindre remise
 * en manuel. Le lien du staff, lui, n'est **pas** touché : un caster ne retire
 * pas la chaîne de l'organisation (seule sa fenêtre à elle le fait).
 *
 * @throws `INVALID_LIVE_TRIGGER` | `MATCH_NOT_CASTABLE` | `MATCH_START_AT_REQUIRED`
 *   | `LIVE_TRIGGER_NOT_OWNED`
 */
export async function applyCastTrigger(
  connection: PoolConnection,
  row: LaunchMatchRow,
  trigger: MatchLiveTrigger | null,
  userId: number,
  access: CastAccess = PLAIN_CAST_ACCESS,
  skip = false,
  memo: ShownMemo = new Map(),
): Promise<boolean> {
  if (trigger !== null && !isMatchLiveTrigger(trigger)) throw new Error("INVALID_LIVE_TRIGGER");
  const current = row.live_trigger ?? null;
  if (trigger === current) {
    // Renvoyé tel quel, le mode n'écrit rien, mais le match doit toujours se
    // caster : un score déclaré ferme aussi le lien qui l'accompagne.
    assertCastTriggerWritable(row, trigger);
    return true;
  }
  const matchId = Number(row.id);
  const actor = { userId, ...access };
  const { hold, shown } = await castTriggerHold(connection, row, userId, memo);
  // L'appelant caste le match (inscription ou réglage de son cast) : un mode
  // sans maître lui revient s'il le change (décision du 2026-11-05) — s'il est
  // montré (le candidat de l'inscription l'est) : un caster tu ne décide pas,
  // comme sur la route du staff (`setMatchLiveConfig`).
  // Démarquer : son maître, l'arbitre ou le staff seulement (`mayUnmarkLiveTrigger`).
  const owns = mayChangeLiveTrigger(hold, actor, shown.has(userId)) && (trigger !== null || mayUnmarkLiveTrigger(hold, actor));
  // Le mode du staff qui porte le lien de l'organisation n'est pas à un porteur
  // de la seule `live` (décision 1 du 2026-11-09, `assertStaffModeKept`).
  const staffMode = owns && !access.manages && hold.ownerId !== userId && (await hasStaffLink(connection, matchId));
  if ((!owns || staffMode) && skip) return false;
  // Un match qui ne se caste plus le dit d'abord : le refus de propriété
  // tairait la vraie raison.
  assertCastTriggerWritable(row, trigger);
  if (!owns) throw new Error("LIVE_TRIGGER_NOT_OWNED");
  if (staffMode) throw new Error("STAFF_STREAM_FORBIDDEN");
  const owner = liveTriggerOwnerAfter(trigger, actor, shown.has(userId), hold.ownerId);
  if (trigger === null) {
    await connection.execute(
      `UPDATE bg_matches SET live_trigger = NULL, live_trigger_user_id = NULL, live_started_at = NULL WHERE id = ?`,
      [matchId],
    );
  } else {
    await connection.execute(
      trigger === "MANUAL"
        ? `UPDATE bg_matches SET live_trigger = ?, live_trigger_user_id = ? WHERE id = ?`
        : `UPDATE bg_matches SET live_trigger = ?, live_trigger_user_id = ?, live_started_at = NULL WHERE id = ?`,
      [trigger, owner, matchId],
    );
  }
  row.live_trigger = trigger;
  row.live_trigger_user_id = owner;
  if (trigger !== "MANUAL") row.live_started_at = null;
  return true;
}

/**
 * Qui est déjà jugé « caster montré » dans la transaction en cours, par compte.
 * Un geste (mode puis lien) juge le même caster plusieurs fois sous le même
 * verrou du match, où ni ses inscriptions ni sa condition de cast ne changent :
 * une lecture suffit. Une carte par appel, jamais partagée entre transactions.
 */
export type ShownMemo = Map<number, boolean>;

/** `loadShownCasterIds` sur `row`, sans relire ce que `memo` a déjà jugé. */
async function loadShownMemo(
  connection: PoolConnection,
  row: LaunchMatchRow,
  userIds: readonly (number | null)[],
  memo: ShownMemo,
): Promise<Set<number>> {
  const asked = [...new Set(userIds.filter((id): id is number => id !== null))];
  const missing = asked.filter((id) => !memo.has(id));
  if (missing.length > 0) {
    const shown = await loadShownCasterIds(connection, Number(row.id), missing, row.tournament_game, castBeforeLaunch(row));
    for (const id of missing) memo.set(id, shown.has(id));
  }
  return new Set(asked.filter((id) => memo.get(id) === true));
}

/** @throws `NOT_MATCH_CASTER` quand `userId` n'est pas un caster montré du match. */
async function assertShownCaster(
  connection: PoolConnection,
  row: LaunchMatchRow,
  userId: number,
  memo: ShownMemo,
): Promise<void> {
  const shown = await loadShownMemo(connection, row, [userId], memo);
  if (!shown.has(userId)) throw new Error("NOT_MATCH_CASTER");
}

/**
 * Qui tient le mode d'antenne posé sur `row` : son propriétaire s'il y est un
 * caster montré, et l'arbitre désigné éligible. `shown` dit aussi si
 * `candidateId` (qui pose le nouveau mode) y est montré.
 */
async function castTriggerHold(
  connection: PoolConnection,
  row: LaunchMatchRow,
  candidateId: number | null,
  memo: ShownMemo,
) {
  const current = row.live_trigger ?? null;
  const ownerId = current === null ? null : nullableId(row.live_trigger_user_id);
  const shown = await loadShownMemo(connection, row, [ownerId, candidateId], memo);
  // L'arbitre ne médie qu'un match à jouer — la règle de la route du staff
  // (`KEPT_REFEREE_SQL`) : un score déclaré clôt la médiation.
  const mediates = row.refereeEligible && (row.status === "PENDING" || row.status === "READY");
  const hold = {
    trigger: current,
    ownerId: ownerId !== null && shown.has(ownerId) ? ownerId : null,
    refereeId: mediates ? nullableId(row.referee_user_id) : null,
  };
  return { hold, shown };
}

/**
 * Pose (ou efface) le lien du stream que **tient** ce caster.
 *
 * Jamais celui du staff (`casterStreamEditable`) : un caster qui a rejoint « le
 * stream du match » lit la chaîne de l'organisation, il ne la réécrit pas
 * (`CAST_STREAM_NOT_OWNED`) ; ni le lien qu'un co-caster encore sur le stream
 * a fourni (`CAST_STREAM_LINK_HELD`), staff compris (celui d'un caster parti se reprend). Le lien posé lui est rattaché (`link_user_id`) et
 * part avec son compte (`withdrawUserCasts`) : un caster ne dit jamais un lien
 * « de l'organisation » (décision du 2026-11-09), seul le staff le fait dans la
 * configuration du direct (`setMatchLiveConfig`).
 *
 * Rend les streams du match **tels qu'ils sont après l'écriture**, pour le
 * ménage de l'appelant.
 *
 * Un lien ne s'efface pas : le stream d'un caster sans lien n'apparaîtrait
 * sur aucune vue, et le staff le prendrait pour le sien (`staffStream`, le
 * premier stream sans lien) — exigé ici comme à l'inscription.
 *
 * @throws `STREAM_NOT_FOUND` | `CAST_STREAM_NOT_OWNED` | `CAST_STREAM_LINK_HELD` | `INVALID_STREAM_URL`
 *   | `STREAM_URL_REQUIRED`
 */
export async function setCasterStreamUrl(
  connection: PoolConnection,
  matchId: number,
  streamId: number,
  url: string | null,
  linkUserId: number | null,
  manages: boolean,
  visibility: CastVisibility,
): Promise<MatchStreamRow[]> {
  const streams = await lockMatchStreams(connection, matchId, true);
  const target = streams.find((stream) => stream.id === streamId);
  if (!target) throw new Error("STREAM_NOT_FOUND");
  if (!casterStreamEditable(target)) throw new Error("CAST_STREAM_NOT_OWNED");
  if (url === null) throw new Error("STREAM_URL_REQUIRED");
  // Un lien inchangé n'est pas réécrit : il reste à qui l'a fourni, comme dans
  // la configuration du staff (`planStaffStreamUrl` puis `applyStaffStreamPlan`, live-streams.ts).
  if (target.liveUrl === url) return streams;
  // Un lien dit de l'organisation ne se remplace que par le staff : la seule
  // `live` ne l'efface pas en posant le sien. Le lien qu'un co-caster encore sur
  // ce stream a fourni pointe sa chaîne, et lui est rattaché : nul ne le
  // remplace par cette route, staff compris (l'arbitre le corrige dans la
  // configuration du direct).
  if (target.liveUrl !== null) {
    const holder = await streamLinkHolder(connection, matchId, streamId);
    if (holder.userId === null) {
      if (!manages) throw new Error("CAST_STREAM_NOT_OWNED");
    } else if (holder.userId !== linkUserId && (await showsOnStream(connection, matchId, holder.userId, holder.casts, visibility))) {
      throw new Error("CAST_STREAM_LINK_HELD");
    }
  }
  await connection.execute(
    `UPDATE bg_match_streams SET live_url = ?, link_user_id = ? WHERE id = ? AND staff_owned = 0`,
    [url, linkUserId, streamId],
  );
  return streams.map((stream) => (stream.id === streamId ? { ...stream, liveUrl: url } : stream));
}

/** Ce qui dit si un caster est montré (`loadShownCasterIds`) : le jeu du match, et s'il est encore avant le lancement. */
export type CastVisibility = { game: TournamentGame; beforeLaunch: boolean };

/**
 * Le fournisseur du lien caste-t-il encore ce stream du match **en caster
 * montré** ? Un caster tu (condition du cast perdue, pas encore retiré) ne
 * garde pas son lien contre un co-caster montré : il ne pourrait lui-même plus
 * le changer (`assertShownCaster`).
 */
async function showsOnStream(
  connection: PoolConnection,
  matchId: number,
  holderId: number,
  casts: boolean,
  visibility: CastVisibility,
): Promise<boolean> {
  if (!casts) return false;
  if (!visibility.beforeLaunch) return true;
  const shown = await loadShownCasterIds(connection, matchId, [holderId], visibility.game, true);
  return shown.has(holderId);
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
  access: CastAccess = PLAIN_CAST_ACCESS,
): Promise<CastSettingsOutcome> {
  const matchId = Number(row.id);
  // Le mode puis le lien jugent le même caster : une seule lecture.
  const memo: ShownMemo = new Map();
  const triggerSkipped =
    settings.trigger !== undefined &&
    !(await applyCastTrigger(connection, row, settings.trigger, userId, access, settings.skipLockedTrigger === true, memo));
  let streams: MatchStreamRow[] | undefined;
  // Le lien d'un stream (et son origine) ne se règle que par un caster montré :
  // un caster tu ne réécrit pas le lien public d'un stream qu'il partage.
  if (settings.liveUrl !== undefined && !access.oversees) {
    await assertShownCaster(connection, row, userId, memo);
  }
  if (settings.liveUrl !== undefined) {
    const url = parseStreamUrlInput(settings.liveUrl);
    streams = await setCasterStreamUrl(
      connection,
      matchId,
      streamId,
      url,
      userId,
      access.manages,
      { game: row.tournament_game, beforeLaunch: castBeforeLaunch(row) },
    );
  }
  if (settings.battletag !== undefined) {
    await writeCastBattletag(connection, matchId, userId, parseCastBattletagInput(settings.battletag));
  }
  // Un lien retiré peut laisser un stream que plus personne ne tient : le même
  // ménage que la configuration du staff et que le retrait d'un caster.
  // Les casters sont ceux de la ligne verrouillée : seul « Configurer ma
  // diffusion » passe un lien ici, sans ajouter ni retirer de caster
  // (l'inscription pose le sien avec son stream et passe `liveUrl: undefined`) ;
  // les relire sous `FOR UPDATE` verrouillerait l'intervalle de
  // `bg_match_casters` des matchs voisins.
  if (streams !== undefined) await pruneMatchStreams(connection, matchId, { streams, casters: row.casters });
  return { triggerSkipped };
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
