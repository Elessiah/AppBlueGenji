/**
 * Programme d'arbitrage : « en même temps » que le rappel de 10 h aux joueurs
 * (demande de l'association, 2026-10-09), les arbitres reçoivent **un** message
 * qui liste les matchs à venir — horaire (heure de Paris), tournoi, équipes.
 *
 * - **Quand.** Au balayage des rappels (`dispatchDueMatchReminders`, une fois
 *   par minute au plus), dès qu'une manche non encore citée entre dans ses
 *   10 dernières heures. Le programme cite alors **toutes** les manches non
 *   citées des 12 prochaines heures (marge de regroupement) : une soirée
 *   échelonnée tient en un message.
 * - **Une fois par manche et par horaire.** Chaque manche citée reçoit la
 *   marque {@link REFEREE_DIGEST_KEY}, datée de son horaire et réservée
 *   **avant** l'envoi (clé unique) : deux balayages concurrents ne la citent
 *   pas deux fois. Reprogrammer la manche efface la marque (`setMatchStartAt`,
 *   comme un palier) : le nouvel horaire sera cité ; une affiche changée aussi
 *   (`forgetMatchReminders`). Une manche jouée, d'un tournoi clos, ou à qui une
 *   engagée manque n'est pas lue.
 * - **Qui.** Push `REFEREE_DIGEST` aux comptes qui portent la permission
 *   `tournaments` (`notifyStaff`), dans la langue de chacun ; et une ligne au
 *   canal de logs Discord, où les arbitres suivent déjà les horaires posés
 *   (`formatRefereeDigestLog` : « un joueur » en tournoi individuel, noms
 *   d'équipe par `discordInline`, aucun auteur).
 *
 * Meilleur effort : le programme manqué (bot injoignable, aucun appareil) n'est
 * pas retenté — un programme envoyé en boucle ne se rattrape pas.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { notifyStaff } from "@/lib/server/notify";
import { formatRefereeDigestLog } from "@/lib/shared/bot-logs";
import {
  REFEREE_DIGEST_GROUPING_MS,
  REFEREE_DIGEST_KEY,
  REFEREE_DIGEST_LEAD_MS,
} from "@/lib/shared/discord-notifications";
import { inBatches } from "@/lib/shared/in-batches";
import { PLAYED_MATCH_STATUSES } from "@/lib/shared/match-schedule";
import { toParticipantType } from "@/lib/shared/participants";
import { refereeDigestPush } from "@/lib/shared/push-messages";
import { releaseDatedMarks } from "./reminder-marks";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

type DigestRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
  start_at: Date | string;
  bracket: string;
  round_number: number;
  swiss_round: number;
  team1_id: number;
  team2_id: number;
  team1_name: string;
  team2_name: string;
};

/**
 * Manches à venir non citées, jouables, deux engagées connues : la condition
 * commune à la sonde et à la lecture du programme (paramètres : borne basse,
 * borne haute, marque).
 */
const DIGEST_FROM = `FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.status NOT IN (${PLAYED_MATCH_STATUSES.map((status) => `'${status}'`).join(", ")})
        AND t.state <> 'FINISHED'
        AND m.start_at IS NOT NULL
        AND m.start_at > ?
        AND m.start_at <= ?
        AND NOT EXISTS (SELECT 1 FROM bg_match_reminders r WHERE r.match_id = m.id AND r.offset_key = ?)`;

/**
 * Sonde : une manche non citée est-elle entrée dans ses 10 dernières heures ?
 * Une ligne au plus — tant que la réponse est non (la plupart des balayages),
 * la marge de regroupement n'est ni lue ni jointe.
 */
const DIGEST_DUE_PROBE = `SELECT 1 AS due ${DIGEST_FROM} LIMIT 1`;

/** Manches du programme, jusqu'à la fin de la marge de regroupement. */
const DIGEST_SELECT = `SELECT m.id, m.tournament_id, m.start_at, m.team1_id, m.team2_id,
            m.bracket, m.round_number, ${swissRoundSql("m", "t")},
            t.name AS tournament_name, t.participant_type,
            t1.name AS team1_name, t2.name AS team2_name
       ${DIGEST_FROM}
      ORDER BY m.start_at, m.id`;

/** Réservations de marques menées de front (comme le balayage des rappels). */
const CLAIM_CONCURRENCY = 4;

/**
 * Réserve la citation d'une manche **pour l'horaire et l'affiche lus** : un
 * arbitre qui l'a déplacée entre la lecture et l'envoi l'emporte (sa nouvelle
 * date sera citée au programme suivant).
 */
async function claimDigestMark(row: DigestRow): Promise<boolean> {
  const db = await getDatabase();
  const matchId = Number(row.id);
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at)
       SELECT ?, ?, start_at FROM bg_matches
        WHERE id = ? AND start_at = ? AND team1_id = ? AND team2_id = ?`,
    [matchId, REFEREE_DIGEST_KEY, matchId, row.start_at, Number(row.team1_id), Number(row.team2_id)],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/**
 * Envoie le programme d'arbitrage s'il est dû.
 *
 * @param now Instant de référence, injectable pour les tests.
 * @returns Le nombre de manches citées (0 : rien n'était dû).
 */
export async function dispatchRefereeDigest(now: Date = new Date()): Promise<number> {
  const db = await getDatabase();
  const triggerAt = now.getTime() + REFEREE_DIGEST_LEAD_MS;
  // Rien n'entre encore dans les 10 dernières heures : les manches de la marge
  // attendent — elles partiront avec celle qui ouvrira le programme.
  const [due] = await db.query<RowDataPacket[]>(DIGEST_DUE_PROBE, [now, new Date(triggerAt), REFEREE_DIGEST_KEY]);
  if (due.length === 0) return 0;

  const [rows] = await db.query<DigestRow[]>(DIGEST_SELECT, [
    now,
    new Date(triggerAt + REFEREE_DIGEST_GROUPING_MS),
    REFEREE_DIGEST_KEY,
  ]);
  // Une manche déplacée entre la sonde et la lecture : rien n'est plus dû.
  if (!rows.some((row) => new Date(row.start_at).getTime() <= triggerAt)) return 0;

  // Quelques réservations à la fois : une ronde suisse en compte des dizaines,
  // une par aller-retour les ferait attendre l'une après l'autre. Une
  // réservation en échec ne retient pas les autres (la manche sera citée au
  // programme suivant) : celles déjà prises doivent partir.
  const won = new Set<number>();
  await inBatches(rows, CLAIM_CONCURRENCY, async (row) => {
    try {
      if (await claimDigestMark(row)) won.add(Number(row.id));
    } catch (error) {
      console.error("[referee-digest] réservation en échec", error);
    }
  });
  // L'ordre du coup d'envoi, quel que soit l'ordre des réservations.
  const claimed = rows.filter((row) => won.has(Number(row.id)));
  if (claimed.length === 0) return 0;
  // La manche due n'a pas été prise (déplacée entre-temps, réservation en
  // échec) : la marge seule ne part pas — elle attendrait sinon d'être citée
  // en avance, et la manche due ouvrirait un second programme. Rendues, ses
  // marques la laissent au programme que la prochaine manche due ouvrira.
  if (!claimed.some((row) => new Date(row.start_at).getTime() <= triggerAt)) {
    await Promise.all(claimed.map((row) => releaseDatedMarks(Number(row.id), [REFEREE_DIGEST_KEY], row.start_at)));
    return 0;
  }

  const matches = claimed.map((row) => {
    const participantType = toParticipantType(row.participant_type);
    return {
      matchId: Number(row.id),
      tournament: { id: Number(row.tournament_id), name: String(row.tournament_name) },
      team1: { name: String(row.team1_name), participantType },
      team2: { name: String(row.team2_name), participantType },
      startAt: row.start_at,
      bracket: String(row.bracket),
      roundNumber: Number(row.round_number),
      swiss: isSwissRound(row),
    };
  });
  const line = formatRefereeDigestLog(matches);
  await notifyStaff({
    topic: "REFEREE_DIGEST",
    discord: async () => {
      await sendBotLog(line);
      return null;
    },
    push: (locale) =>
      refereeDigestPush(
        matches.map((match) => ({
          matchId: match.matchId,
          tournamentId: match.tournament.id,
          tournamentName: match.tournament.name,
          bracket: match.bracket,
          roundNumber: match.roundNumber,
          swiss: match.swiss,
          team1Name: match.team1.name,
          team2Name: match.team2.name,
          solo: match.team1.participantType === "SOLO",
          startAt: match.startAt,
        })),
        locale,
      ),
  });
  return claimed.length;
}
