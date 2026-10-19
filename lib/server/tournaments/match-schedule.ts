/**
 * Calendrier des matchs : écriture de la date de début d'une manche.
 *
 * Toute la règle vit dans le module pur `lib/shared/match-schedule.ts` ; ce
 * fichier ne fait que l'appliquer à la base et publier l'événement qui réveille
 * les pages ouvertes — la date voyage ensuite dans l'instantané du flux SSE,
 * comme le reste du plateau.
 *
 * Réservé à la permission `tournaments` (arbitre, admin) : programmer une
 * manche engage l'organisation vis-à-vis des engagés, contrairement au lien de
 * diffusion qu'un caster pose sur son seul cast.
 *
 * Aucune garde d'état. La date ne verrouille rien, si bien que la poser sur une
 * manche déjà jouée n'est pas une incohérence mais une correction d'archive.
 * Elle a deux effets, tous deux **dérivés** : l'ouverture d'antenne du mode
 * `START_TIME` (bornée par `resolveMatchLiveState`, qui coupe le direct dès
 * qu'un score est saisi), et la phase de lancement (`matchLaunchPhase`) — un
 * match **à planifier** (option `referee_scheduling`) passe « en attente de
 * départ », puis en lancement à l'heure dite.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { launchPairingKey, matchLaunchPhase } from "@/lib/shared/match-launch";
import { MATCH_SEEN_KEY, MATCH_STAFF_KEY, MATCH_TOLD_KEY, REFEREE_DIGEST_KEY } from "@/lib/shared/discord-notifications";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { isMatchOver, normalizeMatchStartAt } from "@/lib/shared/match-schedule";
import type { MatchStatus } from "@/lib/shared/types";
import { toIso } from "@/lib/server/serialization";
import type { StaffActor } from "@/lib/shared/log-privacy";
import { retryOnDeadlock } from "./deadlock-retry";
import { publishMatchUpdatedEvent } from "./notifications";
import { notifyMatchScheduleChange } from "./schedule-notices";

type MatchScheduleRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: MatchStatus;
  team1_id: number | null;
  team2_id: number | null;
  start_at: Date | string | null;
  launched_at: Date | string | null;
  launch_pairing: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

/**
 * Le match quitte-t-il le lancement avec cette nouvelle date ? Vrai quand,
 * non lancé (ou lancé d'office, sans score, sur un tournoi sans phase de
 * lancement), il repasse **à planifier** (date effacée, option allumée) ou **en
 * attente de départ** (date reportée dans le futur).
 *
 * Son état de lancement (ouverture, « Prêt ») appartenait alors à l'horaire
 * d'avant : gardé, l'ouverture restée en base ferait partir le match d'office
 * dès sa nouvelle heure (le délai de quinze minutes étant déjà écoulé), sur des
 * « Prêt » donnés pour un autre créneau.
 */
function leavesLaunch(
  row: MatchScheduleRow,
  startAt: string | null,
  options: { refereeScheduling: boolean; launchPhase: boolean; scoreNoted: boolean },
): boolean {
  const { refereeScheduling, launchPhase, scoreNoted } = options;
  const team1Id = row.team1_id === null ? null : Number(row.team1_id);
  const team2Id = row.team2_id === null ? null : Number(row.team2_id);
  // Sans phase de lancement, le départ ne tient qu'à l'horaire : un match lancé
  // d'office à son heure (pas forcé), puis reporté (ou rendu à planifier) sans
  // score noté, n'a pas eu lieu — gardé lancé, il laisserait saisir un score avant sa
  // nouvelle heure. Il quitte donc le lancement comme un match en salon.
  const currentLaunch =
    launchPairingKey(team1Id, team2Id) === (row.launch_pairing ?? null) ? toIso(row.launched_at) : null;
  const clockLaunchMoved =
    !launchPhase && !scoreNoted && launchedByClock(row, startAt, refereeScheduling, currentLaunch);
  const launchedAt = clockLaunchMoved ? null : currentLaunch;
  const phase = matchLaunchPhase(
    { status: row.status, team1Id, team2Id, startAt, launchedAt, refereeScheduling },
    Date.now(),
  );
  return phase === "TO_PLAN" || phase === "SCHEDULED";
}

/**
 * Sans phase de lancement, le lancement en place vient-il de l'horaire — et
 * la date change-t-elle ? Vrai quand le match est parti à son ancienne heure
 * ou après (`launched_at` ≥ ancienne heure ; sans heure ni planification par
 * l'arbitrage, il part d'emblée) et que la nouvelle date diffère. Un lancement
 * **forcé** avant l'heure (ou d'un match à planifier) est un geste
 * d'arbitrage : il reste, comme un réenregistrement de la même date.
 */
function launchedByClock(
  row: MatchScheduleRow,
  startAt: string | null,
  refereeScheduling: boolean,
  launchedAt: string | null,
): boolean {
  if (launchedAt === null) return false;
  const previous = toIso(row.start_at);
  if (previous === startAt) return false;
  if (previous === null) return !refereeScheduling;
  return Date.parse(launchedAt) >= Date.parse(previous);
}

/**
 * L'écriture de la date, selon ce qu'elle fait au lancement : rien (le match
 * reste où il est), le tient pour lancé (il quitte le lancement mais porte déjà
 * un score), ou défait ouverture et « Prêt » (il quitte le lancement).
 */
function scheduleUpdateSql(leaving: boolean, scoreNoted: boolean): string {
  if (!leaving) return `UPDATE bg_matches SET start_at = ? WHERE id = ?`;
  if (scoreNoted) {
    return `UPDATE bg_matches
            SET start_at = ?, launched_at = NOW(),
                launch_pairing = CONCAT(team1_id, ':', team2_id),
                lobby_opened_at = COALESCE(lobby_opened_at, NOW())
            WHERE id = ?`;
  }
  return `UPDATE bg_matches
          SET start_at = ?, launched_at = NULL, lobby_opened_at = NULL, team1_ready_at = NULL,
              team2_ready_at = NULL, caster_ready_at = NULL
          WHERE id = ?`;
}

/**
 * La colonne `DATETIME` (sans fractions) **arrondit** les millisecondes : on les
 * retire avant l'écriture, pour que l'horaire rendu, annoncé et comparé ensuite
 * (`schedule-notices`) soit exactement celui que la base garde.
 */
function toWholeSeconds(iso: string | null): string | null {
  if (iso === null) return null;
  const time = Date.parse(iso);
  return new Date(time - (time % 1000 + 1000) % 1000).toISOString();
}

/**
 * Le tournoi d'une manche, lu **hors transaction** : il ne change jamais, et
 * une lecture ordinaire dans la transaction, avant ses verrous, y figerait un
 * état périmé (`REPEATABLE READ`).
 */
async function matchTournamentId(connection: PoolConnection, matchId: number): Promise<number | null> {
  const [rows] = await connection.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT tournament_id FROM bg_matches WHERE id = ? LIMIT 1`,
    [matchId],
  );
  return rows[0] ? Number(rows[0].tournament_id) : null;
}

/**
 * Verrouille le tournoi (comme `lockTournamentRow`) et en lit, dans la même
 * lecture verrouillante, l'option de planification par l'arbitrage. Aucune
 * lecture ordinaire avant les verrous : la première de la transaction, celle
 * de la marque `TOLD` (`resetReminderMarks`), voit l'état le plus récent.
 */
async function lockScheduleTournament(
  connection: PoolConnection,
  tournamentId: number,
): Promise<{ refereeScheduling: boolean; launchPhase: boolean; finished: boolean }> {
  const [rows] = await connection.execute<
    (RowDataPacket & { referee_scheduling: number | null; match_launch_phase: number | null; state: string | null })[]
  >(`SELECT referee_scheduling, match_launch_phase, state FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`, [
    tournamentId,
  ]);
  return {
    refereeScheduling: Number(rows[0]?.referee_scheduling ?? 0) === 1,
    launchPhase: Number(rows[0]?.match_launch_phase ?? 0) === 1,
    finished: rows[0]?.state === "FINISHED",
  };
}

async function lockScheduleRow(connection: PoolConnection, matchId: number): Promise<MatchScheduleRow | null> {
  // Table seule sous verrou (MariaDB : pas de `FOR UPDATE OF`). Le verrou tient
  // la ligne contre un « Prêt » concurrent, que la remise à zéro effacerait
  // sinon après coup.
  const [rows] = await connection.execute<MatchScheduleRow[]>(
    `SELECT id, tournament_id, status, team1_id, team2_id, start_at, launched_at, launch_pairing,
            team1_score, team2_score
     FROM bg_matches WHERE id = ? LIMIT 1 FOR UPDATE`,
    [matchId],
  );
  return rows[0] ?? null;
}

/**
 * Les marques de rappel d'une manche dont la date change réellement
 * (`./match-reminders`), **dans la transaction** qui écrit la date : un
 * balayage ne voit jamais la nouvelle date avec les marques de l'ancienne.
 *
 * - La marque qui prouve qu'un horaire a été **reçu** (`TOLD`, preuves
 *   héritées recopiées au démarrage) est lue d'abord : la nouvelle date se
 *   dira alors « reprogrammée », une date effacée « retirée ».
 * - Une date posée sur deux engagées connues : les paliers de l'ancienne date
 *   partent, `TOLD` reste, et la marque d'observation est gardée ou posée —
 *   l'annonce (`announceMatchSchedule`) est la nôtre, aucun balayage ne la
 *   prend à sa place. Une engagée manquante : tout part sauf `TOLD`, et le
 *   balayage annoncera la manche quand elle sera connue.
 * - Une date **effacée** garde ses marques (inertes : le balayage ne lit que
 *   les manches datées) — sauf la citation au programme d'arbitrage
 *   (`REFS`) : les arbitres ont reçu le retrait, et une date reposée à
 *   l'identique (rendue à l'horaire que les joueurs tiennent, marques
 *   gardées) doit reparaître au programme.
 *
 * Table absente tolérée (sa création est avalée au démarrage) : rien à lire
 * ni à effacer. Toute autre erreur défait l'écriture de la date — mieux vaut un
 * refus que l'arbitre peut rejouer qu'un horaire changé dont personne n'est
 * prévenu.
 *
 * @returns Les joueurs avaient-ils reçu un horaire, et lequel (`null` : inconnu,
 *          marque héritée de l'ancien code des rappels) ?
 */
async function resetReminderMarks(
  connection: PoolConnection,
  matchId: number,
  startAt: string | null,
  poster: { bothEntrants: boolean; played: boolean },
): Promise<ToldSchedule> {
  let marks: MarkRow[];
  try {
    [marks] = await connection.execute<MarkRow[]>(
      `SELECT offset_key, start_at FROM bg_match_reminders WHERE match_id = ? AND offset_key IN (?, ?)`,
      [matchId, MATCH_TOLD_KEY, MATCH_STAFF_KEY],
    );
  } catch (error) {
    if (isMissingTableError(error)) return NOTHING_TOLD;
    throw error;
  }
  const told = marks.find((mark) => mark.offset_key === MATCH_TOLD_KEY);
  const staff = marks.find((mark) => mark.offset_key === MATCH_STAFF_KEY);
  const result: ToldSchedule = {
    alreadyAnnounced: told !== undefined,
    toldStartAt: told ? toIso(told.start_at) : null,
    staffStartAt: staff ? toIso(staff.start_at) : null,
  };
  // Rendue à l'horaire que les joueurs tiennent : rien à réannoncer, et le
  // rappel déjà parti pour lui ne doit pas repartir — les marques restent. Une
  // date déjà passée (correction d'archive, saisie de travers) n'est annoncée à
  // personne : elle laisse aussi les marques en place, que le balayage — qui ne
  // lit que les dates à venir — ignore, et que la date suivante retrouve.
  if (startAt !== null && result.toldStartAt === startAt) {
    await restoreHeldMarks(connection, matchId, startAt, poster.bothEntrants);
    return result;
  }
  if (startAt === null) {
    await connection.execute(`DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key = ?`, [
      matchId,
      REFEREE_DIGEST_KEY,
    ]);
    return result;
  }
  if (new Date(startAt).getTime() <= Date.now()) return result;
  if (poster.bothEntrants && !poster.played) {
    await upsertSeenMark(connection, matchId, startAt);
    await connection.execute(
      `DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key NOT IN (?, ?, ?)`,
      [matchId, MATCH_SEEN_KEY, MATCH_TOLD_KEY, MATCH_STAFF_KEY],
    );
  } else {
    // Une engagée manque, ou la rencontre est jouée (score saisi) : pas
    // d'observation — le balayage annoncera la manche quand elle sera à jouer.
    await connection.execute(`DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key NOT IN (?, ?)`, [
      matchId,
      MATCH_TOLD_KEY,
      MATCH_STAFF_KEY,
    ]);
  }
  return result;
}

/**
 * Pose (ou redate) l'observation pour cet horaire — **toujours avant** un
 * effacement dans la même transaction : un `DELETE` sur une manche sans marque
 * verrouille l'intervalle de l'index qui l'entoure, et une insertion qui
 * suivrait attendrait celui qu'une autre programmation (manche voisine, même
 * intervalle) tient de la même façon — un interblocage, que la transaction
 * perdante rendrait en refus de l'horaire. Dans cet ordre, la transaction
 * n'insère plus rien après avoir verrouillé un intervalle.
 *
 * L'observation porte l'horaire qu'elle couvre : un ancien envoi en échec ne
 * rend que les marques de son horaire (`releaseDatedMarks`).
 */
async function upsertSeenMark(connection: PoolConnection, matchId: number, startAt: string): Promise<void> {
  await connection.execute(
    `INSERT INTO bg_match_reminders (match_id, offset_key, start_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE start_at = ?`,
    [matchId, MATCH_SEEN_KEY, new Date(startAt), new Date(startAt)],
  );
}

/**
 * Date rendue à l'horaire que les joueurs tiennent. Le palier pris pour un
 * horaire intermédiaire (son annonce n'a atteint personne) ne vaut pas pour
 * celui-ci : gardé, il ferait sauter au balayage le rappel 24 h de l'horaire
 * rendu, pour de bon. Les marques de l'horaire rendu (ou héritées, sans
 * horaire) restent. L'observation est redatée — reposée si elle manque (un
 * passage par un match joué l'a retirée) —, deux engagées connues : sans elle,
 * le balayage réannoncerait un horaire tenu, et un échec tardif de l'avis
 * intermédiaire la rendrait.
 */
async function restoreHeldMarks(
  connection: PoolConnection,
  matchId: number,
  startAt: string,
  bothEntrants: boolean,
): Promise<void> {
  if (bothEntrants) {
    await upsertSeenMark(connection, matchId, startAt);
  } else {
    await connection.execute(`UPDATE bg_match_reminders SET start_at = ? WHERE match_id = ? AND offset_key = ?`, [
      new Date(startAt),
      matchId,
      MATCH_SEEN_KEY,
    ]);
  }
  await connection.execute(
    `DELETE FROM bg_match_reminders
      WHERE match_id = ? AND offset_key NOT IN (?, ?, ?) AND start_at IS NOT NULL AND start_at <> ?`,
    [matchId, MATCH_SEEN_KEY, MATCH_TOLD_KEY, MATCH_STAFF_KEY, new Date(startAt)],
  );
}

type MarkRow = RowDataPacket & { offset_key: string; start_at: Date | string | null };

/** Identifiant d'une place de la manche (`null` : vide). */
function nullableId(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}
/**
 * Ce que les joueurs ont reçu (`TOLD`) et ce qui a été poussé aux arbitres
 * (`STAFF`), lus sous les verrous de l'écriture de la date.
 */
type ToldSchedule = { alreadyAnnounced: boolean; toldStartAt: string | null; staffStartAt: string | null };
const NOTHING_TOLD: ToldSchedule = { alreadyAnnounced: false, toldStartAt: null, staffStartAt: null };

/**
 * Fixe (ou efface) la date de début d'un match.
 *
 * `null` ou chaîne vide valent effacement : le formulaire renvoie `""` quand le
 * staff vide le champ, et exiger `null` là serait un piège. Un match casté en
 * mode `START_TIME` dont on efface la date reste « programmé » sans jamais
 * passer à l'antenne — c'est volontaire, et l'interface le signale plutôt que
 * de refuser l'effacement : le calendrier ne doit pas être pris en otage par
 * une configuration de diffusion.
 *
 * Une date posée ou changée, encore devant, est annoncée aux joueurs des deux
 * engagées et aux arbitres, et journalisée (`./schedule-notices`).
 *
 * @param actor Membre du staff qui programme : nommé dans pm2, anonyme sur
 *              Discord, et seul arbitre à ne pas recevoir la notification.
 * @returns la date normalisée en ISO, ou `null` si elle a été effacée.
 * @throws `MATCH_NOT_FOUND` | `INVALID_MATCH_START_AT`
 */
export async function setMatchStartAt(
  matchId: number,
  rawStartAt: string | Date | null,
  actor: StaffActor | null = null,
): Promise<string | null> {
  const blank =
    rawStartAt === null || (typeof rawStartAt === "string" && rawStartAt.trim() === "");
  const startAt = blank ? null : toWholeSeconds(normalizeMatchStartAt(rawStartAt));
  if (!blank && startAt === null) throw new Error("INVALID_MATCH_START_AT");

  // Rejouée si InnoDB l'annule sur un interblocage (verrous d'intervalle des
  // marques de rappel, face à une programmation voisine ou au balayage).
  const outcome = await retryOnDeadlock(() => withConnection(async (connection) => {
    let written: {
      tournamentId: number;
      previousStartAt: string | null;
      alreadyAnnounced: boolean;
      toldStartAt: string | null;
      staffStartAt: string | null;
      refereeScheduling: boolean;
      entrantIds: [number | null, number | null];
    };
    const tournamentId = await matchTournamentId(connection, matchId);
    if (tournamentId === null) throw new Error("MATCH_NOT_FOUND");
    await connection.beginTransaction();
    try {
      // Le tournoi d'abord, comme toute écriture du moteur (score, correction,
      // retour en arrière) : sans cet ordre, une correction de score qui efface
      // les marques de rappel d'une manche voisine (verrou d'intervalle) puis
      // met à jour celle-ci, et cette programmation qui tient la manche puis
      // pose sa marque, s'attendraient l'une l'autre — un interblocage.
      const { refereeScheduling, launchPhase, finished } = await lockScheduleTournament(connection, tournamentId);
      const row = await lockScheduleRow(connection, matchId);
      if (!row) throw new Error("MATCH_NOT_FOUND");

      // `DATETIME` n'a pas de fuseau : on écrit une `Date`, que le pilote
      // convertit dans le fuseau de la connexion — exactement comme les autres
      // horodatages du schéma (`live_started_at`, `score_deadline_at`).
      //
      // Quitter le lancement défait ouverture et « Prêt » — sauf si l'arbitrage
      // a déjà noté un score : la rencontre a eu lieu, elle est tenue pour
      // lancée (un score ne peut rester en base sur un match où plus personne ne
      // peut le saisir, `MATCH_NOT_IN_LAUNCH`).
      const scoreNoted = row.team1_score !== null || row.team2_score !== null;
      const leaving = leavesLaunch(row, startAt, { refereeScheduling, launchPhase, scoreNoted });
      await connection.execute(scheduleUpdateSql(leaving, scoreNoted), [
        startAt === null ? null : new Date(startAt),
        matchId,
      ]);
      // Lancement défait : la notification de départ réservée pour lui
      // (`./player-pushes`) part avec, pour que la nouvelle heure prévienne de
      // nouveau les joueurs.
      if (leaving && !scoreNoted) {
        await connection.execute(`DELETE FROM bg_match_start_notices WHERE match_id = ?`, [matchId]);
      }
      const previousStartAt = toIso(row.start_at);
      const told =
        previousStartAt === startAt
          ? NOTHING_TOLD
          : await resetReminderMarks(connection, matchId, startAt, {
              bothEntrants: row.team1_id !== null && row.team2_id !== null,
              played: isMatchOver(row.status, finished),
            });
      await connection.commit();
      written = {
        tournamentId: Number(row.tournament_id),
        previousStartAt,
        ...told,
        refereeScheduling,
        entrantIds: [nullableId(row.team1_id), nullableId(row.team2_id)],
      };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    }

    return written;
  }));

  // Joueurs, arbitres et journal apprennent l'horaire posé, changé ou retiré
  // (`./schedule-notices`) — sans retenir la réponse, après le commit qui a
  // aussi remis les marques de rappel à jour. Appelé **avant** la publication
  // de l'évènement, qui peut lever : la trace pm2 du geste, écrite dans le même
  // tour, ne doit pas en dépendre.
  void notifyMatchScheduleChange({
    matchId,
    startAt,
    previousStartAt: outcome.previousStartAt,
    alreadyAnnounced: outcome.alreadyAnnounced,
    toldStartAt: outcome.toldStartAt,
    staffStartAt: outcome.staffStartAt,
    refereeScheduling: outcome.refereeScheduling,
    entrantIds: outcome.entrantIds,
    actor,
  }).catch(() => undefined);
  publishMatchUpdatedEvent(outcome.tournamentId, { landingLive: true });
  return startAt;
}
