/**
 * Casters et streams d'un match (`docs/features/MATCH_LAUNCH.md` § Casters et
 * streams) : lectures par lot et ménage, partagés par le lancement
 * (`match-launch.ts`), la modale (`match-launch-info.ts`), l'instantané
 * (`snapshot.ts`), la diffusion (`live-streams.ts`) et l'effacement de compte.
 *
 * Un match a zéro, un ou plusieurs streams (`bg_match_streams`), chacun avec
 * son lien facultatif ; chaque caster (`bg_match_casters`) est rattaché à un
 * stream de son match. Le **premier lien** — celui du staff, à défaut le
 * stream au plus petit identifiant qui en a un — est celui que montrent les vues compactes (carte,
 * bandeaux, accueil) et que lisent les annonces #live : une seule définition,
 * {@link firstStreamUrlSql}.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { LIVE_STAFF_SQL } from "@/lib/server/privacy-consent";
import { staffStream } from "@/lib/shared/live-streams";
import type { CastEligibilityFields } from "./cast-eligibility";

export { staffStream };

/** Ce qui s'exécute : une connexion ou le pool. */
type Executor = Pick<PoolConnection, "execute">;

/**
 * Le compte `u` remplit la condition du cast (`castEligibilityBlock`) :
 * permission `live` (`LIVE_STAFF_SQL`), tag Discord certifié, Battle.net
 * rattaché, compte non supprimé — la même règle, en base.
 */
const CAST_ELIGIBLE_SQL = `(COALESCE(u.is_deleted, 0) = 0
             AND u.discord_verified_at IS NOT NULL AND COALESCE(u.discord_pseudo, '') <> ''
             AND u.blizzard_sub IS NOT NULL AND COALESCE(u.overwatch_battletag, '') <> ''
             AND ${LIVE_STAFF_SQL})`;

/**
 * Sous-requête du premier lien d'un match, à poser dans une liste de colonnes
 * (`… AS live_url`). `alias` est l'alias SQL de `bg_matches` dans la requête —
 * une constante du code, jamais une entrée.
 *
 * Le lien posé par le staff passe devant ceux des casters, même ouverts avant
 * lui : l'annonce #live et l'accueil renvoient à la chaîne que le staff a
 * choisie, comme avant les co-casters.
 *
 * Le stream d'un caster que la lecture tait (inscription d'un compte qui ne
 * remplit plus la condition, avant le lancement : `casterWithdrawn`) ne donne
 * pas le premier lien : l'accueil et l'annonce #live n'envoient jamais vers la
 * chaîne d'un caster que le site ne montre plus. Le stream du staff, un match
 * lancé ou joué gardent leurs liens.
 */
export function firstStreamUrlSql(alias: string): string {
  return `(SELECT fs.live_url FROM bg_match_streams fs
           WHERE fs.match_id = ${alias}.id AND fs.live_url IS NOT NULL
             AND (fs.staff_owned = 1 OR ${alias}.status = 'COMPLETED' OR ${alias}.launched_at IS NOT NULL
                  OR EXISTS (SELECT 1 FROM bg_match_casters fc JOIN bg_users u ON u.id = fc.user_id
                             WHERE fc.match_id = fs.match_id AND fc.stream_id = fs.id
                               AND ${CAST_ELIGIBLE_SQL}))
           ORDER BY fs.staff_owned DESC, fs.id LIMIT 1)`;
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

/**
 * Un stream d'un match. `staff` : le stream du match, dont le lien est réglé
 * par la configuration du direct (`setMatchLiveConfig`) — sinon, le stream
 * qu'un caster a ouvert, avec le lien de sa chaîne.
 */
export type MatchStreamRow = { id: number; matchId: number; liveUrl: string | null; staff: boolean };

type CasterLinkRow = RowDataPacket & {
  match_id: number;
  user_id: number;
  stream_id: number;
  ready_at: Date | string | null;
};

type CasterUserRow = CasterLinkRow & CastEligibilityFields & { pseudo: string };

type StreamRow = RowDataPacket & { id: number; match_id: number; live_url: string | null; staff_owned: number };

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
  return {
    id: Number(row.id),
    matchId: Number(row.match_id),
    liveUrl: row.live_url ?? null,
    staff: Number(row.staff_owned) === 1,
  };
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
    `SELECT id, match_id, live_url, staff_owned FROM bg_match_streams
     WHERE match_id IN (${placeholders(ids)}) ORDER BY match_id, id`,
    ids,
  );
  return groupByMatch(rows.map(toStream));
}

/** Streams d'**un** match, relus sous verrou (table seule), du plus ancien au plus récent. */
export async function lockMatchStreams(connection: Executor, matchId: number): Promise<MatchStreamRow[]> {
  const [rows] = await connection.execute<StreamRow[]>(
    `SELECT id, match_id, live_url, staff_owned FROM bg_match_streams WHERE match_id = ? ORDER BY id FOR UPDATE`,
    [matchId],
  );
  return rows.map(toStream);
}

/**
 * Les streams à effacer : ceux qu'aucun caster ne tient plus, sauf le stream du
 * staff tant qu'il a un lien — le lien que le staff a posé sur le match reste
 * quand ses casters s'en vont, comme avant les co-casters. Le stream qu'un
 * caster a ouvert part avec le dernier de ses casters, et le lien de sa chaîne
 * avec lui. Pur, pour être testé sans base.
 */
export function orphanStreamIds(
  streams: readonly MatchStreamRow[],
  casters: readonly Pick<MatchCasterLink, "streamId">[],
): number[] {
  const held = new Set(casters.map((caster) => caster.streamId));
  return streams
    .filter((stream) => !held.has(stream.id) && !(stream.staff && stream.liveUrl !== null))
    .map((stream) => stream.id);
}

/**
 * Efface les streams devenus orphelins (`orphanStreamIds`) d'un match. Appelée
 * après tout retrait de caster, dans la même transaction, sous le verrou du
 * match. Deux lectures et une écriture : un `DELETE` ne peut pas relire sa
 * propre table en sous-requête.
 */
export async function pruneMatchStreams(connection: Executor, matchId: number): Promise<void> {
  const streams = await lockMatchStreams(connection, matchId);
  if (streams.length === 0) return;
  const casters = await lockMatchCasters(connection, matchId);
  const orphans = orphanStreamIds(streams, casters);
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
 * sont effacés — le stream qu'il avait ouvert, avec le lien de sa chaîne
 * (`orphanStreamIds`).
 */
export async function withdrawUserCasts(
  connection: Executor,
  userId: number,
  includeCompleted: boolean,
): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { match_id: number })[]>(
    `SELECT c.match_id FROM bg_match_casters c
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
    await pruneMatchStreams(connection, matchId);
  }
  return matchIds;
}
