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
import { castBeforeLaunch, launchPairingKey } from "@/lib/shared/match-launch";
import {
  isMatchRefereeActor,
  liveTriggerOwnerAfter,
  mayChangeLiveTrigger,
  mayToggleOnAir,
  type LiveTriggerActor,
  type LiveTriggerHold,
} from "@/lib/shared/live-trigger-owner";
import { nullableId } from "@/lib/shared/nullable-id";
import type { MatchStatus, TournamentGame } from "@/lib/shared/types";
import { loadRefereeStanding, loadShownCasterIds } from "./cast-eligibility";
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
  /** `null` = le match n'est plus casté ; `undefined` = mode inchangé. */
  trigger: MatchLiveTrigger | null | undefined;
  /** `null` = casté sans lien public (badge seul) ; `undefined` = lien du staff inchangé. */
  liveUrl: string | null | undefined;
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
  access: MatchLiveAccess;
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
  launched_at?: Date | string | null;
  launch_pairing?: string | null;
  team1_id?: number | null;
  team2_id?: number | null;
  referee_user_id?: number | null;
};

/** Ce que le verrou d'un réglage de diffusion établit (`lockLiveMatch`). */
type LockedLiveMatch = {
  row: MatchLiveRow;
  game: TournamentGame;
  /** Qui tient le mode, tel que la règle le juge (`lib/shared/live-trigger-owner.ts`). */
  hold: LiveTriggerHold;
  /** L'auteur du geste est-il un caster montré du match (`loadShownCasterIds`) ? */
  actorShown: boolean;
};

/** Ce qu'un appelant des gestes de diffusion établit de ses droits. */
export type MatchLiveAccess = Pick<LiveTriggerActor, "isAdmin" | "manages"> & { live: boolean };

/**
 * Résultat d'un réglage. `previousTrigger` : le mode d'avant ; `changed` : la requête a-t-elle écrit
 * quelque chose (mode, lien du staff, lien d'un caster) — un réglage
 * réenregistré tel quel ne s'annonce pas au journal du staff.
 */
export type MatchLiveOutcome = { previousTrigger: MatchLiveTrigger | null; changed: boolean };

/**
 * Refus d'un lien de stream de caster, qui dit **quel** stream (`streamId`) :
 * la fenêtre rattache le refus à son champ (`useFieldErrors`).
 */
export class StreamLinkError extends Error {
  constructor(
    code: "STREAM_NOT_FOUND" | "INVALID_STREAM_URL",
    readonly streamId: number,
  ) {
    super(code);
    this.name = "StreamLinkError";
  }
}

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
 * Rend le mode d'avant et si quelque chose a été écrit (`MatchLiveOutcome`) :
 * le journal ne dit « retiré » que d'un mode qui l'était vraiment, et rien
 * d'un réglage réenregistré tel quel.
 *
 * @throws `MATCH_NOT_FOUND` | `INVALID_LIVE_TRIGGER` | `INVALID_STREAM_URL`
 *         | `MATCH_START_AT_REQUIRED` | `MATCH_NOT_CASTABLE` | `NOT_MATCH_REFEREE`
 *         | `LIVE_TRIGGER_NOT_OWNED` | `STREAM_NOT_FOUND` (`StreamLinkError`)
 */
export async function setMatchLiveConfig(
  matchId: number,
  config: MatchLiveConfig,
): Promise<MatchLiveOutcome> {
  if (config.trigger !== null && config.trigger !== undefined && !isMatchLiveTrigger(config.trigger)) {
    throw new Error("INVALID_LIVE_TRIGGER");
  }

  // Premier tri sur une lecture ordinaire (un refus ne coûte rien) ; le verdict
  // vaut sous le verrou du match, ci-dessous : un score validé entre les deux
  // ferme la porte (`assertConfigurable`). Un mode absent (`undefined`) reste
  // celui du match, relu sous le verrou.
  const row = await loadMatchLiveRow(matchId);
  const requested = config.trigger === undefined ? (row.live_trigger ?? null) : config.trigger;
  assertConfigurable(row, requested);
  // Un mode inchangé (renvoyé tel quel par une fenêtre où il est verrouillé)
  // ne redemande pas sa date : retirée depuis par le staff, elle bloquerait
  // le lien du staff et ceux des casters.
  if (requested !== (row.live_trigger ?? null) && requiresMatchStartAt(requested) && row.start_at === null) {
    throw new Error("MATCH_START_AT_REQUIRED");
  }

  // Lien absent : le lien du staff n'est pas touché (sauf démarquage).
  const keepStaffLink = config.liveUrl === undefined;
  const editsStreamLinks = (config.streamLinks?.length ?? 0) > 0;
  // Lu d'abord sur le mode demandé (un refus ne coûte rien), puis rejugé sous
  // le verrou sur le mode appliqué : un mode posé entre les deux lectures ne
  // fait pas perdre le lien envoyé.
  parseStreamUrlInput(requested === null ? null : (config.liveUrl ?? null));
  const actor: LiveTriggerActor = {
    userId: config.setter.userId,
    isAdmin: config.access.isAdmin,
    manages: config.access.manages,
  };

  // Les verrous d'intervalle des streams et des casters peuvent opposer deux
  // matchs voisins (inscription, ménage) : la transaction se rejoue.
  const outcome = await retryOnDeadlock(() => withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      // Verrou du match d'abord, puis ses streams et casters : le même ordre
      // que l'inscription d'un caster (`claimMatchCast`).
      const { row: current, hold, actorShown } = await lockLiveMatch(connection, matchId, actor);
      const trigger = config.trigger === undefined ? hold.trigger : config.trigger;
      const url = parseStreamUrlInput(trigger === null ? null : (config.liveUrl ?? null));
      const triggerChanges = assertLiveConfigAllowed(current, hold, actor, trigger, {
        editsStreamLinks,
        live: config.access.live,
        actorShown,
      });
      // Rejugé lui aussi : une date de début retirée entre les deux lectures
      // poserait une antenne à l'heure dite qui ne s'ouvrirait jamais.
      if (triggerChanges && requiresMatchStartAt(trigger) && current.start_at === null) {
        throw new Error("MATCH_START_AT_REQUIRED");
      }
      let streams: MatchStreamRow[] | undefined;
      // Une écriture de lien rend une nouvelle liste : la même, rien d'écrit.
      let changed = triggerChanges;
      // Les liens des casters d'abord : le lien du staff qui suit habille un
      // stream sans lien, jamais celui qu'un caster vient de recevoir ici.
      if (editsStreamLinks && config.streamLinks !== undefined) {
        const locked = await lockMatchStreams(connection, matchId);
        streams = await setCasterStreamLinks(connection, matchId, config.streamLinks, locked);
        changed = changed || streams !== locked;
      }
      if (trigger === null && hold.trigger === null) {
        // Match sans mode : l'arbitre n'y corrige que les liens des casters —
        // rien à démarquer (ni mode, ni lien du staff, sans mode lui non plus).
      } else if (trigger === null) {
        await unmarkLive(connection, matchId, hold, actor);
        streams = streams?.map((stream) => (stream.staff ? { ...stream, liveUrl: null } : stream));
      } else {
        if (triggerChanges) {
          // Posé par un caster montré du match, le mode est le sien ; par le
          // staff, l'arbitre ou un admin qui ne le caste pas (ou un caster tu),
          // il garde son maître montré, ou reste au staff.
          await writeLiveTrigger(connection, matchId, trigger, liveTriggerOwnerAfter(trigger, actor, actorShown, hold.ownerId));
        }
        const staff = keepStaffLink
          ? null
          : await writeStaffLink(connection, matchId, url, config, streams, hold, actor);
        streams = staff?.streams ?? streams;
        changed = changed || staff?.written === true;
      }
      // Les streams déjà lus sous verrou (et mis à jour en mémoire) ne sont pas
      // relus : deux lectures verrouillantes, non quatre.
      await pruneMatchStreams(connection, matchId, { streams });
      await connection.commit();
      return { previousTrigger: hold.trigger, changed };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }));

  // Rien d'écrit : aucun instantané à rebâtir ni à pousser.
  if (outcome.changed) publishMatchUpdatedEvent(Number(row.tournament_id), { landingLive: true });
  return outcome;
}

/**
 * Démarque le match : mode, maître et antenne, puis le lien de l'organisation.
 * Démarquer efface ce lien : un porteur de la seule `live` ne le fait que sur
 * **son** mode (il en est le maître) ; sur celui du staff, il n'y touche pas plus
 * qu'en le réécrivant (`writeStaffLink`, `STAFF_STREAM_FORBIDDEN`).
 */
async function unmarkLive(
  connection: PoolConnection,
  matchId: number,
  hold: LiveTriggerHold,
  actor: LiveTriggerActor,
): Promise<void> {
  const staffSide = actor.manages || actor.isAdmin || isMatchRefereeActor(hold, actor);
  if (!staffSide && hold.ownerId !== actor.userId && (await hasStaffLink(connection, matchId))) {
    throw new Error("STAFF_STREAM_FORBIDDEN");
  }
  await connection.execute(
    `UPDATE bg_matches SET live_trigger = NULL, live_trigger_user_id = NULL, live_started_at = NULL WHERE id = ?`,
    [matchId],
  );
  await connection.execute(
    `UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE match_id = ? AND staff_owned = 1`,
    [matchId],
  );
}

/** Le stream de l'organisation porte-t-il un lien (que le démarquage effacerait) ? */
async function hasStaffLink(connection: PoolConnection, matchId: number): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_streams WHERE match_id = ? AND staff_owned = 1 AND live_url IS NOT NULL LIMIT 1`,
    [matchId],
  );
  return rows.length > 0;
}

/** Écrit le mode posé et son maître ; un mode qui n'est plus manuel referme l'antenne. */
async function writeLiveTrigger(
  connection: PoolConnection,
  matchId: number,
  trigger: MatchLiveTrigger,
  owner: number | null,
): Promise<void> {
  await connection.execute(
    trigger === "MANUAL"
      ? `UPDATE bg_matches SET live_trigger = ?, live_trigger_user_id = ? WHERE id = ?`
      : `UPDATE bg_matches SET live_trigger = ?, live_trigger_user_id = ?, live_started_at = NULL WHERE id = ?`,
    [trigger, owner, matchId],
  );
}

/**
 * Pose le lien du staff (`setStaffStreamUrl`) sur les streams déjà lus sous
 * verrou (`known`) ou relus ici. Un stream de caster dont l'arbitre vient
 * d'effacer le lien reste au caster : le lien du staff ne s'y pose pas. Le
 * lien suit le mode : celui d'un autre caster montré ne se change que par lui,
 * l'arbitre retenu ou un admin (décision 2) — un lien renvoyé tel quel
 * n'écrit rien et passe. Le stream du staff n'est le cast de personne : un
 * porteur de la seule `live` (ni staff, ni admin, ni arbitre) ne le touche
 * pas (`STAFF_STREAM_FORBIDDEN`, décision du 2026-11-05) — son lien à lui se
 * règle dans « Configurer ma diffusion ».
 *
 * @throws `LIVE_TRIGGER_NOT_OWNED` | `STAFF_STREAM_FORBIDDEN`
 */
async function writeStaffLink(
  connection: PoolConnection,
  matchId: number,
  url: string | null,
  config: MatchLiveConfig,
  known: MatchStreamRow[] | undefined,
  hold: LiveTriggerHold,
  actor: LiveTriggerActor,
): Promise<{ streams: MatchStreamRow[]; written: boolean }> {
  const edited = new Set((config.streamLinks ?? []).map((link) => link.streamId));
  const before = known ?? (await lockMatchStreams(connection, matchId));
  const streams = await setStaffStreamUrl(connection, matchId, url, config.setter, before, edited);
  const written = streams !== before;
  if (written && !actor.manages && !actor.isAdmin && !isMatchRefereeActor(hold, actor)) {
    throw new Error("STAFF_STREAM_FORBIDDEN");
  }
  if (written && hold.ownerId !== null && !mayChangeLiveTrigger(hold, actor)) {
    throw new Error("LIVE_TRIGGER_NOT_OWNED");
  }
  return { streams, written };
}

/**
 * Verrouille la ligne du match — **seule**, sans jointure ni sous-requête : la
 * production tourne sous MariaDB, et les sous-requêtes d'une lecture
 * verrouillante y pourraient verrouiller les tables lues — puis lit, d'une
 * lecture ordinaire faite **après** le verrou (donc à jour), le jeu du tournoi
 * et l'arbitre retenu, et juge qui tient le mode :
 * - le propriétaire n'en est un que s'il caste encore le match **en caster
 *   montré** (`loadShownCasterIds`) — l'interface, qui ne nomme que lui
 *   (`liveTriggerCasterId`), juge le même ; un caster tu ou parti laisse le
 *   mode au staff, sans attendre qu'un chemin de retrait efface la colonne ;
 * - l'arbitre n'est retenu que pour l'acteur qui se réclame de lui et remplit
 *   encore la condition d'arbitrage (`refereeQualifies`).
 */
async function lockLiveMatch(
  connection: PoolConnection,
  matchId: number,
  actor: LiveTriggerActor,
): Promise<LockedLiveMatch> {
  const [locked] = await connection.execute<MatchLiveRow[]>(
    `SELECT id, tournament_id, status, start_at, live_trigger, live_started_at, live_trigger_user_id, launched_at,
            launch_pairing, team1_id, team2_id, referee_user_id
     FROM bg_matches WHERE id = ? FOR UPDATE`,
    [matchId],
  );
  if (locked.length === 0) throw new Error("MATCH_NOT_FOUND");
  const row = locked[0];
  // Sans `tournaments`, ou s'il n'est pas l'arbitre désigné, l'acteur n'arbitre
  // pas ce match : le jeu seul se lit, sans les sous-requêtes de l'arbitre.
  const designated = actor.manages && nullableId(row.referee_user_id ?? null) === actor.userId;
  const kept = await loadKeptReferee(connection, matchId, designated);
  if (kept === null) throw new Error("MATCH_NOT_FOUND");
  const trigger = row.live_trigger ?? null;
  const ownerId = trigger === null ? null : nullableId(row.live_trigger_user_id);
  // Le maître et l'auteur en une lecture : qui tient le mode, et qui le tiendra.
  const shown = await loadShownCasterIds(connection, matchId, [ownerId, actor.userId], kept.game, castBeforeLaunch(row));
  const refereeId =
    actor.manages && kept.refereeId === actor.userId && (await refereeQualifies(connection, actor.userId, kept.game))
      ? actor.userId
      : null;
  return {
    row,
    game: kept.game,
    hold: { trigger, ownerId: ownerId !== null && shown.has(ownerId) ? ownerId : null, refereeId },
    actorShown: shown.has(actor.userId),
  };
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
 * ménage qui suit — la liste reçue elle-même si rien n'est écrit.
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
 * L'arbitre désigné **retenu** du match, en SQL, pour la médiation de la
 * diffusion : sur un match à jouer seulement (`PENDING`/`READY`, comme
 * l'interface, `showsRefereeName` — un score déclaré clôt la médiation) et —
 * avant le lancement — jamais un compte qui joue le
 * match : la règle de l'instantané (`refereeKept`) et du verrou du lancement
 * (`lockLaunchMatch`), une fois le match lancé, garde son arbitre. Sa condition
 * d'arbitrage et son opposition retenue (`refereeQualifies`, qui tolère une
 * base sans la colonne de l'opposition) se relisent à part.
 */
const KEPT_REFEREE_SQL = `CASE
  WHEN m.status IN ('PENDING', 'READY')
    AND ((m.launched_at IS NOT NULL AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id))
      OR NOT ${playsMatchSql("m.referee_user_id", "m.team1_id", "m.team2_id", "kr")})
  THEN m.referee_user_id ELSE NULL END`;

/**
 * Le jeu du tournoi et l'arbitre retenu du match (`KEPT_REFEREE_SQL`), en une
 * lecture **ordinaire** (jamais verrouillante : elle lit d'autres tables).
 * `null` : match ou tournoi introuvable. `withReferee` faux : le jeu seul, sans
 * les sous-requêtes de l'arbitre (`refereeId` toujours `null`).
 */
async function loadKeptReferee(
  executor: Pick<PoolConnection, "execute">,
  matchId: number,
  withReferee = true,
): Promise<{ game: TournamentGame; refereeId: number | null } | null> {
  const [rows] = await executor.execute<(RowDataPacket & { game: TournamentGame; kept: number | null })[]>(
    `SELECT t.game, ${withReferee ? KEPT_REFEREE_SQL : "NULL"} AS kept
     FROM bg_matches m JOIN bg_tournaments t ON t.id = m.tournament_id
     WHERE m.id = ? LIMIT 1`,
    [matchId],
  );
  if (rows.length === 0) return null;
  return { game: rows[0].game, refereeId: nullableId(rows[0].kept) };
}

/**
 * L'arbitre retenu remplit-il encore la condition d'arbitrage du jeu du
 * tournoi (`loadRefereeStanding`) ? Un arbitre devenu inéligible ne règle
 * plus la diffusion, comme il ne mène plus la partie.
 */
async function refereeQualifies(
  executor: Pick<PoolConnection, "execute">,
  refereeId: number,
  game: TournamentGame,
): Promise<boolean> {
  const standing = await loadRefereeStanding(executor, refereeId, game);
  return standing.block === null && !standing.objection;
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
  const kept = await loadKeptReferee(db, matchId);
  if (kept?.refereeId !== userId) return false;
  return refereeQualifies(db, userId, kept.game);
}

/**
 * Qui règle quoi, sous le verrou du match. Sans `live`, l'appelant n'a passé
 * la porte qu'en arbitre de ce match : il doit l'être encore (désignation
 * changée entre la porte et le verrou, `NOT_MATCH_REFEREE`). Puis le match
 * doit accepter ce réglage (`MATCH_NOT_CASTABLE`, jugé avant la propriété : un
 * match fermé l'est pour tous). Le mode d'antenne déjà posé par un autre ne
 * change pas (`LIVE_TRIGGER_NOT_OWNED`) — seuls son caster, l'arbitre désigné
 * et un admin le changent ou le retirent —, et seul l'arbitre désigné touche
 * aux liens des casters (`NOT_MATCH_REFEREE`). Un porteur de la seule `live`
 * (ni staff `tournaments`, ni admin, ni arbitre) ne règle que **son** cast :
 * sans caster le match (en caster montré), il n'y règle rien
 * (`NOT_MATCH_CASTER`, décision du 2026-11-05).
 * Rend vrai si le mode change.
 */
function assertLiveConfigAllowed(
  current: MatchLiveRow,
  hold: LiveTriggerHold,
  actor: LiveTriggerActor,
  trigger: MatchLiveTrigger | null,
  { editsStreamLinks, live, actorShown }: { editsStreamLinks: boolean; live: boolean; actorShown: boolean },
): boolean {
  const referee = isMatchRefereeActor(hold, actor);
  if (!live && !referee) throw new Error("NOT_MATCH_REFEREE");
  if (!referee && !actor.manages && !actor.isAdmin && !actorShown) throw new Error("NOT_MATCH_CASTER");
  assertConfigurable(current, trigger);
  const triggerChanges = trigger !== hold.trigger;
  if (triggerChanges && !mayChangeLiveTrigger(hold, actor, actorShown)) throw new Error("LIVE_TRIGGER_NOT_OWNED");
  if (editsStreamLinks && !referee) throw new Error("NOT_MATCH_REFEREE");
  return triggerChanges;
}

/**
 * Médiation de l'arbitre : pose ou efface le lien des streams **des casters**
 * (jamais celui du staff, réglé par `setStaffStreamUrl`). Un lien corrigé
 * garde son rattachement tant que son fournisseur caste encore ce stream ;
 * sinon (lien vide, de l'organisation, ou d'un caster parti), il est rattaché
 * au caster qui tient ce stream (le premier inscrit) — jamais `NULL`, qui le
 * dirait de l'organisation et le garderait après le compte du caster ; effacé,
 * il n'est plus à personne. Un lien inchangé n'est pas réécrit.
 *
 * Un refus dit quel stream (`StreamLinkError`), pour son champ.
 *
 * @throws `STREAM_NOT_FOUND` | `INVALID_STREAM_URL`
 */
async function setCasterStreamLinks(
  connection: PoolConnection,
  matchId: number,
  links: readonly MatchStreamLinkEdit[],
  locked: MatchStreamRow[],
): Promise<MatchStreamRow[]> {
  let streams = locked;
  for (const link of links) {
    const target = streams.find((stream) => stream.id === link.streamId && !stream.staff);
    if (!target) throw new StreamLinkError("STREAM_NOT_FOUND", link.streamId);
    const url = streamLinkUrl(link);
    if (target.liveUrl === url) continue;
    if (url === null) {
      await connection.execute(
        `UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE id = ? AND match_id = ? AND staff_owned = 0`,
        [target.id, matchId],
      );
    } else {
      // Le lien saisi par l'arbitre revient au caster qui tient le stream —
      // jamais à l'organisation ni à un caster parti. Un stream que plus aucun
      // caster ne tient attend le ménage : son lien n'aurait personne à qui se
      // rattacher.
      const holder = await streamHolder(connection, matchId, target.id);
      if (holder === null) throw new StreamLinkError("STREAM_NOT_FOUND", target.id);
      await connection.execute(
        `UPDATE bg_match_streams SET live_url = ?, link_user_id = ? WHERE id = ? AND match_id = ? AND staff_owned = 0`,
        [url, holder, target.id, matchId],
      );
    }
    streams = streams.map((stream) => (stream.id === target.id ? { ...stream, liveUrl: url } : stream));
  }
  return streams;
}

/** Le lien saisi pour un stream de caster, ou le refus rattaché à ce stream. */
function streamLinkUrl(link: MatchStreamLinkEdit): string | null {
  try {
    return parseStreamUrlInput(link.liveUrl);
  } catch {
    throw new StreamLinkError("INVALID_STREAM_URL", link.streamId);
  }
}

/**
 * Le caster à qui rattacher le lien de ce stream : son fournisseur actuel
 * (`link_user_id`) s'il le caste encore, sinon le premier inscrit ; `null`
 * sans caster.
 * Lecture ordinaire et séparée : l'écriture du lien ne verrouille ainsi que
 * sa table (`bg_match_streams`) ; les casters du match ne changent que sous
 * le verrou de sa ligne, que l'appelant tient.
 */
async function streamHolder(connection: PoolConnection, matchId: number, streamId: number): Promise<number | null> {
  const [rows] = await connection.execute<(RowDataPacket & { user_id: number })[]>(
    `SELECT mc.user_id FROM bg_match_casters mc
     LEFT JOIN bg_match_streams s ON s.id = mc.stream_id AND s.link_user_id = mc.user_id
     WHERE mc.match_id = ? AND mc.stream_id = ? ORDER BY s.id IS NULL, mc.created_at, mc.user_id LIMIT 1`,
    [matchId, streamId],
  );
  return rows.length === 0 ? null : Number(rows[0].user_id);
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
 * Ouvrir ou couper l'antenne, c'est décider du mode manuel : la même règle que
 * le changer (`mayChangeLiveTrigger`, décision 2) — son caster, l'arbitre
 * désigné ou un admin, et le staff `tournaments` pour un mode sans
 * propriétaire. Un co-caster ne coupe pas l'antenne d'un autre
 * (`LIVE_TRIGGER_NOT_OWNED`). Tout se juge sous le verrou de la ligne du match
 * (`lockLiveMatch`) : l'arbitre sans `live` retiré entre la porte et
 * l'écriture est refusé (`NOT_MATCH_REFEREE`).
 *
 * @returns `true` quand l'antenne a changé d'état — un second clic sur « à
 *   l'antenne » ne change rien, et le journal du staff ne le note pas.
 * @throws `MATCH_NOT_FOUND` | `NOT_MATCH_REFEREE` | `LIVE_TRIGGER_NOT_MANUAL`
 *   | `LIVE_TRIGGER_NOT_OWNED` | `MATCH_NOT_LIVE_READY`
 */
export async function setMatchOnAir(
  matchId: number,
  onAir: boolean,
  userId: number,
  access: MatchLiveAccess,
): Promise<boolean> {
  const actor: LiveTriggerActor = { userId, isAdmin: access.isAdmin, manages: access.manages };
  // Le verrou du match puis la lecture de ses casters : l'ordre de
  // `setMatchLiveConfig`, rejoué comme lui sur un interblocage.
  const result = await retryOnDeadlock(() => withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const { row, hold, actorShown } = await lockLiveMatch(connection, matchId, actor);
      // Le mode d'abord : sur un match qui n'est pas en manuel, le refus dit
      // pourquoi, quel que soit l'auteur.
      if (row.live_trigger !== "MANUAL") throw new Error("LIVE_TRIGGER_NOT_MANUAL");
      if (!access.live && !isMatchRefereeActor(hold, actor)) throw new Error("NOT_MATCH_REFEREE");
      if (!mayToggleOnAir(hold, actor, actorShown)) throw new Error("LIVE_TRIGGER_NOT_OWNED");
      if (onAir && row.status !== "READY") throw new Error("MATCH_NOT_LIVE_READY");
      // Déjà dans cet état (second clic, deux clics simultanés) : rien d'écrit,
      // l'heure de mise à l'antenne n'est pas réécrite.
      const changed = onAir ? row.live_started_at === null : row.live_started_at !== null;
      if (changed) {
        await connection.execute(
          onAir
            ? `UPDATE bg_matches SET live_started_at = ? WHERE id = ?`
            : `UPDATE bg_matches SET live_started_at = NULL WHERE id = ?`,
          onAir ? [new Date(), matchId] : [matchId],
        );
      }
      await connection.commit();
      return { changed, tournamentId: Number(row.tournament_id) };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }));

  if (result.changed) publishMatchUpdatedEvent(result.tournamentId, { landingLive: true });
  return result.changed;
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
