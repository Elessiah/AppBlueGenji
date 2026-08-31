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
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  isMatchLive,
  isMatchLiveTrigger,
  normalizeStreamUrl,
  requiresMatchStartAt,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import type { MatchStatus } from "@/lib/shared/types";
import { publishUpdatedEvent } from "./notifications";

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
};

type TournamentStateRow = RowDataPacket & { id: number; state: string };

type MatchLiveRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: MatchStatus;
  start_at: Date | string | null;
  live_trigger: MatchLiveTrigger | null;
  live_started_at: Date | string | null;
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
  const url = rawUrl === null || rawUrl.trim() === "" ? null : normalizeStreamUrl(rawUrl);
  if (rawUrl !== null && rawUrl.trim() !== "" && url === null) {
    throw new Error("INVALID_STREAM_URL");
  }

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
 * Le mode `START_TIME` exige une date de début sur le match : l'accepter sans
 * date poserait une diffusion qui ne s'ouvrirait jamais, et l'échec ne se
 * verrait qu'à l'heure du match. La date, elle, reste effaçable ensuite — le
 * calendrier est du ressort du staff `tournaments`, pas de la diffusion.
 *
 * @throws `MATCH_NOT_FOUND` | `INVALID_LIVE_TRIGGER` | `INVALID_STREAM_URL`
 *         | `MATCH_START_AT_REQUIRED`
 */
export async function setMatchLiveConfig(
  matchId: number,
  config: MatchLiveConfig,
): Promise<void> {
  if (config.trigger !== null && !isMatchLiveTrigger(config.trigger)) {
    throw new Error("INVALID_LIVE_TRIGGER");
  }

  const row = await loadMatchLiveRow(matchId);
  const db = await getDatabase();

  if (requiresMatchStartAt(config.trigger) && row.start_at === null) {
    throw new Error("MATCH_START_AT_REQUIRED");
  }

  if (config.trigger === null) {
    await db.execute(
      `UPDATE bg_matches
       SET live_trigger = NULL, live_url = NULL, live_started_at = NULL
       WHERE id = ?`,
      [matchId],
    );
    publishUpdatedEvent(Number(row.tournament_id));
    return;
  }

  const rawUrl = config.liveUrl;
  const url = rawUrl === null || rawUrl.trim() === "" ? null : normalizeStreamUrl(rawUrl);
  if (rawUrl !== null && rawUrl.trim() !== "" && url === null) {
    throw new Error("INVALID_STREAM_URL");
  }

  if (config.trigger === "MANUAL") {
    await db.execute(
      `UPDATE bg_matches
       SET live_trigger = ?, live_url = ?
       WHERE id = ?`,
      ["MANUAL", url, matchId],
    );
  } else {
    await db.execute(
      `UPDATE bg_matches
       SET live_trigger = ?, live_url = ?, live_started_at = NULL
       WHERE id = ?`,
      [config.trigger, url, matchId],
    );
  }

  publishUpdatedEvent(Number(row.tournament_id));
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

  publishUpdatedEvent(Number(row.tournament_id));
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
      m.live_started_at
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
