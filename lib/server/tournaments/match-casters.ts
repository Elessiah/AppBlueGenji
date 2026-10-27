/**
 * Casters et streams d'un match (`docs/features/MATCH_LAUNCH.md` § Casters et
 * streams) : lectures par lot et ménage, partagés par le lancement
 * (`match-launch.ts`), la modale (`match-launch-info.ts`), l'instantané
 * (`snapshot.ts`), la diffusion (`live-streams.ts`) et l'effacement de compte.
 *
 * Un match a zéro, un ou plusieurs streams (`bg_match_streams`), chacun avec
 * son lien facultatif ; chaque caster (`bg_match_casters`) est rattaché à un
 * stream de son match. Le **premier lien** — le stream au plus petit
 * identifiant qui en a un — est celui que montrent les vues compactes (carte,
 * bandeaux, accueil) et que lisent les annonces #live : une seule définition,
 * {@link firstStreamUrlSql}.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { CastEligibilityFields } from "./cast-eligibility";

/** Ce qui s'exécute : une connexion ou le pool. */
type Executor = Pick<PoolConnection, "execute">;

/**
 * Sous-requête du premier lien d'un match, à poser dans une liste de colonnes
 * (`… AS live_url`). `alias` est l'alias SQL de `bg_matches` dans la requête —
 * une constante du code, jamais une entrée.
 */
export function firstStreamUrlSql(alias: string): string {
  return `(SELECT fs.live_url FROM bg_match_streams fs
           WHERE fs.match_id = ${alias}.id AND fs.live_url IS NOT NULL
           ORDER BY fs.id LIMIT 1)`;
}

/** Un caster d'un match, tel que la base le décrit. */
export type MatchCasterLink = {
  matchId: number;
  userId: number;
  streamId: number;
  readyAt: Date | string | null;
};

/** Un caster et ce qu'il faut pour rejouer sa condition (`castEligibilityBlock`). */
export type MatchCasterRow = MatchCasterLink & {
  pseudo: string;
  eligibility: CastEligibilityFields;
};

/** Un stream d'un match. */
export type MatchStreamRow = { id: number; matchId: number; liveUrl: string | null };

type CasterLinkRow = RowDataPacket & {
  match_id: number;
  user_id: number;
  stream_id: number;
  ready_at: Date | string | null;
};

type CasterUserRow = CasterLinkRow & CastEligibilityFields & { pseudo: string };

type StreamRow = RowDataPacket & { id: number; match_id: number; live_url: string | null };

function placeholders(ids: readonly number[]): string {
  return ids.map(() => "?").join(", ");
}

function groupByMatch<T extends { matchId: number }>(items: readonly T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const list = grouped.get(item.matchId) ?? [];
    list.push(item);
    grouped.set(item.matchId, list);
  }
  return grouped;
}

function toLink(row: CasterLinkRow): MatchCasterLink {
  return {
    matchId: Number(row.match_id),
    userId: Number(row.user_id),
    streamId: Number(row.stream_id),
    readyAt: row.ready_at ?? null,
  };
}

function toStream(row: StreamRow): MatchStreamRow {
  return { id: Number(row.id), matchId: Number(row.match_id), liveUrl: row.live_url ?? null };
}

/**
 * Casters d'**un** match, relus sous verrou (lecture *courante* : un caster
 * inscrit par une transaction validée après le début de celle-ci est vu). La
 * table est lue seule — jamais de verrou posé à travers une jointure (MariaDB,
 * `CLAUDE.md`). Ordre d'inscription.
 */
export async function lockMatchCasters(connection: Executor, matchId: number): Promise<MatchCasterLink[]> {
  const [rows] = await connection.execute<CasterLinkRow[]>(
    `SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters
     WHERE match_id = ? ORDER BY created_at, user_id FOR UPDATE`,
    [matchId],
  );
  return rows.map(toLink);
}

/** Casters de plusieurs matchs, en une lecture ordinaire. */
export async function loadCasterLinks(
  executor: Executor,
  matchIds: readonly number[],
): Promise<Map<number, MatchCasterLink[]>> {
  const ids = [...new Set(matchIds)];
  if (ids.length === 0) return new Map();
  const [rows] = await executor.execute<CasterLinkRow[]>(
    `SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters
     WHERE match_id IN (${placeholders(ids)}) ORDER BY match_id, created_at, user_id`,
    ids,
  );
  return groupByMatch(rows.map(toLink));
}

/**
 * Casters de plusieurs matchs avec leur pseudo et leur condition de cast, en
 * une lecture — pour l'instantané, qui tait un caster devenu inéligible.
 */
export async function loadMatchCasters(
  executor: Executor,
  matchIds: readonly number[],
): Promise<Map<number, MatchCasterRow[]>> {
  const ids = [...new Set(matchIds)];
  if (ids.length === 0) return new Map();
  const [rows] = await executor.execute<CasterUserRow[]>(
    `SELECT c.match_id, c.user_id, c.stream_id, c.ready_at, u.pseudo,
            u.discord_verified_at, u.discord_pseudo, u.blizzard_sub, u.overwatch_battletag,
            u.is_deleted, u.is_admin, u.platform_roles_json
     FROM bg_match_casters c
     JOIN bg_users u ON u.id = c.user_id
     WHERE c.match_id IN (${placeholders(ids)})
     ORDER BY c.match_id, c.created_at, c.user_id`,
    ids,
  );
  return groupByMatch(
    rows.map((row) => ({
      ...toLink(row),
      pseudo: row.pseudo,
      eligibility: {
        discord_verified_at: row.discord_verified_at,
        discord_pseudo: row.discord_pseudo,
        blizzard_sub: row.blizzard_sub,
        overwatch_battletag: row.overwatch_battletag,
        is_deleted: Number(row.is_deleted),
        is_admin: Number(row.is_admin),
        platform_roles_json: row.platform_roles_json,
      },
    })),
  );
}

/** Streams de plusieurs matchs, du plus ancien au plus récent. */
export async function loadMatchStreams(
  executor: Executor,
  matchIds: readonly number[],
): Promise<Map<number, MatchStreamRow[]>> {
  const ids = [...new Set(matchIds)];
  if (ids.length === 0) return new Map();
  const [rows] = await executor.execute<StreamRow[]>(
    `SELECT id, match_id, live_url FROM bg_match_streams
     WHERE match_id IN (${placeholders(ids)}) ORDER BY match_id, id`,
    ids,
  );
  return groupByMatch(rows.map(toStream));
}

/** Streams d'**un** match, relus sous verrou (table seule), du plus ancien au plus récent. */
export async function lockMatchStreams(connection: Executor, matchId: number): Promise<MatchStreamRow[]> {
  const [rows] = await connection.execute<StreamRow[]>(
    `SELECT id, match_id, live_url FROM bg_match_streams WHERE match_id = ? ORDER BY id FOR UPDATE`,
    [matchId],
  );
  return rows.map(toStream);
}

/**
 * Le stream **principal** d'un match : le premier qui a un lien (celui des vues
 * compactes), sinon le premier tout court. C'est lui que règle le lien du staff
 * (`setMatchLiveConfig`), et lui qui survit au départ de ses casters tant qu'il
 * porte un lien.
 */
export function primaryStream<T extends { id: number; liveUrl: string | null }>(streams: readonly T[]): T | null {
  return streams.find((stream) => stream.liveUrl !== null) ?? streams[0] ?? null;
}

/**
 * Les streams à effacer : ceux qu'aucun caster ne tient plus, sauf le stream
 * principal tant qu'il a un lien — le lien que le staff a posé sur le match
 * reste quand le caster s'en va, comme avant les co-casters. `alwaysDrop` lève
 * cette exception pour les streams nommés : à la suppression d'un compte, le
 * stream qu'il était seul à tenir part avec son lien, même principal — ce lien
 * peut désigner sa chaîne. Pur, pour être testé sans base.
 */
export function orphanStreamIds(
  streams: readonly MatchStreamRow[],
  casters: readonly Pick<MatchCasterLink, "streamId">[],
  alwaysDrop: readonly number[] = [],
): number[] {
  const held = new Set(casters.map((caster) => caster.streamId));
  const primary = primaryStream(streams);
  return streams
    .filter((stream) => !held.has(stream.id))
    .filter(
      (stream) => alwaysDrop.includes(stream.id) || !(stream.id === primary?.id && stream.liveUrl !== null),
    )
    .map((stream) => stream.id);
}

/**
 * Efface les streams devenus orphelins (`orphanStreamIds`) d'un match. Appelée
 * après tout retrait de caster, dans la même transaction, sous le verrou du
 * match. Deux lectures et une écriture : un `DELETE` ne peut pas relire sa
 * propre table en sous-requête.
 */
export async function pruneMatchStreams(
  connection: Executor,
  matchId: number,
  alwaysDrop: readonly number[] = [],
): Promise<void> {
  const streams = await lockMatchStreams(connection, matchId);
  if (streams.length === 0) return;
  const casters = await lockMatchCasters(connection, matchId);
  const orphans = orphanStreamIds(streams, casters, alwaysDrop);
  if (orphans.length === 0) return;
  await connection.execute(
    `DELETE FROM bg_match_streams WHERE match_id = ? AND id IN (${placeholders(orphans)})`,
    [matchId, ...orphans],
  );
}

/**
 * Retire un compte de tous les casts qui le nomment encore — suppression de
 * compte (`lib/server/users/account-erasure.ts`). L'anonymisation garde les
 * matchs joués (`includeCompleted: false`) : l'histoire ne se réécrit pas ;
 * l'effacement emporte tout. Chaque match est verrouillé avant ses casters et
 * ses streams, dans l'ordre de `claimMatchCast`, puis ses streams orphelins
 * sont effacés — le stream que le compte tenait seul avec son lien, même
 * principal (`orphanStreamIds`, `alwaysDrop`).
 */
export async function withdrawUserCasts(
  connection: Executor,
  userId: number,
  includeCompleted: boolean,
): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { match_id: number; stream_id: number })[]>(
    `SELECT c.match_id, c.stream_id FROM bg_match_casters c
     JOIN bg_matches m ON m.id = c.match_id
     WHERE c.user_id = ?${includeCompleted ? "" : " AND m.status <> 'COMPLETED'"}
     ORDER BY c.match_id`,
    [userId],
  );
  const matchIds = rows.map((row) => Number(row.match_id));
  for (const row of rows) {
    const matchId = Number(row.match_id);
    await connection.execute(`SELECT id FROM bg_matches WHERE id = ? FOR UPDATE`, [matchId]);
    await connection.execute(`DELETE FROM bg_match_casters WHERE match_id = ? AND user_id = ?`, [matchId, userId]);
    await pruneMatchStreams(connection, matchId, [Number(row.stream_id)]);
  }
  return matchIds;
}
