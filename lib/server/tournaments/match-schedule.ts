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
import { MATCH_SEEN_KEY, MATCH_TOLD_KEY } from "@/lib/shared/discord-notifications";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { normalizeMatchStartAt } from "@/lib/shared/match-schedule";
import type { MatchStatus } from "@/lib/shared/types";
import { toIso } from "@/lib/server/serialization";
import type { StaffActor } from "@/lib/shared/log-privacy";
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
 * non lancé, il repasse **à planifier** (date effacée, option allumée) ou **en
 * attente de départ** (date reportée dans le futur).
 *
 * Son état de lancement (ouverture, « Prêt ») appartenait alors à l'horaire
 * d'avant : gardé, l'ouverture restée en base ferait partir le match d'office
 * dès sa nouvelle heure (le délai de quinze minutes étant déjà écoulé), sur des
 * « Prêt » donnés pour un autre créneau.
 */
function leavesLaunch(row: MatchScheduleRow, startAt: string | null, refereeScheduling: boolean): boolean {
  const team1Id = row.team1_id === null ? null : Number(row.team1_id);
  const team2Id = row.team2_id === null ? null : Number(row.team2_id);
  const launchedAt =
    launchPairingKey(team1Id, team2Id) === (row.launch_pairing ?? null) ? toIso(row.launched_at) : null;
  const phase = matchLaunchPhase(
    { status: row.status, team1Id, team2Id, startAt, launchedAt, refereeScheduling },
    Date.now(),
  );
  return phase === "TO_PLAN" || phase === "SCHEDULED";
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
          SET start_at = ?, lobby_opened_at = NULL, team1_ready_at = NULL,
              team2_ready_at = NULL, caster_ready_at = NULL
          WHERE id = ?`;
}

async function lockScheduleRow(
  connection: PoolConnection,
  matchId: number,
): Promise<{ row: MatchScheduleRow; refereeScheduling: boolean } | null> {
  // Table seule sous verrou (MariaDB : pas de `FOR UPDATE OF`), puis l'option
  // du tournoi par une lecture ordinaire — même partage que `lockLaunchMatch`.
  // Le verrou tient la ligne contre un « Prêt » concurrent, que la remise à
  // zéro effacerait sinon après coup.
  const [rows] = await connection.execute<MatchScheduleRow[]>(
    `SELECT id, tournament_id, status, team1_id, team2_id, start_at, launched_at, launch_pairing,
            team1_score, team2_score
     FROM bg_matches WHERE id = ? LIMIT 1 FOR UPDATE`,
    [matchId],
  );
  const row = rows[0];
  if (!row) return null;
  const [tournament] = await connection.execute<
    (RowDataPacket & { referee_scheduling: number | null })[]
  >(`SELECT referee_scheduling FROM bg_tournaments WHERE id = ? LIMIT 1`, [row.tournament_id]);
  return { row, refereeScheduling: Number(tournament[0]?.referee_scheduling ?? 0) === 1 };
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
 * - Une date **effacée** garde toutes ses marques (inertes : le balayage ne
 *   lit que les manches datées).
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
  bothEntrants: boolean,
): Promise<ToldSchedule> {
  let told: ToldRow[];
  try {
    [told] = await connection.execute<ToldRow[]>(
      `SELECT start_at FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? LIMIT 1`,
      [matchId, MATCH_TOLD_KEY],
    );
  } catch (error) {
    if (isMissingTableError(error)) return NOTHING_TOLD;
    throw error;
  }
  const result: ToldSchedule =
    told.length > 0 ? { alreadyAnnounced: true, toldStartAt: toIso(told[0].start_at) } : NOTHING_TOLD;
  // Rendue à l'horaire que les joueurs tiennent : rien à réannoncer, et le
  // rappel déjà parti pour lui ne doit pas repartir — les marques restent. Une
  // date déjà passée (correction d'archive, saisie de travers) n'est annoncée à
  // personne : elle laisse aussi les marques en place, que le balayage — qui ne
  // lit que les dates à venir — ignore, et que la date suivante retrouve.
  if (result.toldStartAt !== null && result.toldStartAt === startAt) return result;
  if (startAt !== null && new Date(startAt).getTime() <= Date.now()) return result;
  if (startAt !== null && bothEntrants) {
    await connection.execute(
      `DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key NOT IN (?, ?)`,
      [matchId, MATCH_SEEN_KEY, MATCH_TOLD_KEY],
    );
    await connection.execute(`INSERT IGNORE INTO bg_match_reminders (match_id, offset_key) VALUES (?, ?)`, [
      matchId,
      MATCH_SEEN_KEY,
    ]);
  } else if (startAt !== null) {
    await connection.execute(`DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key <> ?`, [
      matchId,
      MATCH_TOLD_KEY,
    ]);
  }
  return result;
}

type ToldRow = RowDataPacket & { start_at: Date | string | null };
type ToldSchedule = { alreadyAnnounced: boolean; toldStartAt: string | null };
const NOTHING_TOLD: ToldSchedule = { alreadyAnnounced: false, toldStartAt: null };

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
  const startAt = blank ? null : normalizeMatchStartAt(rawStartAt);
  if (!blank && startAt === null) throw new Error("INVALID_MATCH_START_AT");

  const outcome = await withConnection(async (connection) => {
    let written: {
      tournamentId: number;
      previousStartAt: string | null;
      alreadyAnnounced: boolean;
      toldStartAt: string | null;
      refereeScheduling: boolean;
    };
    await connection.beginTransaction();
    try {
      const locked = await lockScheduleRow(connection, matchId);
      if (!locked) throw new Error("MATCH_NOT_FOUND");
      const { row, refereeScheduling } = locked;

      // `DATETIME` n'a pas de fuseau : on écrit une `Date`, que le pilote
      // convertit dans le fuseau de la connexion — exactement comme les autres
      // horodatages du schéma (`live_started_at`, `score_deadline_at`).
      //
      // Quitter le lancement défait ouverture et « Prêt » — sauf si l'arbitrage
      // a déjà noté un score : la rencontre a eu lieu, elle est tenue pour
      // lancée (un score ne peut rester en base sur un match où plus personne ne
      // peut le saisir, `MATCH_NOT_IN_LAUNCH`).
      const leaving = leavesLaunch(row, startAt, refereeScheduling);
      const scoreNoted = row.team1_score !== null || row.team2_score !== null;
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
          : await resetReminderMarks(connection, matchId, startAt, row.team1_id !== null && row.team2_id !== null);
      await connection.commit();
      written = {
        tournamentId: Number(row.tournament_id),
        previousStartAt,
        ...told,
        refereeScheduling,
      };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    }

    return written;
  });

  publishMatchUpdatedEvent(outcome.tournamentId, { landingLive: true });
  // Joueurs, arbitres et journal apprennent l'horaire posé, changé ou retiré
  // (`./schedule-notices`) — sans retenir la réponse, après le commit qui a
  // aussi remis les marques de rappel à jour.
  void notifyMatchScheduleChange({
    matchId,
    startAt,
    previousStartAt: outcome.previousStartAt,
    alreadyAnnounced: outcome.alreadyAnnounced,
    toldStartAt: outcome.toldStartAt,
    refereeScheduling: outcome.refereeScheduling,
    actor,
  }).catch(() => undefined);
  return startAt;
}
