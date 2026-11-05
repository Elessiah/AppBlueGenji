/**
 * Diffusion en direct : écriture des liens et de l'antenne, résolution de la
 * cible du bouton « Regarder le live » de l'accueil.
 *
 * Toute la règle métier (validation d'URL, état de diffusion) vit dans le module
 * pur `lib/shared/live-streams.ts` ; ce fichier ne fait que l'appliquer à la
 * base et publier l'événement qui réveille les pages ouvertes. En particulier,
 * **aucune requête ne réimplémente `resolveMatchLiveState` en SQL** : on charge
 * les seuls matchs castés (leur nombre est marginal) et on filtre en mémoire
 * avec la fonction partagée, pour qu'il n'existe qu'une définition de « ce match
 * est à l'antenne ».
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import {
  canConfigureLive,
  isMatchCastable,
  isMatchLive,
  isMatchLiveTrigger,
  normalizeStreamUrl,
  parseStreamUrlInput,
  requiresMatchStartAt,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import { launchPairingKey } from "@/lib/shared/match-launch";
import {
  isMatchRefereeActor,
  liveTriggerOwnerAfter,
  mayChangeLiveTrigger,
  nullableUserId as nullableId,
  type LiveTriggerActor,
} from "@/lib/shared/live-trigger-owner";
import type { MatchStatus, TournamentGame } from "@/lib/shared/types";
import { loadRefereeStanding } from "./cast-eligibility";
import { retryOnDeadlock } from "./deadlock-retry";
import { playsMatchSql } from "./match-players";
import { lockMatchStreams, pruneMatchStreams, staffStream, type MatchStreamRow } from "./match-casters";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "./notifications";
import { invalidateSpectatorSnapshot } from "./snapshot";

/** Cible du bouton d'accueil : un tournoi en cours réellement à l'antenne. */
export type BroadcastingTournament = {
  tournamentId: number;
  url: string;
};

/** Configuration de diffusion d'un match, telle que soumise par le staff. */
export type MatchLiveConfig = {
  /** `null` = le match n'est plus casté. */
  trigger: MatchLiveTrigger | null;
  /** `null` = casté sans lien public (badge seul). */
  liveUrl: string | null;
  /**
   * Qui pose le réglage — **obligatoire** : un appelant qui l'oublierait
   * enregistrerait la chaîne d'un caster comme celle de l'organisation.
   */
  setter: MatchLiveSetter;
  /**
   * Ses droits sur le mode d'antenne (`mayChangeLiveTrigger`) : admin,
   * permission `tournaments`, et `live` — sans elle, l'appelant n'entre qu'en
   * arbitre désigné du match, ce qui se relit sous le verrou (`NOT_MATCH_REFEREE`).
   */
  access: Pick<LiveTriggerActor, "isAdmin" | "manages"> & { live: boolean };
  /**
   * Liens des streams **des casters**, que seul l'arbitre désigné du match
   * modifie ou efface (médiation, `docs/features/CAST_SETTINGS.md`) ; absent :
   * aucun n'est touché.
   */
  streamLinks?: readonly MatchStreamLinkEdit[];
};

/** Lien d'un stream de caster réglé par l'arbitre (`null` : effacé). */
export type MatchStreamLinkEdit = { streamId: number; liveUrl: string | null };

/**
 * L'auteur d'un réglage de diffusion (`MatchLiveConfig.setter`) et la
 * provenance du lien qu'il pose, **dite par lui** : jamais déduite de ce qu'il
 * caste (`docs/features/MATCH_LAUNCH.md` § Casters et streams).
 * - `asOrganisation` : le lien de l'organisation (`bg_match_streams.link_user_id`
 *   nul), qui reste au match quel que soit le sort du compte. Seule la
 *   permission `tournaments` peut le dire (la route le refuse aux autres) ;
 * - sinon, la chaîne de `userId` : le lien lui est rattaché et part avec son
 *   compte (`withdrawUserCasts`).
 */
export type MatchLiveSetter = {
  userId: number;
  asOrganisation: boolean;
};

type TournamentStateRow = RowDataPacket & { id: number; state: string };

type MatchLiveRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: MatchStatus;
  start_at: Date | string | null;
  live_trigger: MatchLiveTrigger | null;
  live_started_at: Date | string | null;
  live_trigger_user_id?: number | null;
  /** Arbitre désigné **retenu** (sans opposition sur un match à jouer), `null` sinon. */
  kept_referee_user_id?: number | null;
  team1_id: number | null;
  team2_id: number | null;
  launched_at: Date | string | null;
  launch_pairing: string | null;
};

type BroadcastRow = RowDataPacket & {
  tournament_id: number;
  live_url: string | null;
  status: MatchStatus;
  start_at: Date | string | null;
  live_trigger: MatchLiveTrigger | null;
  live_started_at: Date | string | null;
};

/**
 * Renseigne (ou efface) la chaîne officielle d'un tournoi.
 *
 * Réservé à la permission `tournaments` : la chaîne principale engage
 * l'organisation, contrairement au lien d'un match qu'un caster pose lui-même.
 *
 * @throws `TOURNAMENT_NOT_FOUND` | `INVALID_STREAM_URL`
 */
export async function setTournamentLiveUrl(
  tournamentId: number,
  rawUrl: string | null,
): Promise<string | null> {
  const db = await getDatabase();

  const [rows] = await db.execute<TournamentStateRow[]>(
    `SELECT id, state FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  if (rows.length === 0) throw new Error("TOURNAMENT_NOT_FOUND");

  // Une chaîne vide vaut effacement : le formulaire renvoie "" quand le staff
  // vide le champ, et exiger `null` là serait un piège.
  const url = parseStreamUrlInput(rawUrl);

  await db.execute(`UPDATE bg_tournaments SET live_url = ? WHERE id = ?`, [url, tournamentId]);
  // La page sans compte ne garde pas un lien de chaîne retiré ou corrigé par le
  // staff, copie (150 s) ni carte (10 s) : même éviction qu'une édition du tournoi.
  invalidateSpectatorSnapshot(tournamentId);
  publishUpdatedEvent(tournamentId);
  return url;
}

/** Charge un match avec ses seules colonnes de diffusion. */
async function loadMatchLiveRow(matchId: number): Promise<MatchLiveRow> {
  const db = await getDatabase();
  const [rows] = await db.execute<MatchLiveRow[]>(
    `SELECT id, tournament_id, status, start_at, live_trigger, live_started_at
     FROM bg_matches
     WHERE id = ?
     LIMIT 1`,
    [matchId],
  );
  if (rows.length === 0) throw new Error("MATCH_NOT_FOUND");
  return rows[0];
}

/**
 * `MATCH_NOT_CASTABLE` quand ce réglage ne peut plus être posé sur ce match
 * (`canConfigureLive`). Un match joué (ou en attente de confirmation) déjà
 * marqué ne reste ouvert que pour être **démarqué** (`trigger: null`) : y
 * changer le mode ou le lien remplacerait le lien d'un match joué — celui de
 * l'organisation compris — par la chaîne de qui le pose.
 */
function assertConfigurable(row: MatchLiveRow, trigger: MatchLiveTrigger | null): void {
  const match = {
    status: row.status,
    liveTrigger: row.live_trigger,
    liveStartedAt: row.live_started_at,
    launchedAt: null,
  };
  const configurable = trigger === null ? canConfigureLive(match) : isMatchCastable(match);
  if (!configurable) throw new Error("MATCH_NOT_CASTABLE");
}

/**
 * Marque un match comme casté (ou le démarque), avec son mode et sa chaîne.
 *
 * Deux effacements implicites, tous deux nécessaires pour que l'état dérivé
 * reste lisible :
 * - démarquer un match efface aussi sa chaîne et son antenne, sinon un match
 *   non casté garderait une ouverture d'antenne fantôme qui reprendrait effet à
 *   la moindre remise en `MANUAL` ;
 * - passer en `AUTO` ou `START_TIME` referme l'antenne, qui n'a plus de sens
 *   dans ces modes — leur frontière est le statut du match ou l'horloge.
 *
 * La chaîne réglée ici est celle du **stream du staff** (`staffStream`) ; un
 * stream qu'un caster a ouvert garde la sienne, que le staff n'écrase jamais.
 * Démarquer le match efface le lien du staff, et les streams que plus personne
 * ne tient disparaissent.
 *
 * Le mode `START_TIME` exige une date de début sur le match : l'accepter sans
 * date poserait une diffusion qui ne s'ouvrirait jamais, et l'échec ne se
 * verrait qu'à l'heure du match. La date, elle, reste effaçable ensuite — le
 * calendrier est du ressort du staff `tournaments`, pas de la diffusion.
 *
 * Un match qui ne peut plus passer à l'antenne (score saisi, en attente de
 * confirmation) et qui n'est pas déjà casté n'a rien à configurer
 * (`canConfigureLive`, appliqué ici et non seulement par l'interface) : un
 * appel direct ne pose pas un lien sur un match que l'écran garde fermé. Déjà
 * casté, il ne peut plus qu'être démarqué (`assertConfigurable`).
 *
 * @throws `MATCH_NOT_FOUND` | `INVALID_LIVE_TRIGGER` | `INVALID_STREAM_URL`
 *         | `MATCH_START_AT_REQUIRED` | `MATCH_NOT_CASTABLE`
 */
export async function setMatchLiveConfig(
  matchId: number,
  config: MatchLiveConfig,
): Promise<void> {
  if (config.trigger !== null && !isMatchLiveTrigger(config.trigger)) {
    throw new Error("INVALID_LIVE_TRIGGER");
  }

  // Premier tri sur une lecture ordinaire (un refus ne coûte rien) ; le verdict
  // vaut sous le verrou du match, ci-dessous : un score validé entre les deux
  // ferme la porte (`assertConfigurable`).
  const row = await loadMatchLiveRow(matchId);
  assertConfigurable(row, config.trigger);
  if (requiresMatchStartAt(config.trigger) && row.start_at === null) {
    throw new Error("MATCH_START_AT_REQUIRED");
  }

  const trigger = config.trigger;
  const url = parseStreamUrlInput(trigger === null ? null : config.liveUrl);

  // Les verrous d'intervalle des streams et des casters peuvent opposer deux
  // matchs voisins (inscription, ménage) : la transaction se rejoue.
  await retryOnDeadlock(() => withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      // Verrou du match d'abord, puis ses streams et casters : le même ordre
      // que l'inscription d'un caster (`claimMatchCast`).
      const [locked] = await connection.execute<MatchLiveRow[]>(
        `SELECT id, tournament_id, status, start_at, live_trigger, live_started_at, live_trigger_user_id,
           ${KEPT_REFEREE_SQL} AS kept_referee_user_id
         FROM bg_matches WHERE id = ? FOR UPDATE`,
        [matchId],
      );
      if (locked.length === 0) throw new Error("MATCH_NOT_FOUND");
      const current = locked[0];
      const actor: LiveTriggerActor = {
        userId: config.setter.userId,
        isAdmin: config.access.isAdmin,
        manages: config.access.manages,
      };
      // L'arbitre qui se réclame du match doit encore pouvoir arbitrer.
      if (
        actor.manages &&
        nullableId(current.kept_referee_user_id) === actor.userId &&
        !(await refereeQualifies(connection, actor.userId, Number(current.tournament_id)))
      ) {
        current.kept_referee_user_id = null;
      }
      const triggerChanges = assertLiveConfigAllowed(current, actor, trigger, {
        editsStreamLinks: config.streamLinks !== undefined,
        live: config.access.live,
      });
      assertConfigurable(current, trigger);
      // Rejugé lui aussi : une date de début retirée entre les deux lectures
      // poserait une antenne à l'heure dite qui ne s'ouvrirait jamais.
      if (requiresMatchStartAt(trigger) && locked[0].start_at === null) {
        throw new Error("MATCH_START_AT_REQUIRED");
      }
      let streams: MatchStreamRow[] | undefined;
      // Les liens des casters d'abord : le lien du staff qui suit habille un
      // stream sans lien, jamais celui qu'un caster vient de recevoir ici.
      if (config.streamLinks !== undefined && config.streamLinks.length > 0) {
        streams = await setCasterStreamLinks(connection, matchId, config.streamLinks);
      }
      if (trigger === null) {
        await connection.execute(
          `UPDATE bg_matches SET live_trigger = NULL, live_trigger_user_id = NULL, live_started_at = NULL WHERE id = ?`,
          [matchId],
        );
        await connection.execute(
          `UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE match_id = ? AND staff_owned = 1`,
          [matchId],
        );
        streams = streams?.map((stream) => (stream.staff ? { ...stream, liveUrl: null } : stream));
      } else {
        if (triggerChanges) {
          // Posé par un caster du match, le mode est le sien ; par le staff,
          // l'arbitre ou un admin qui ne le caste pas, il reste au staff.
          const owner = liveTriggerOwnerAfter(trigger, actor, await castsMatch(connection, matchId, actor.userId));
          await connection.execute(
            trigger === "MANUAL"
              ? `UPDATE bg_matches SET live_trigger = ?, live_trigger_user_id = ? WHERE id = ?`
              : `UPDATE bg_matches SET live_trigger = ?, live_trigger_user_id = ?, live_started_at = NULL WHERE id = ?`,
            [trigger, owner, matchId],
          );
        }
        // Un stream de caster dont l'arbitre vient d'effacer le lien reste au
        // caster : le lien du staff ne s'y pose pas.
        const edited = new Set((config.streamLinks ?? []).map((link) => link.streamId));
        streams = await setStaffStreamUrl(connection, matchId, url, config.setter, streams, edited);
      }
      // Les streams déjà lus sous verrou (et mis à jour en mémoire) ne sont pas
      // relus : deux lectures verrouillantes, non quatre.
      await pruneMatchStreams(connection, matchId, { streams });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }));

  publishMatchUpdatedEvent(Number(row.tournament_id), { landingLive: true });
}

/**
 * Pose (ou efface) le lien du stream du staff (`staffStream`). Sans lui, un
 * lien habille le premier stream sans lien, qui devient celui du staff — ou en
 * ouvre un : le lien du staff n'attend pas qu'un caster s'inscrive. Effacer le
 * lien ne prend jamais un stream de caster.
 *
 * Chaque lien posé est rattaché à ce que dit le réglage (`linkProvider`) : le
 * compte de l'auteur, ou `NULL` pour l'organisation. Un lien inchangé n'est
 * pas réécrit : il reste à qui l'a fourni — un réglage réenregistré (mode
 * changé, même lien) ne le prend ni à un caster, ni à l'organisation.
 *
 * Rend les streams du match **tels qu'ils sont après l'écriture**, pour le
 * ménage qui suit.
 */
async function setStaffStreamUrl(
  connection: PoolConnection,
  matchId: number,
  url: string | null,
  setter: MatchLiveSetter,
  known?: MatchStreamRow[],
  casterOwned: ReadonlySet<number> = new Set(),
): Promise<MatchStreamRow[]> {
  const streams = known ?? (await lockMatchStreams(connection, matchId));
  const target = staffStream(streams.filter((stream) => stream.staff || !casterOwned.has(stream.id)));
  if (target !== null && (target.staff || url !== null)) {
    if (target.liveUrl === url && target.staff) return streams;
    await connection.execute(
      `UPDATE bg_match_streams SET live_url = ?, staff_owned = 1, link_user_id = ? WHERE id = ?`,
      [url, url === null ? null : linkProvider(setter), target.id],
    );
    return streams.map((stream) => (stream.id === target.id ? { ...stream, liveUrl: url, staff: true } : stream));
  }
  if (url === null) return streams;
  const [created] = await connection.execute<ResultSetHeader>(
    `INSERT INTO bg_match_streams (match_id, live_url, staff_owned, link_user_id) VALUES (?, ?, 1, ?)`,
    [matchId, url, linkProvider(setter)],
  );
  return [...streams, { id: Number(created.insertId), matchId, liveUrl: url, staff: true }];
}

/**
 * L'arbitre désigné **retenu** du match, en SQL : sans opposition retenue sur
 * un match à jouer (un match joué garde son arbitre, comme l'instantané), et
 * jamais un compte qui joue le match. Sa condition d'arbitrage (`refereeQualifies`)
 * se relit à part.
 */
const KEPT_REFEREE_SQL = `CASE
  WHEN (bg_matches.status = 'COMPLETED'
    OR NOT EXISTS (SELECT 1 FROM bg_users ru WHERE ru.id = bg_matches.referee_user_id AND ru.referee_objection_at IS NOT NULL))
    AND NOT ${playsMatchSql("bg_matches.referee_user_id", "bg_matches.team1_id", "bg_matches.team2_id", "kr")}
  THEN bg_matches.referee_user_id ELSE NULL END`;

/**
 * L'arbitre retenu remplit-il encore la condition d'arbitrage du jeu du
 * tournoi (`loadRefereeStanding`) ? Un arbitre devenu inéligible ne règle
 * plus la diffusion, comme il ne mène plus la partie.
 */
async function refereeQualifies(
  executor: Pick<PoolConnection, "execute">,
  refereeId: number,
  tournamentId: number,
): Promise<boolean> {
  const [rows] = await executor.execute<(RowDataPacket & { game: TournamentGame })[]>(
    `SELECT game FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  if (rows.length === 0) return false;
  const standing = await loadRefereeStanding(executor, refereeId, rows[0].game);
  return standing.block === null && !standing.objection;
}

/** `userId` caste-t-il ce match ? Lu sous le verrou du match que tient l'appelant. */
async function castsMatch(connection: PoolConnection, matchId: number, userId: number): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_casters WHERE match_id = ? AND user_id = ? LIMIT 1`,
    [matchId, userId],
  );
  return rows.length > 0;
}

/**
 * L'arbitre désigné du match est-il ce compte ? Lecture ordinaire, pour la
 * porte des routes de diffusion (le verdict qui compte se relit sous verrou).
 * `manages` : la permission `tournaments` de l'appelant (`can`), condition de
 * l'arbitrage.
 */
export async function isDesignatedMatchReferee(matchId: number, userId: number, manages: boolean): Promise<boolean> {
  if (!manages) return false;
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { kept: number | null; tournament_id: number })[]>(
    `SELECT ${KEPT_REFEREE_SQL} AS kept, tournament_id FROM bg_matches WHERE id = ? LIMIT 1`,
    [matchId],
  );
  if (rows.length === 0 || nullableId(rows[0].kept) !== userId) return false;
  return refereeQualifies(db, userId, Number(rows[0].tournament_id));
}

/**
 * Qui règle quoi, sous le verrou du match : le mode d'antenne déjà posé par
 * un autre ne change pas (`LIVE_TRIGGER_NOT_OWNED`) — seuls son caster,
 * l'arbitre désigné et un admin le changent ou le retirent —, et seul
 * l'arbitre désigné touche aux liens des casters (`NOT_MATCH_REFEREE`). Sans
 * `live`, l'appelant n'a passé la porte qu'en arbitre de ce match : il doit
 * l'être encore (désignation changée entre la porte et le verrou).
 * Rend vrai si le mode change.
 */
function assertLiveConfigAllowed(
  current: MatchLiveRow,
  actor: LiveTriggerActor,
  trigger: MatchLiveTrigger | null,
  { editsStreamLinks, live }: { editsStreamLinks: boolean; live: boolean },
): boolean {
  const hold = {
    trigger: current.live_trigger ?? null,
    ownerId: nullableId(current.live_trigger_user_id),
    refereeId: nullableId(current.kept_referee_user_id),
  };
  if (!live && !isMatchRefereeActor(hold, actor)) throw new Error("NOT_MATCH_REFEREE");
  const triggerChanges = trigger !== hold.trigger;
  if (triggerChanges && !mayChangeLiveTrigger(hold, actor)) throw new Error("LIVE_TRIGGER_NOT_OWNED");
  if (editsStreamLinks && !isMatchRefereeActor(hold, actor)) throw new Error("NOT_MATCH_REFEREE");
  return triggerChanges;
}

/**
 * Médiation de l'arbitre : pose ou efface le lien des streams **des casters**
 * (jamais celui du staff, réglé par `setStaffStreamUrl`). Un lien posé garde
 * son rattachement (le caster qui l'a fourni) ; effacé, il n'est plus à
 * personne. Un lien inchangé n'est pas réécrit.
 *
 * @throws `STREAM_NOT_FOUND` | `INVALID_STREAM_URL`
 */
async function setCasterStreamLinks(
  connection: PoolConnection,
  matchId: number,
  links: readonly MatchStreamLinkEdit[],
): Promise<MatchStreamRow[]> {
  let streams = await lockMatchStreams(connection, matchId);
  for (const link of links) {
    const target = streams.find((stream) => stream.id === link.streamId && !stream.staff);
    if (!target) throw new Error("STREAM_NOT_FOUND");
    const url = parseStreamUrlInput(link.liveUrl);
    if (target.liveUrl === url) continue;
    await connection.execute(
      url === null
        ? `UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE id = ? AND match_id = ? AND staff_owned = 0`
        : `UPDATE bg_match_streams SET live_url = ? WHERE id = ? AND match_id = ? AND staff_owned = 0`,
      url === null ? [target.id, matchId] : [url, target.id, matchId],
    );
    streams = streams.map((stream) => (stream.id === target.id ? { ...stream, liveUrl: url } : stream));
  }
  return streams;
}

/**
 * Le compte auquel rattacher le lien que pose `setter` : aucun s'il le dit de
 * l'organisation, le sien sinon. **Rien n'est déduit** de ce qu'il caste :
 * qu'un membre de l'organisation caste le match ne dit pas de quelle chaîne
 * il parle — c'est la case « lien de l'organisation » de la fenêtre.
 */
function linkProvider(setter: MatchLiveSetter): number | null {
  return setter.asOrganisation ? null : setter.userId;
}

/**
 * Ouvre ou ferme l'antenne d'un match en mode `MANUAL`.
 *
 * Il n'y a rien à basculer en `AUTO` (l'état ne dépend que du statut du match)
 * ni sur un match qui n'est pas jouable ou dont le score est déjà saisi — dans
 * ces cas la fermeture est déjà acquise par dérivation.
 *
 * @returns `true` quand l'antenne a changé d'état — un second clic sur « à
 *   l'antenne » ne change rien, et le journal du staff ne le note pas.
 * @throws `MATCH_NOT_FOUND` | `LIVE_TRIGGER_NOT_MANUAL` | `MATCH_NOT_LIVE_READY`
 */
export async function setMatchOnAir(matchId: number, onAir: boolean): Promise<boolean> {
  const row = await loadMatchLiveRow(matchId);

  if (row.live_trigger !== "MANUAL") throw new Error("LIVE_TRIGGER_NOT_MANUAL");
  if (onAir && row.status !== "READY") throw new Error("MATCH_NOT_LIVE_READY");

  const db = await getDatabase();
  // L'état de départ est relu dans la condition : un second clic ne réécrit pas
  // l'heure de mise à l'antenne, et deux clics simultanés ne changent l'état qu'une fois ;
  // le statut et le déclencheur aussi : un match validé, ou passé en automatique, entre la
  // lecture et l'écriture ne change pas d'antenne.
  const [result] = await db.execute(
    onAir
      ? `UPDATE bg_matches SET live_started_at = ?
         WHERE id = ? AND live_started_at IS NULL AND status = 'READY' AND live_trigger = 'MANUAL'`
      : `UPDATE bg_matches SET live_started_at = NULL
         WHERE id = ? AND live_started_at IS NOT NULL AND live_trigger = 'MANUAL'`,
    onAir ? [new Date(), matchId] : [matchId],
  );
  const changed = Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
  if (!changed) {
    // Rien d'écrit : antenne déjà dans cet état, ou garde tombée entre la lecture
    // et l'écriture — celle-ci se dit par son refus, jamais par un faux succès.
    const now = await loadMatchLiveRow(matchId);
    if (now.live_trigger !== "MANUAL") throw new Error("LIVE_TRIGGER_NOT_MANUAL");
    if (onAir && now.status !== "READY") throw new Error("MATCH_NOT_LIVE_READY");
    return false;
  }

  publishMatchUpdatedEvent(Number(row.tournament_id), { landingLive: true });
  return true;
}

/**
 * Tournoi en cours réellement à l'antenne, ou `null`.
 *
 * Trois conditions cumulées : le tournoi est `RUNNING`, il porte une chaîne
 * officielle exploitable, et au moins un de ses matchs est en direct. C'est
 * exactement la condition d'apparition du bouton d'accueil : un visiteur qui
 * clique tombe donc toujours sur une diffusion active.
 *
 * En cas d'égalité, on retient le tournoi au `start_at` le plus récent — le même
 * ordre que `listTournamentBuckets`, pour que le bouton et la carte live de
 * l'accueil désignent le même tournoi.
 */
export async function findBroadcastingTournament(): Promise<BroadcastingTournament | null> {
  const db = await getDatabase();

  const [rows] = await db.execute<BroadcastRow[]>(
    `SELECT
      t.id AS tournament_id,
      t.live_url,
      m.status,
      m.start_at,
      m.live_trigger,
      m.live_started_at,
      m.team1_id,
      m.team2_id,
      m.launched_at,
      m.launch_pairing
     FROM bg_tournaments t
     JOIN bg_matches m ON m.tournament_id = t.id
     WHERE t.state = 'RUNNING'
       AND t.live_url IS NOT NULL
       AND m.live_trigger IS NOT NULL
     ORDER BY t.start_at DESC, t.id DESC`,
  );

  for (const row of rows) {
    const live = isMatchLive({
      status: row.status,
      liveTrigger: row.live_trigger,
      liveStartedAt: row.live_started_at,
      startAt: row.start_at,
      // Un lancement posé pour une autre paire d'engagés ne compte pas
      // (`currentLaunchState`).
      launchedAt:
        row.launch_pairing !== null && row.launch_pairing === launchPairingKey(row.team1_id, row.team2_id)
          ? row.launched_at
          : null,
    });
    if (!live) continue;

    // Revalidé à la lecture : une ligne posée avant la liste blanche (ou éditée
    // à la main en base) ne doit pas devenir un `href` sur la page d'accueil.
    const url = normalizeStreamUrl(row.live_url);
    if (!url) continue;

    return { tournamentId: Number(row.tournament_id), url };
  }

  return null;
}
