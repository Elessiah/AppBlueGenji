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
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { LIVE_STAFF_SQL } from "@/lib/server/privacy-consent";
import { STREAM_URL_CANDIDATES_SEPARATOR } from "@/lib/shared/live-announcements";
import { staffStream } from "@/lib/shared/live-streams";
import { verifiedBattletagSql } from "@/lib/server/battletag-origin";
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
             AND ${verifiedBattletagSql("u")}
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
 * chaîne d'un caster que le site ne montre plus. Le stream du staff garde son
 * lien ; un match lancé ou joué garde ceux qu'un caster tient encore, éligible
 * ou non — lancé **sur son appariement courant**, comme le juge l'instantané
 * (`castBeforeLaunch`) —, jamais celui d'un stream orphelin (`shownStreams`).
 */
export function firstStreamUrlSql(alias: string): string {
  return `(SELECT fs.live_url ${shownStreamUrlsFromSql(alias)}
           ORDER BY fs.staff_owned DESC, fs.id LIMIT 1)`;
}

/**
 * Tous les liens publics du match, dans l'ordre de {@link firstStreamUrlSql}
 * (staff d'abord), joints par {@link STREAM_URL_CANDIDATES_SEPARATOR} : le
 * lecteur garde le premier qu'il accepte (`firstAnnounceableUrl`), plutôt que
 * de n'avoir aucun lien quand le premier est refusé (page de redirection).
 */
export function streamUrlCandidatesSql(alias: string): string {
  return `(SELECT GROUP_CONCAT(fs.live_url ORDER BY fs.staff_owned DESC, fs.id SEPARATOR '${STREAM_URL_CANDIDATES_SEPARATOR}')
           ${shownStreamUrlsFromSql(alias)})`;
}

/** `FROM … WHERE` des liens publics d'un match (règle de {@link firstStreamUrlSql}). */
function shownStreamUrlsFromSql(alias: string): string {
  return `FROM bg_match_streams fs
           WHERE fs.match_id = ${alias}.id AND fs.live_url IS NOT NULL
             AND (fs.staff_owned = 1
                  OR ((${alias}.status = 'COMPLETED'
                       OR (${alias}.launched_at IS NOT NULL
                           AND ${alias}.launch_pairing = CONCAT(${alias}.team1_id, ':', ${alias}.team2_id)))
                      AND EXISTS (SELECT 1 FROM bg_match_casters oc
                                  WHERE oc.match_id = fs.match_id AND oc.stream_id = fs.id))
                  OR EXISTS (SELECT 1 FROM bg_match_casters fc JOIN bg_users u ON u.id = fc.user_id
                             WHERE fc.match_id = fs.match_id AND fc.stream_id = fs.id
                               AND ${CAST_ELIGIBLE_SQL}))`;
}

/** Un caster d'un match, tel que la base le décrit. */
export type MatchCasterLink = {
  matchId: number;
  userId: number;
  streamId: number;
  readyAt: Date | string | null;
  /**
   * BattleTag donné pour **ce** cast (`docs/features/CAST_SETTINGS.md`), jamais
   * vérifié ; `null` = celui de son compte. Absent des lectures qui ne le lisent
   * pas (verrou du lancement, instantané) : seule la présentation d'un match en
   * a besoin.
   */
  castBattletag?: string | null;
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
export type MatchStreamRow = {
  id: number;
  matchId: number;
  liveUrl: string | null;
  staff: boolean;
  /**
   * Le stream du staff dont le lien est celui de l'organisation (`link_user_id`
   * nul, case cochée dans « Diffusion officielle ») ; lu par `loadMatchStreams`
   * seulement, pour l'instantané (`BracketMatch.officialBroadcastLink`).
   */
  organisation?: boolean;
};

type CasterLinkRow = RowDataPacket & {
  match_id: number;
  user_id: number;
  stream_id: number;
  ready_at: Date | string | null;
  /** Absente des lectures qui ne la demandent pas (`toLink` la laisse alors absente). */
  cast_battletag?: string | null;
};

type CasterUserRow = CasterLinkRow & CastEligibilityFields & { pseudo: string };

type StreamRow = RowDataPacket & {
  id: number;
  match_id: number;
  live_url: string | null;
  staff_owned: number;
  link_user_id?: number | null;
};

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
  const link: MatchCasterLink = {
    matchId: Number(row.match_id),
    userId: Number(row.user_id),
    streamId: Number(row.stream_id),
    readyAt: row.ready_at ?? null,
  };
  // Lue seule par la présentation d'un match : une lecture qui ne la demande
  // pas laisse le champ **absent**, et non à `null` — qui dirait « aucun tag ».
  if (row.cast_battletag !== undefined) link.castBattletag = row.cast_battletag ?? null;
  return link;
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
 *
 * `held` : l'appelant tient **déjà le verrou de la ligne du match, pris en
 * première instruction de sa transaction** (`lockLaunchMatch`) — toute écriture
 * d'un caster ou d'un stream passe par lui, donc une lecture ordinaire suffit,
 * et le `FOR UPDATE` n'est pas posé : sur un match sans caster il verrouillerait
 * l'intervalle vide de l'index, partagé par tous les matchs voisins sans caster,
 * et deux inscriptions simultanées sur deux matchs neufs s'interbloqueraient.
 * Quand un instantané a précédé le verrou (entretien des lancements, effacement
 * de compte), `held` reste faux : la lecture verrouillante est la seule *courante*.
 */
export async function lockMatchCasters(
  connection: Executor,
  matchId: number,
  held = false,
): Promise<MatchCasterLink[]> {
  const [rows] = await connection.execute<CasterLinkRow[]>(
    `SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters
     WHERE match_id = ? ORDER BY created_at, user_id${held ? "" : " FOR UPDATE"}`,
    [matchId],
  );
  return rows.map(toLink);
}

/**
 * Casters de plusieurs matchs, en une lecture ordinaire. Le BattleTag de cast
 * n'est lu que sur demande (`battletag`) : seule la fenêtre de lancement le
 * montre — une poussée aux joueurs n'a pas à le lire (minimisation).
 */
export async function loadCasterLinks(
  executor: Executor,
  matchIds: readonly number[],
  options: { battletag?: boolean } = {},
): Promise<Map<number, MatchCasterLink[]>> {
  const ids = [...new Set(matchIds)];
  if (ids.length === 0) return new Map();
  const battletag = options.battletag === true ? ", cast_battletag" : "";
  const [rows] = await executor.execute<CasterLinkRow[]>(
    `SELECT match_id, user_id, stream_id, ready_at${battletag} FROM bg_match_casters
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
            u.overwatch_battletag_typed, u.is_deleted, u.is_admin, u.platform_roles_json
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
        overwatch_battletag_typed: row.overwatch_battletag_typed,
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
    `SELECT id, match_id, live_url, staff_owned, link_user_id FROM bg_match_streams
     WHERE match_id IN (${placeholders(ids)}) ORDER BY match_id, id`,
    ids,
  );
  return groupByMatch(
    rows.map((row) => {
      const stream = toStream(row);
      return { ...stream, organisation: stream.staff && (row.link_user_id ?? null) === null };
    }),
  );
}

/**
 * Streams d'**un** match, relus sous verrou (table seule), du plus ancien au
 * plus récent. `held` : voir `lockMatchCasters`.
 */
export async function lockMatchStreams(
  connection: Executor,
  matchId: number,
  held = false,
): Promise<MatchStreamRow[]> {
  const [rows] = await connection.execute<StreamRow[]>(
    `SELECT id, match_id, live_url, staff_owned FROM bg_match_streams
     WHERE match_id = ? ORDER BY id${held ? "" : " FOR UPDATE"}`,
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
 *
 * `known` : ce que l'appelant tient déjà sous le verrou du match, **tel que la
 * transaction l'a laissé** — les streams (`setMatchLiveConfig`) ou les casters
 * restants (un retrait : ceux de la ligne verrouillée moins le caster parti).
 * Ce qui est fourni n'est pas relu ; ce qui manque est lu sous verrou.
 */
export async function pruneMatchStreams(
  connection: Executor,
  matchId: number,
  known: {
    streams?: readonly MatchStreamRow[];
    casters?: readonly Pick<MatchCasterLink, "streamId">[];
    /** L'appelant tient le verrou de la ligne du match : lectures ordinaires (`lockMatchCasters`). */
    held?: boolean;
  } = {},
): Promise<void> {
  const held = known.held === true;
  const streams = known.streams ?? (await lockMatchStreams(connection, matchId, held));
  if (streams.length === 0) return;
  const casters = known.casters ?? (await lockMatchCasters(connection, matchId, held));
  const orphans = orphanStreamIds(streams, casters);
  if (orphans.length === 0) return;
  await connection.execute(
    `DELETE FROM bg_match_streams WHERE match_id = ? AND id IN (${placeholders(orphans)})`,
    [matchId, ...orphans],
  );
}

/** Ce que le retrait d'un compte de ses matchs a touché (`withdrawUserCasts`). */
export type MatchWithdrawal = {
  /** Matchs touchés, dans l'ordre croissant. */
  matchIds: number[];
  /** Leurs tournois, sans doublon : à prévenir après le commit (`publishMatchUpdatedEvent`). */
  tournamentIds: number[];
  /**
   * Parmi eux, ceux dont un match touché n'est **pas terminé** : seuls ceux-là
   * peuvent changer l'accueil (`landingLive`) — un lien ou un arbitre retiré
   * d'un match joué ne change que son instantané (et le message #live, que
   * `publishMatchUpdatedEvent` redemande toujours).
   */
  liveTournamentIds: number[];
  /** Matchs non joués dont il était l'arbitre, retiré ici (lus sous verrou). */
  releasedRefereeMatchIds: number[];
  /** Matchs non joués dont son cast a été retiré (lus sous verrou). */
  releasedCastMatchIds: number[];
};

type WithdrawnMatchRow = RowDataPacket & { id: number; tournament_id: number; status: string };

/**
 * Efface en une fois les streams devenus orphelins (`orphanStreamIds`) de
 * plusieurs matchs, déjà verrouillés par l'appelant : streams puis casters,
 * chaque table seule, comme `pruneMatchStreams`.
 */
async function pruneStreamsOf(connection: Executor, matchIds: readonly number[]): Promise<void> {
  if (matchIds.length === 0) return;
  const [streamRows] = await connection.execute<StreamRow[]>(
    `SELECT id, match_id, live_url, staff_owned FROM bg_match_streams
     WHERE match_id IN (${placeholders(matchIds)}) ORDER BY match_id, id FOR UPDATE`,
    [...matchIds],
  );
  if (streamRows.length === 0) return;
  const [casterRows] = await connection.execute<CasterLinkRow[]>(
    `SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters
     WHERE match_id IN (${placeholders(matchIds)}) ORDER BY match_id, created_at, user_id FOR UPDATE`,
    [...matchIds],
  );
  const streams = groupByMatch(streamRows.map(toStream));
  const casters = groupByMatch(casterRows.map(toLink));
  const orphans = [...streams].flatMap(([matchId, list]) => orphanStreamIds(list, casters.get(matchId) ?? []));
  if (orphans.length === 0) return;
  await connection.execute(`DELETE FROM bg_match_streams WHERE id IN (${placeholders(orphans)})`, orphans);
}

/**
 * Démarque (`live_trigger`, son maître et l'ouverture d'antenne vidés) ceux de
 * ces matchs, **non joués**, qui n'ont plus aucun stream — ni de caster, ni
 * celui du staff avec son lien. L'inscription d'un caster marque le match
 * casté (`CAST_SETTINGS.md`) : son dernier stream parti, il passerait sinon
 * « En direct » à son lancement sans que personne ne diffuse. Une seule
 * instruction pour tous ; l'appelant tient déjà le verrou de leurs lignes.
 * Rend le nombre de matchs démarqués.
 */
export async function unmarkUncastMatches(connection: Executor, matchIds: readonly number[]): Promise<number> {
  if (matchIds.length === 0) return 0;
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE bg_matches m SET m.live_trigger = NULL, m.live_trigger_user_id = NULL, m.live_started_at = NULL
      WHERE m.id IN (${placeholders(matchIds)}) AND m.status <> 'COMPLETED' AND m.live_trigger IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM bg_match_streams us WHERE us.match_id = m.id)`,
    [...matchIds],
  );
  return Number(result?.affectedRows ?? 0);
}

/**
 * Retire un compte de tous les casts et de tous les arbitrages qui le nomment
 * encore — suppression de compte (`lib/server/users/account-erasure.ts`).
 * L'anonymisation garde son inscription de caster sur les matchs joués
 * (`includeCompleted: false`) : l'histoire ne se réécrit pas ; l'effacement
 * emporte tout. L'arbitrage part dans les deux cas, matchs joués compris, avec
 * son « Prêt » (`referee_ready_at`, que la clé étrangère de l'effacement
 * laisserait seul).
 *
 * Dans les deux cas, chaque lien de chaîne qu'il a fourni (`link_user_id` : en
 * ouvrant son stream, ou dans la configuration du direct quand il l'a posé
 * comme **sa** chaîne — la case « lien de l'organisation » décochée, ou sans
 * la permission `tournaments`) est retiré, **matchs joués compris** et même
 * d'un stream qu'un co-caster tient encore : le stream reste à ce co-caster,
 * sans lien. Le lien de l'organisation (`link_user_id` nul) n'est jamais touché,
 * même quand celui qui l'a posé castait le match.
 *
 * Tous les matchs touchés — castés, liens fournis, arbitrés — sont verrouillés
 * **en une liste triée par id** (une seule instruction, table seule), avant
 * leurs casters et leurs streams, puis chaque écriture vaut pour tous à la
 * fois : quelques allers-retours en tout, quel que soit le nombre de matchs.
 * Les listes de départ sont des lectures ordinaires : une inscription de
 * caster du même compte pendant sa suppression ne peut pas leur échapper, elle
 * verrouille d'abord la ligne du compte (`claimMatchCast`), que la suppression
 * tient en exclusif. L'état des matchs, lui, se lit sous leur verrou.
 *
 * Rend les matchs touchés et leurs tournois, que l'appelant prévient **après
 * le commit** — les instantanés ouverts montreraient sinon le caster, son lien
 * ou l'arbitre jusqu'à la prochaine écriture du match.
 */
export async function withdrawUserCasts(
  connection: Executor,
  userId: number,
  includeCompleted: boolean,
): Promise<MatchWithdrawal> {
  // Les quatre listes de départ en **une** lecture (`UNION ALL`, chaque table
  // seule par l'index du compte). Tous ses casts, quel que soit l'état du
  // match : celui-ci se juge **sous verrou** (un match rouvert entre cette
  // lecture et le verrou perd quand même son caster).
  const [startRows] = await connection.execute<(RowDataPacket & { kind: string; match_id: number })[]>(
    `SELECT 'C' AS kind, match_id FROM bg_match_casters WHERE user_id = ?
     UNION ALL SELECT 'L' AS kind, match_id FROM bg_match_streams WHERE link_user_id = ?
     UNION ALL SELECT 'R' AS kind, id AS match_id FROM bg_matches WHERE referee_user_id = ?
     UNION ALL SELECT 'T' AS kind, id AS match_id FROM bg_matches WHERE live_trigger_user_id = ?`,
    [userId, userId, userId, userId],
  );
  const listOf = (kind: string) => new Set(startRows.filter((row) => row.kind === kind).map((row) => Number(row.match_id)));
  const casts = listOf("C");
  const links = listOf("L");
  const refereed = listOf("R");
  // Tous les matchs dont il tient le mode d'antenne, quel que soit leur état :
  // la référence à son compte part avec lui (effacement), verrouillés avec les autres.
  const triggered = listOf("T");
  const candidates = [...new Set([...casts, ...links, ...refereed, ...triggered])].sort((a, b) => a - b);
  if (candidates.length === 0) {
    return { matchIds: [], tournamentIds: [], liveTournamentIds: [], releasedRefereeMatchIds: [], releasedCastMatchIds: [] };
  }

  const [locked] = await connection.execute<WithdrawnMatchRow[]>(
    `SELECT id, tournament_id, status FROM bg_matches WHERE id IN (${placeholders(candidates)}) ORDER BY id FOR UPDATE`,
    candidates,
  );
  const matchIds = locked.map((row) => Number(row.id));
  const castsToDrop = locked
    .filter((row) => casts.has(Number(row.id)) && (includeCompleted || row.status !== "COMPLETED"))
    .map((row) => Number(row.id));
  const linksToDrop = matchIds.filter((id) => links.has(id));
  const refereesToDrop = matchIds.filter((id) => refereed.has(id));

  if (castsToDrop.length > 0) {
    await connection.execute(
      `DELETE FROM bg_match_casters WHERE user_id = ? AND match_id IN (${placeholders(castsToDrop)})`,
      [userId, ...castsToDrop],
    );
  }
  // Un cast gardé sur un match joué (anonymisation) ne garde pas son BattleTag
  // de cast : il part avec le compte (`CAST_SETTINGS.md`). Après les verrous
  // des matchs (ordre match puis casters, comme partout) et sans condition
  // tirée de la lecture de départ : un match joué entre-temps est couvert.
  if (!includeCompleted) {
    await connection.execute(
      `UPDATE bg_match_casters SET cast_battletag = NULL WHERE user_id = ? AND cast_battletag IS NOT NULL`,
      [userId],
    );
  }
  if (linksToDrop.length > 0) {
    await connection.execute(
      `UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL
        WHERE link_user_id = ? AND match_id IN (${placeholders(linksToDrop)})`,
      [userId, ...linksToDrop],
    );
  }
  // Le mode d'antenne qu'il avait posé reste au match, sans maître : le staff,
  // l'arbitre et les casters du match le changent (`lib/shared/live-trigger-owner.ts`).
  const triggersToDrop = matchIds.filter((id) => triggered.has(id));
  if (triggersToDrop.length > 0) {
    await connection.execute(
      `UPDATE bg_matches SET live_trigger_user_id = NULL
        WHERE live_trigger_user_id = ? AND id IN (${placeholders(triggersToDrop)})`,
      [userId, ...triggersToDrop],
    );
  }
  if (refereesToDrop.length > 0) {
    await connection.execute(
      `UPDATE bg_matches SET referee_user_id = NULL, referee_ready_at = NULL
        WHERE referee_user_id = ? AND id IN (${placeholders(refereesToDrop)})`,
      [userId, ...refereesToDrop],
    );
  }
  const pruned = [...new Set([...castsToDrop, ...linksToDrop])].sort((a, b) => a - b);
  await pruneStreamsOf(connection, pruned);
  // Comme au départ volontaire (`releaseMatchCast`) : un match non joué resté
  // sans aucun stream n'est plus casté.
  await unmarkUncastMatches(connection, pruned);
  // Seuls les matchs réellement modifiés : un cast gardé sur un match joué
  // (anonymisation) n'en fait pas partie.
  const touched = new Set([...castsToDrop, ...linksToDrop, ...refereesToDrop, ...triggersToDrop]);
  const touchedRows = locked.filter((row) => touched.has(Number(row.id)));
  // Un match non joué qui attendait encore ce « Prêt » peut partir : l'appelant
  // le relance (`relaunchAfterRefereeWithdrawal`) sur ces listes lues sous verrou.
  const unplayed = new Set(locked.filter((row) => row.status !== "COMPLETED").map((row) => Number(row.id)));
  return {
    matchIds: touchedRows.map((row) => Number(row.id)),
    tournamentIds: [...new Set(touchedRows.map((row) => Number(row.tournament_id)))].sort((a, b) => a - b),
    liveTournamentIds: [
      ...new Set(touchedRows.filter((row) => row.status !== "COMPLETED").map((row) => Number(row.tournament_id))),
    ].sort((a, b) => a - b),
    releasedRefereeMatchIds: refereesToDrop.filter((id) => unplayed.has(id)),
    releasedCastMatchIds: castsToDrop.filter((id) => unplayed.has(id)),
  };
}

/**
 * Le match porte-t-il le **vrai** lien de l'organisation — celui du stream du
 * staff posé dans « Diffusion officielle », case « lien de l'organisation »
 * cochée (`link_user_id` nul) ? Ni la chaîne qu'un membre du staff y a posée
 * comme la sienne, ni un lien de stream de caster, même sans auteur connu
 * (décision du 2026-11-10, `organisationModeLocked`).
 */
export async function hasOrganisationLink(connection: Executor, matchId: number): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_streams
      WHERE match_id = ? AND staff_owned = 1 AND live_url IS NOT NULL AND link_user_id IS NULL LIMIT 1`,
    [matchId],
  );
  return rows.length > 0;
}

/** Qui a fourni le lien d'un stream (`null` = l'organisation), et s'il caste encore ce stream. */
export type StreamLinkHolder = { userId: number | null; casts: boolean };

/**
 * Le fournisseur du lien d'un stream (`link_user_id`) et sa présence parmi
 * les casters de ce stream, **en une lecture** (sous le verrou du match que
 * tient l'appelant). Seule lecture de cette règle : la configuration du staff
 * et la route du caster s'y fient toutes deux.
 */
export async function streamLinkHolder(connection: Executor, matchId: number, streamId: number): Promise<StreamLinkHolder> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT s.link_user_id,
            EXISTS (SELECT 1 FROM bg_match_casters mc
                     WHERE mc.match_id = ? AND mc.stream_id = s.id AND mc.user_id = s.link_user_id) AS holder_casts
       FROM bg_match_streams s WHERE s.id = ? LIMIT 1`,
    [matchId, streamId],
  );
  const raw = rows[0]?.link_user_id;
  return { userId: raw === null || raw === undefined ? null : Number(raw), casts: Number(rows[0]?.holder_casts ?? 0) === 1 };
}
