/**
 * Annonce d'un **nouveau match** (`NEW_MATCH`, `docs/features/NEW_MATCH_NOTICE.md`) :
 * dès que les deux engagées d'un match sont connues — une manche s'est jouée,
 * la suivante arrive —, tous les membres des deux équipes (le joueur d'une
 * entrée solo) apprennent qui ils affrontent, l'horaire s'il est posé et le
 * lien de la page du match : push du sujet `NEW_MATCH` et message privé
 * Discord (interrupteur des messages privés de match respecté).
 *
 * **Pourquoi un balayage.** Les matchs reçoivent leurs engagées dans tous les
 * moteurs (avancée d'un tableau simple ou double, ronde suisse, survie,
 * multi-phases, BG Survie, retour arrière, tableau reconstruit), dans des
 * transactions qui tiennent le verrou du tournoi. Le balayage relit après coup,
 * **hors de tout verrou et après le commit**, ce qui est devenu jouable : aucun
 * moteur n'a à connaître la notification, et aucun n'est oublié.
 *
 * **Une fois par match.** La réservation (`bg_new_match_notices`) est posée en
 * une instruction (`INSERT IGNORE … SELECT`, `affectedRows`) qui relit le
 * match : la place du match (tournoi, phase, tableau, manche, numéro) et son
 * affiche (les deux engagées, sans ordre). Un match réapparié avec la même
 * affiche, un match effacé puis recréé à la même place avec les mêmes
 * engagées, deux balayages concurrents : un seul envoi. Une autre affiche à la
 * même place (retour arrière puis autre vainqueur) est un autre match, annoncé.
 *
 * **Première manche : rien.** Le coup d'envoi du tournoi (`TOURNAMENT_START`)
 * la couvre. La première fois qu'un tournoi en cours est vu, tout ce qui a
 * déjà ses deux engagées est marqué `skipped` (ligne de départ,
 * `bg_new_match_baselines`) — ce qui couvre aussi les matchs d'avant le
 * déploiement.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import {
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  notifyUsers,
  type NotificationRecipient,
} from "@/lib/server/notify";
import { toIso } from "@/lib/server/serialization";
import { siteUrl } from "@/lib/server/site-url";
import { throttledSweep } from "@/lib/server/throttled-sweep";
import { MATCH_DM_SETTINGS_PATH } from "@/lib/shared/discord-notifications";
import { matchPageHref } from "@/lib/shared/match-anchor";
import { newMatchPush, type NewMatchSide } from "@/lib/shared/push-messages";
import { formatNewMatchDm } from "./new-match-dm";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

/** Étranglement du balayage, comme le check-in et les départs de match. */
const NEW_MATCH_THROTTLE_MS = 10_000;
/** Matchs annoncés au plus par passage ; le reste attend le suivant. */
export const NEW_MATCH_BATCH = 50;

/** L'affiche d'un match : ses deux engagées, sans ordre (`5:7`). */
export const PAIRING_SQL = "CONCAT(LEAST(m.team1_id, m.team2_id), ':', GREATEST(m.team1_id, m.team2_id))";

/** Le match a-t-il déjà une marque (envoyée ou `skipped`) pour cette place et cette affiche ? */
const MARKED_SQL = `EXISTS (SELECT 1 FROM bg_new_match_notices n
   WHERE n.tournament_id = m.tournament_id AND n.phase_id = m.phase_id AND n.bracket = m.bracket
     AND n.round_number = m.round_number AND n.match_number = m.match_number AND n.pairing = ${PAIRING_SQL})`;

/**
 * Un match à annoncer : tournoi en cours et publié, deux engagées connues et
 * distinctes, ni exempt, ni joué, ni lancé (un horaire dépassé par une manche en
 * retard s'annonce quand même : c'est là qu'il presse). Lu pour les candidats **et** dans la
 * réservation.
 */
const ANNOUNCEABLE_SQL = `t.state = 'RUNNING' AND t.start_visibility_at <= NOW()
  AND m.is_bye = 0 AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL AND m.team1_id <> m.team2_id
  AND m.status IN ('PENDING', 'READY') AND m.team1_score IS NULL AND m.team2_score IS NULL
  AND m.launched_at IS NULL`;

export type NewMatchCandidateRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  bracket: string;
  round_number: number;
  team1_id: number;
  team2_id: number;
  start_at: Date | string | null;
  tournament_name: string;
  participant_type: string;
  swiss_round: number;
  team1_name: string;
  team2_name: string;
  team1_ghost: number;
  team2_ghost: number;
};

/**
 * Ligne de départ : un tournoi en cours vu pour la première fois (avec au moins
 * un match) voit sa **première manche** (première phase, tableau principal)
 * marquée `skipped` — l'avis de coup d'envoi la couvre —, puis reçoit sa
 * ligne. Les marques d'abord : une ligne visible implique ses marques. Le
 * repère est la manche, pas l'instant du premier balayage : un balayage en
 * retard n'avale pas une manche 2 déjà appariée. Seul un tournoi ramené avant
 * son départ perd sa ligne ; un tournoi terminé puis rouvert la garde, et les
 * revanches d'une correction s'annoncent.
 */
export async function layNewMatchBaselines(db: Pool): Promise<number> {
  await db.execute(
    `DELETE b FROM bg_new_match_baselines b
       JOIN bg_tournaments t ON t.id = b.tournament_id
      WHERE t.state IN ('UPCOMING', 'REGISTRATION')`,
  );
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT t.id FROM bg_tournaments t
       LEFT JOIN bg_new_match_baselines b ON b.tournament_id = t.id
      WHERE t.state = 'RUNNING' AND b.tournament_id IS NULL
        AND EXISTS (SELECT 1 FROM bg_matches m WHERE m.tournament_id = t.id)`,
  );
  for (const row of rows) {
    const tournamentId = Number(row.id);
    await db.execute(
      `INSERT IGNORE INTO bg_new_match_notices
         (tournament_id, phase_id, bracket, round_number, match_number, pairing, skipped)
       SELECT m.tournament_id, m.phase_id, m.bracket, m.round_number, m.match_number, ${PAIRING_SQL}, 1
         FROM bg_matches m
        WHERE m.tournament_id = ? AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
          AND m.round_number = 1 AND m.bracket NOT IN ('LOWER', 'GRAND')
          AND m.phase_id = (SELECT MIN(f.phase_id) FROM bg_matches f WHERE f.tournament_id = ?)`,
      [tournamentId, tournamentId],
    );
    await db.execute(`INSERT IGNORE INTO bg_new_match_baselines (tournament_id) VALUES (?)`, [tournamentId]);
  }
  return rows.length;
}

async function loadCandidates(db: Pool): Promise<NewMatchCandidateRow[]> {
  const [rows] = await db.query<NewMatchCandidateRow[]>(
    `SELECT m.id, m.tournament_id, m.bracket, m.round_number, m.team1_id, m.team2_id, m.start_at,
            t.name AS tournament_name, t.participant_type, ${swissRoundSql("m", "t")},
            t1.name AS team1_name, t2.name AS team2_name,
            t1.is_ghost AS team1_ghost, t2.is_ghost AS team2_ghost
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       JOIN bg_new_match_baselines b ON b.tournament_id = m.tournament_id
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE ${ANNOUNCEABLE_SQL} AND NOT ${MARKED_SQL}
      ORDER BY m.id
      LIMIT ${NEW_MATCH_BATCH}`,
  );
  return rows;
}

/**
 * Réserve l'annonce **si le match a toujours ces engagées et reste à
 * annoncer** : une instruction, relue dans l'instruction même. Un réappariement
 * ou un score entre la lecture et la réservation ne laisse ni annonce périmée,
 * ni annonce aux anciennes équipes.
 */
export async function claimNewMatchNotice(
  db: Pool,
  matchId: number,
  team1Id: number,
  team2Id: number,
): Promise<boolean> {
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_new_match_notices
       (tournament_id, phase_id, bracket, round_number, match_number, pairing, skipped)
     SELECT m.tournament_id, m.phase_id, m.bracket, m.round_number, m.match_number, ${PAIRING_SQL}, 0
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
      WHERE m.id = ? AND m.team1_id = ? AND m.team2_id = ? AND ${ANNOUNCEABLE_SQL}`,
    [matchId, team1Id, team2Id],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/** Le match vu d'une engagée. */
export function newMatchSide(row: NewMatchCandidateRow, side: 1 | 2): NewMatchSide {
  return {
    tournamentId: Number(row.tournament_id),
    tournamentName: String(row.tournament_name),
    matchId: Number(row.id),
    teamName: String(side === 1 ? row.team1_name : row.team2_name),
    opponentName: String(side === 1 ? row.team2_name : row.team1_name),
    solo: row.participant_type === "SOLO",
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    swiss: isSwissRound(row),
    startAt: row.start_at === null ? null : toIso(row.start_at),
  };
}

async function announce(
  row: NewMatchCandidateRow,
  playersByTeam: Map<number, number[]>,
  recipientsById: Map<number, NotificationRecipient>,
): Promise<number> {
  const url = siteUrl(matchPageHref(Number(row.tournament_id), Number(row.id)));
  const settingsUrl = siteUrl(MATCH_DM_SETTINGS_PATH);
  // Un compte qui serait des deux côtés n'est prévenu qu'une fois, du premier.
  const told = new Set<number>();
  let sides = 0;
  for (const side of [1, 2] as const) {
    // Une fantôme n'a personne à prévenir (`GHOST_TEAMS.md`).
    if (Number(side === 1 ? row.team1_ghost : row.team2_ghost) === 1) continue;
    const teamId = Number(side === 1 ? row.team1_id : row.team2_id);
    const recipients = (playersByTeam.get(teamId) ?? [])
      .filter((userId) => !told.has(userId))
      .flatMap((userId) => recipientsById.get(userId) ?? []);
    if (recipients.length === 0) continue;
    for (const recipient of recipients) told.add(recipient.userId);
    const match = newMatchSide(row, side);
    const report = await notifyUsers(recipients, {
      topic: "NEW_MATCH",
      push: (locale) => newMatchPush(match, locale),
      discord: { message: (locale) => formatNewMatchDm(match, url, locale, settingsUrl), context: "new-match" },
    });
    if (report.discord === null && report.discordUnreachedUserIds.length > 0) {
      console.error(`[new-match] bot injoignable, message privé perdu (match ${row.id})`);
    }
    sides += 1;
  }
  return sides;
}

async function sweepNewMatches(): Promise<number> {
  const db = await getDatabase();
  await layNewMatchBaselines(db);
  const candidates = await loadCandidates(db);
  if (candidates.length === 0) return 0;
  // Destinataires lus pour tous les matchs **avant** toute réservation : une
  // panne de lecture ne consomme aucune annonce. Comptes supprimés écartés par
  // `loadNotificationRecipients` ; interrupteur des messages privés de match lu.
  const teamIds = candidates.flatMap((row) => [Number(row.team1_id), Number(row.team2_id)]);
  const playersByTeam = await loadEntrantPlayerIds(teamIds);
  const recipients = await loadNotificationRecipients([...playersByTeam.values()].flat(), "certified", {
    matchDm: true,
  });
  const recipientsById = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
  let announced = 0;
  for (const row of candidates) {
    if (!(await claimNewMatchNotice(db, Number(row.id), Number(row.team1_id), Number(row.team2_id)))) continue;
    try {
      announced += await announce(row, playersByTeam, recipientsById);
    } catch (error) {
      // Réservation gardée : une annonce manquée ne se répète pas en boucle.
      console.error(`[new-match] annonce en échec (match ${row.id})`, failureReason(error));
    }
  }
  // Lot plein : il en reste peut-être, le passage suivant les prendra.
  if (candidates.length === NEW_MATCH_BATCH) sweeps.schedule(NEW_MATCH_THROTTLE_MS);
  return announced;
}

const sweeps = throttledSweep({
  throttleMs: NEW_MATCH_THROTTLE_MS,
  sweep: sweepNewMatches,
  onError: (error) => {
    if (!isMissingTableError(error)) console.error("[new-match] balayage en échec", failureReason(error));
  },
});

/**
 * Annonce les nouveaux matchs. Jamais bloquant, jamais une exception :
 * l'appelant est une écriture déjà faite ou une lecture de page.
 *
 * @returns le nombre d'engagées prévenues.
 */
export async function dispatchNewMatchNotices(): Promise<number> {
  return sweeps.run();
}

/** Remet l'étranglement à zéro. Réservé aux tests. */
export function resetNewMatchNoticeThrottle(): void {
  sweeps.reset();
}
