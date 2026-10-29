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
  isMatchLive,
  isMatchLiveTrigger,
  normalizeStreamUrl,
  parseStreamUrlInput,
  requiresMatchStartAt,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import { launchPairingKey } from "@/lib/shared/match-launch";
import type { MatchStatus } from "@/lib/shared/types";
import { retryOnDeadlock } from "./deadlock-retry";
import { lockMatchStreams, pruneMatchStreams, staffStream, type MatchStreamRow } from "./match-casters";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "./notifications";

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
};

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
 * appel direct ne pose pas un lien sur un match que l'écran garde fermé.
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

  const row = await loadMatchLiveRow(matchId);

  if (
    !canConfigureLive({
      status: row.status,
      liveTrigger: row.live_trigger,
      liveStartedAt: row.live_started_at,
      launchedAt: null,
    })
  ) {
    throw new Error("MATCH_NOT_CASTABLE");
  }
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
      await connection.execute(`SELECT id FROM bg_matches WHERE id = ? FOR UPDATE`, [matchId]);
      let streams: MatchStreamRow[] | undefined;
      if (trigger === null) {
        await connection.execute(
          `UPDATE bg_matches SET live_trigger = NULL, live_started_at = NULL WHERE id = ?`,
          [matchId],
        );
        await connection.execute(
          `UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE match_id = ? AND staff_owned = 1`,
          [matchId],
        );
      } else {
        await connection.execute(
          trigger === "MANUAL"
            ? `UPDATE bg_matches SET live_trigger = ? WHERE id = ?`
            : `UPDATE bg_matches SET live_trigger = ?, live_started_at = NULL WHERE id = ?`,
          [trigger, matchId],
        );
        streams = await setStaffStreamUrl(connection, matchId, url, config.setter);
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
): Promise<MatchStreamRow[]> {
  const streams = await lockMatchStreams(connection, matchId);
  const target = staffStream(streams);
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
 * @throws `MATCH_NOT_FOUND` | `LIVE_TRIGGER_NOT_MANUAL` | `MATCH_NOT_LIVE_READY`
 */
export async function setMatchOnAir(matchId: number, onAir: boolean): Promise<void> {
  const row = await loadMatchLiveRow(matchId);

  if (row.live_trigger !== "MANUAL") throw new Error("LIVE_TRIGGER_NOT_MANUAL");
  if (onAir && row.status !== "READY") throw new Error("MATCH_NOT_LIVE_READY");

  const db = await getDatabase();
  await db.execute(`UPDATE bg_matches SET live_started_at = ? WHERE id = ?`, [
    onAir ? new Date() : null,
    matchId,
  ]);

  publishMatchUpdatedEvent(Number(row.tournament_id), { landingLive: true });
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
