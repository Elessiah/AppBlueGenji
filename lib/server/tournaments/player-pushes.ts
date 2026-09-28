/**
 * Notifications des joueurs nées du moteur de tournoi : départ d'un match,
 * score à confirmer, coup d'envoi d'un tournoi.
 *
 * Elles n'ont pas de message privé Discord — le site les annonçait jusqu'ici
 * **dans la page** (modale de lancement, alertes d'onglet de
 * `lib/shared/viewer-alerts.ts`), ce qui supposait la page ouverte. Le push
 * les porte jusqu'au joueur qui a quitté le site, et passe par le même point
 * d'entrée que toutes les autres (`lib/server/notify.ts`).
 *
 * **Départ de match — pourquoi un balayage.** Un match entre en lancement par
 * l'horloge (`lib/shared/match-launch.ts`) : `lobby_opened_at` est posé par
 * l'entretien passif, par un « Prêt » ou par un lancement forcé, dans des
 * transactions qui n'ont pas à connaître les notifications. Le balayage relit
 * après coup ce qui s'est ouvert récemment, **réserve** l'annonce dans
 * `bg_match_start_notices` (clé unique par match, appariement et phase — deux
 * balayages concurrents n'envoient qu'une fois), puis l'envoie. Il est déclenché
 * par chaque publication d'évènement de tournoi (`./notifications`), ce qui le
 * fait passer juste après toute écriture capable d'ouvrir un lancement, et par
 * la lecture de la liste des tournois, comme les rappels.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { loadEntrantManagerIds, loadEntrantPlayerIds, notifyUsers } from "@/lib/server/notify";
import { purgeStaleSubscriptions } from "@/lib/server/push-subscriptions";
import { webPushConfig } from "@/lib/server/web-push";
import { LAUNCH_AUTO_DELAY_MINUTES } from "@/lib/shared/match-launch";
import {
  matchStartPush,
  scoreToConfirmPush,
  tournamentStartPush,
} from "@/lib/shared/push-messages";
import type { PushContent } from "@/lib/shared/push-notifications";

async function pushTo(userIds: readonly number[], topic: "MATCH_START" | "SCORE_TO_CONFIRM" | "TOURNAMENT_START", push: PushContent, urgent: boolean) {
  if (userIds.length === 0) return 0;
  // Sans canal Discord : ces notifications n'en ont pas. Les comptes supprimés
  // sont écartés par la distribution elle-même (`pushToUsers`).
  const recipients = userIds.map((userId) => ({ userId, discord: null }));
  const { pushed } = await notifyUsers(recipients, {
    topic,
    push,
    pushOptions: urgent
      ? { urgency: "high", ttlSeconds: LAUNCH_AUTO_DELAY_MINUTES * 60 }
      : undefined,
  });
  return pushed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Départ de match
// ─────────────────────────────────────────────────────────────────────────────

type StartingMatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
  team1_id: number;
  team2_id: number;
  team1_name: string;
  team2_name: string;
  caster_user_id: number | null;
  launch_pairing: string;
  launched_at: Date | string | null;
};

/**
 * Au-delà, un lancement ouvert n'est plus annoncé : le match est parti d'office
 * depuis longtemps, et une notification tardive ferait courir un joueur vers
 * une partie déjà jouée. Le délai du lancement d'office, plus une marge.
 */
const LOBBY_NOTICE_WINDOW_MINUTES = LAUNCH_AUTO_DELAY_MINUTES + 5;
/** Même idée pour le départ : annoncé dans les minutes qui le suivent, ou jamais. */
const LAUNCH_NOTICE_WINDOW_MINUTES = 10;

export type MatchStartPhase = "LOBBY" | "LAUNCHED";

async function claimStartNotice(matchId: number, pairing: string, phase: MatchStartPhase): Promise<boolean> {
  const db = await getDatabase();
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_match_start_notices (match_id, pairing, phase) VALUES (?, ?, ?)`,
    [matchId, pairing, phase],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

async function startNoticeExists(matchId: number, pairing: string, phase: MatchStartPhase): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_start_notices WHERE match_id = ? AND pairing = ? AND phase = ? LIMIT 1`,
    [matchId, pairing, phase],
  );
  return rows.length > 0;
}

/**
 * Ce qu'il y a à annoncer pour un match :
 *
 * - en lancement → « Ton match commence, déclare-toi prêt » ;
 * - lancé → « Ton match est lancé », **seulement** s'il n'a pas été annoncé en
 *   lancement : un match lancé parce que tout le monde a cliqué « Prêt » n'a
 *   rien à apprendre à personne, et le téléphone ne sonne pas deux fois pour
 *   le même départ. Reste le lancement forcé par l'arbitrage, ou ouvert et
 *   lancé entre deux balayages.
 */
async function planStartNotice(row: StartingMatchRow): Promise<MatchStartPhase | null> {
  const matchId = Number(row.id);
  const pairing = String(row.launch_pairing);
  if (row.launched_at === null) {
    return (await claimStartNotice(matchId, pairing, "LOBBY")) ? "LOBBY" : null;
  }
  if (await startNoticeExists(matchId, pairing, "LOBBY")) return null;
  return (await claimStartNotice(matchId, pairing, "LAUNCHED")) ? "LAUNCHED" : null;
}

async function runMatchStartSweep(): Promise<number> {
  const db = await getDatabase();
  // L'appariement courant seulement : un état de lancement posé pour une paire
  // que le moteur a depuis remplacée ne compte pas (`currentLaunchState`).
  const [rows] = await db.query<StartingMatchRow[]>(
    `SELECT m.id, m.tournament_id, t.name AS tournament_name, t.participant_type,
            m.team1_id, m.team2_id, t1.name AS team1_name, t2.name AS team2_name,
            m.caster_user_id, m.launch_pairing, m.launched_at
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.status = 'READY' AND m.is_bye = 0
        AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)
        AND ((m.launched_at IS NULL AND m.lobby_opened_at > NOW() - INTERVAL ? MINUTE)
             OR m.launched_at > NOW() - INTERVAL ? MINUTE)
        AND NOT EXISTS (SELECT 1 FROM bg_match_start_notices n
                         WHERE n.match_id = m.id AND n.pairing = m.launch_pairing
                           AND (n.phase = 'LOBBY' OR m.launched_at IS NOT NULL))
      ORDER BY m.id`,
    [LOBBY_NOTICE_WINDOW_MINUTES, LAUNCH_NOTICE_WINDOW_MINUTES],
  );
  if (rows.length === 0) return 0;

  // Réservation d'abord, destinataires ensuite : c'est la réservation qui
  // interdit le doublon, la retarder d'une requête rouvrirait la fenêtre.
  const planned: { row: StartingMatchRow; phase: MatchStartPhase }[] = [];
  for (const row of rows) {
    const phase = await planStartNotice(row);
    if (phase) planned.push({ row, phase });
  }
  if (planned.length === 0) return 0;

  const players = await loadEntrantPlayerIds(
    planned.flatMap(({ row }) => [Number(row.team1_id), Number(row.team2_id)]),
  );

  let pushed = 0;
  for (const { row, phase } of planned) {
    const base = {
      tournamentId: Number(row.tournament_id),
      tournamentName: String(row.tournament_name),
      matchId: Number(row.id),
      solo: row.participant_type === "SOLO",
    };
    const sides = [
      { teamId: Number(row.team1_id), teamName: String(row.team1_name), opponentName: String(row.team2_name) },
      { teamId: Number(row.team2_id), teamName: String(row.team2_name), opponentName: String(row.team1_name) },
    ];
    // Un message par engagée : chacun lit « ton équipe contre l'autre ».
    for (const side of sides) {
      pushed += await pushTo(
        players.get(side.teamId) ?? [],
        "MATCH_START",
        matchStartPush({ ...base, teamName: side.teamName, opponentName: side.opponentName }, phase),
        true,
      );
    }
    // Le caster est une partie du lancement : son « Prêt » est attendu aussi.
    if (row.caster_user_id !== null) {
      pushed += await pushTo(
        [Number(row.caster_user_id)],
        "MATCH_START",
        matchStartPush({ ...base, teamName: sides[0].teamName, opponentName: sides[0].opponentName }, phase),
        true,
      );
    }
  }
  return pushed;
}

/**
 * Étranglement : dix secondes. Le balayage suit chaque évènement de tournoi, et
 * un plateau actif en publie plusieurs par seconde ; un départ annoncé dix
 * secondes plus tard ne se remarque pas.
 */
const MATCH_START_SWEEP_THROTTLE_MS = 10_000;
/** Ménage des abonnements oubliés — une fois par heure suffit largement. */
const PURGE_INTERVAL_MS = 60 * 60_000;

let lastSweepAt = 0;
let lastPurgeAt = 0;
let pendingSweep: Promise<number> | null = null;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Rejoue le balayage une fois l'étranglement écoulé. Un appel étranglé — ou
 * arrivé pendant un balayage déjà parti, dont la lecture a pu précéder le
 * lancement qu'on vient d'ouvrir — ne doit pas être **perdu** : sans cette
 * relève, l'annonce attendrait la prochaine écriture ou la prochaine lecture
 * de la liste, qui peuvent ne venir qu'après le lancement d'office. Un seul
 * minuteur à la fois, détaché du processus (`unref`).
 */
function scheduleTrailingSweep(delayMs: number): void {
  if (trailingTimer) return;
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    void dispatchMatchStartNotices();
  }, Math.max(0, delayMs));
  trailingTimer.unref?.();
}

/**
 * Annonce les départs de match dus. Jamais bloquant, jamais une exception :
 * l'appelant est une écriture déjà faite ou une lecture de page.
 */
export async function dispatchMatchStartNotices(): Promise<number> {
  // Push éteint (clés absentes) : rien à annoncer, et surtout rien à
  // **réserver** — une annonce réservée sans canal serait perdue pour de bon.
  if (!webPushConfig()) return 0;
  if (pendingSweep) {
    scheduleTrailingSweep(MATCH_START_SWEEP_THROTTLE_MS);
    return pendingSweep;
  }
  const sinceLast = Date.now() - lastSweepAt;
  if (sinceLast < MATCH_START_SWEEP_THROTTLE_MS) {
    scheduleTrailingSweep(MATCH_START_SWEEP_THROTTLE_MS - sinceLast);
    return 0;
  }
  pendingSweep = (async () => {
    try {
      if (Date.now() - lastPurgeAt >= PURGE_INTERVAL_MS) {
        lastPurgeAt = Date.now();
        await purgeStaleSubscriptions();
      }
      return await runMatchStartSweep();
    } catch (error) {
      if (!isMissingTableError(error)) console.error("[push] départs de match non annoncés", error);
      return 0;
    }
  })();
  try {
    return await pendingSweep;
  } finally {
    lastSweepAt = Date.now();
    pendingSweep = null;
  }
}

/** Remet l'étranglement à zéro. Réservé aux tests. */
export function resetMatchStartNoticeThrottle(): void {
  lastSweepAt = 0;
  lastPurgeAt = 0;
  pendingSweep = null;
  if (trailingTimer) clearTimeout(trailingTimer);
  trailingTimer = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Score à confirmer
// ─────────────────────────────────────────────────────────────────────────────

type ReportedMatchRow = RowDataPacket & {
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
  status: string;
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_reported_at: Date | string | null;
  team2_reported_at: Date | string | null;
};

/**
 * Prévient l'engagée qui n'a pas encore saisi son score que l'autre l'a fait —
 * **ceux qui peuvent y répondre** seulement (`loadEntrantManagerIds`) : confirmer
 * ou contester demande la qualité du forfait, `OWNER` ou `MANAGER`.
 * Appelé après le commit d'un report ; ne fait rien si la manche est déjà
 * tranchée (les deux reports concordaient) ou si les deux ont saisi (conflit —
 * c'est l'arbitrage qui est alors prévenu).
 */
export async function notifyScoreToConfirm(matchId: number): Promise<number> {
  if (!webPushConfig()) return 0;
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<ReportedMatchRow[]>(
      `SELECT m.tournament_id, t.name AS tournament_name, t.participant_type, m.status, m.team1_id, m.team2_id,
              t1.name AS team1_name, t2.name AS team2_name, m.team1_reported_at, m.team2_reported_at
         FROM bg_matches m
         JOIN bg_tournaments t ON t.id = m.tournament_id
         LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
         LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
        WHERE m.id = ? LIMIT 1`,
      [matchId],
    );
    const row = rows[0];
    if (!row || row.status !== "AWAITING_CONFIRMATION" || row.team1_id === null || row.team2_id === null) {
      return 0;
    }
    const team1Reported = row.team1_reported_at !== null;
    const team2Reported = row.team2_reported_at !== null;
    if (team1Reported === team2Reported) return 0;

    const waitingTeamId = Number(team1Reported ? row.team2_id : row.team1_id);
    const players = await loadEntrantManagerIds([waitingTeamId]);
    return pushTo(
      players.get(waitingTeamId) ?? [],
      "SCORE_TO_CONFIRM",
      scoreToConfirmPush({
        tournamentId: Number(row.tournament_id),
        tournamentName: String(row.tournament_name),
        matchId,
        teamName: String(team1Reported ? row.team2_name : row.team1_name),
        opponentName: String(team1Reported ? row.team1_name : row.team2_name),
        solo: row.participant_type === "SOLO",
      }),
      false,
    );
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[push] score à confirmer non annoncé", error);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coup d'envoi d'un tournoi
// ─────────────────────────────────────────────────────────────────────────────

/** Prévient les joueurs de toutes les engagées que le tournoi est lancé. */
export async function notifyTournamentStart(tournamentId: number): Promise<number> {
  if (!webPushConfig()) return 0;
  try {
    const db = await getDatabase();
    const [tournaments] = await db.execute<(RowDataPacket & { name: string })[]>(
      `SELECT name FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    if (tournaments.length === 0) return 0;
    const [registrations] = await db.execute<(RowDataPacket & { team_id: number })[]>(
      `SELECT team_id FROM bg_tournament_registrations WHERE tournament_id = ?`,
      [tournamentId],
    );
    const players = await loadEntrantPlayerIds(registrations.map((row) => Number(row.team_id)));
    return pushTo(
      [...new Set([...players.values()].flat())],
      "TOURNAMENT_START",
      tournamentStartPush({ tournamentId, tournamentName: String(tournaments[0].name) }),
      false,
    );
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[push] coup d'envoi non annoncé", error);
    return 0;
  }
}
