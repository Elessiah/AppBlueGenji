/**
 * Brief du salon (`MATCH_LOBBY_BRIEF`, `docs/features/MATCH_LOBBY_BRIEF.md`) :
 * quand le salon d'un match s'ouvre, ceux qui gèrent chaque engagée reçoivent
 * les réglages de la partie par message privé Discord et notification push.
 *
 * **Pourquoi un balayage.** Comme l'appel aux « Prêt » (`./player-pushes`),
 * l'ouverture du salon (`lobby_opened_at`) est posée par des transactions qui
 * n'ont pas à connaître les notifications. Le balayage relit après coup les
 * salons ouverts récemment, **réserve** le brief dans `bg_match_start_notices`
 * (phase `LOBBY_BRIEF`, une fois par match et par appariement — deux balayages
 * concurrents n'envoient qu'une fois), puis l'envoie. Mêmes déclencheurs que
 * les départs de match.
 *
 * **Indépendant du push** : le message privé part même quand les notifications
 * push sont éteintes (clés absentes). Bot injoignable : le push part quand même,
 * les comptes non joints sont dits dans pm2 (par nombre), sans nouvel essai —
 * la réservation reste, le brief ne part qu'une fois.
 *
 * Destinataires : `OWNER` et `MANAGER` de chaque équipe (`loadEntrantManagerIds`),
 * le joueur d'une entrée solo, personne pour une fantôme. Le message privé est
 * un message de match : l'interrupteur « messages privés de mes matchs » de
 * « Mon profil » le coupe, et seul un tag Discord certifié le reçoit ; le push a
 * son propre sujet.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { loadEntrantManagerIds, loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { formatLobbyBriefDm, type LobbyBriefSide } from "@/lib/shared/lobby-brief";
import { LAUNCH_AUTO_DELAY_MINUTES } from "@/lib/shared/match-launch";
import { matchPageHref } from "@/lib/shared/match-anchor";
import { matchHostTeamId, refereeDecision } from "@/lib/shared/match-referee";
import { lobbyBriefPush } from "@/lib/shared/push-messages";
import { loadEligibleRefereeIds } from "./cast-eligibility";
import { seedJoins } from "./match-host-seeds";
import { readMatchCasters } from "./player-pushes";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

/** Phase de la réservation dans `bg_match_start_notices`. */
export const LOBBY_BRIEF_PHASE = "LOBBY_BRIEF";

/**
 * Au-delà, un salon ouvert n'est plus briefé : le match est parti d'office
 * depuis longtemps. Même fenêtre que l'appel aux « Prêt ».
 */
const LOBBY_BRIEF_WINDOW_MINUTES = LAUNCH_AUTO_DELAY_MINUTES + 5;

export type LobbyBriefRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
  bracket: string;
  round_number: number;
  swiss_round: number | null;
  team1_id: number;
  team2_id: number;
  team1_name: string;
  team2_name: string;
  launch_pairing: string;
  host_team_id: number | null;
  team1_seed: number | null;
  team2_seed: number | null;
  first_map: string | null;
  self_managed: number;
  referee_user_id: number | null;
};

async function claimLobbyBrief(matchId: number, pairing: string): Promise<boolean> {
  const db = await getDatabase();
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_match_start_notices (match_id, pairing, phase) VALUES (?, ?, ?)`,
    [matchId, pairing, LOBBY_BRIEF_PHASE],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/**
 * Rend les réservations d'un balayage qui n'a pas pu lire ses destinataires :
 * une panne de base avant tout envoi ne doit pas perdre le brief pour de bon.
 */
async function releaseLobbyBriefs(rows: readonly LobbyBriefRow[]): Promise<void> {
  const db = await getDatabase();
  for (const row of rows) {
    await db.execute(`DELETE FROM bg_match_start_notices WHERE match_id = ? AND pairing = ? AND phase = ?`, [
      Number(row.id),
      String(row.launch_pairing),
      LOBBY_BRIEF_PHASE,
    ]);
  }
}

/** Les arbitres de la liste qui remplissent encore la condition ; une panne n'en compte aucun. */
async function readEligibleReferees(
  db: Awaited<ReturnType<typeof getDatabase>>,
  rows: readonly LobbyBriefRow[],
): Promise<Set<number>> {
  const ids = rows.flatMap((row) => (row.referee_user_id === null ? [] : [Number(row.referee_user_id)]));
  try {
    return await loadEligibleRefereeIds(db, ids);
  } catch (error) {
    console.error("[lobby-brief] lecture des arbitres impossible, brief sans arbitre", error);
    return new Set();
  }
}

/** Les deux côtés du brief d'un match : chaque engagée lit « ton équipe contre l'autre ». */
export function lobbyBriefSides(
  row: LobbyBriefRow,
  options: { cast: boolean; refereeEligible: boolean },
): { teamId: number; side: LobbyBriefSide }[] {
  const team1Id = Number(row.team1_id);
  const team2Id = Number(row.team2_id);
  const hostTeamId = matchHostTeamId(row.host_team_id === null ? null : Number(row.host_team_id), team1Id, team2Id, {
    team1: row.team1_seed === null ? null : Number(row.team1_seed),
    team2: row.team2_seed === null ? null : Number(row.team2_seed),
  });
  const base = {
    tournamentId: Number(row.tournament_id),
    tournamentName: String(row.tournament_name),
    matchId: Number(row.id),
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    swiss: isSwissRound(row),
    solo: row.participant_type === "SOLO",
    firstMap: row.first_map === null || row.first_map === "" ? null : String(row.first_map),
    cast: options.cast,
    decision: refereeDecision({
      refereeAssigned: row.referee_user_id !== null && options.refereeEligible,
      selfManaged: Number(row.self_managed ?? 0) === 1,
    }),
  };
  return [
    { teamId: team1Id, teamName: String(row.team1_name), opponentName: String(row.team2_name) },
    { teamId: team2Id, teamName: String(row.team2_name), opponentName: String(row.team1_name) },
  ].map(({ teamId, teamName, opponentName }) => ({
    teamId,
    side: { ...base, teamName, opponentName, hosting: teamId === hostTeamId },
  }));
}

/** Managers des engagées et casters des matchs réservés ; une panne rend les réservations, puis remonte. */
async function readBriefRecipients(
  db: Awaited<ReturnType<typeof getDatabase>>,
  planned: readonly LobbyBriefRow[],
): Promise<{ managers: Map<number, number[]>; castersByMatch: Map<number, number[]> }> {
  try {
    const managers = await loadEntrantManagerIds(planned.flatMap((row) => [Number(row.team1_id), Number(row.team2_id)]));
    const castersByMatch = await readMatchCasters(db, planned.map((row) => Number(row.id)));
    return { managers, castersByMatch };
  } catch (error) {
    // Rien n'est parti : on rend les réservations, le balayage suivant réessaie.
    await releaseLobbyBriefs(planned).catch((releaseError: unknown) =>
      console.error("[lobby-brief] réservations non rendues", releaseError),
    );
    throw error;
  }
}

/**
 * Envoie le brief d'une engagée. Un côté en échec n'empêche pas les autres :
 * leurs réservations sont prises. Rend `true` si l'envoi a eu lieu.
 */
async function sendSideBrief(matchId: number, userIds: number[], side: LobbyBriefSide, url: string): Promise<boolean> {
  try {
    const recipients = await loadNotificationRecipients(userIds, "certified", { matchDm: true });
    const report = await notifyUsers(recipients, {
      topic: "MATCH_LOBBY_BRIEF",
      discord: { message: (locale) => formatLobbyBriefDm(side, url, locale), context: "lobby-brief" },
      push: (locale) => lobbyBriefPush(side, locale),
    });
    if (report.discordUnreachedUserIds.length > 0) {
      console.error(
        `[lobby-brief] bot injoignable : brief du match ${matchId} non remis sur Discord à ${report.discordUnreachedUserIds.length} compte(s), sans nouvel essai`,
      );
    }
    return true;
  } catch (error) {
    console.error(`[lobby-brief] brief du match ${matchId} non envoyé à une engagée`, error);
    return false;
  }
}

async function runLobbyBriefSweep(): Promise<number> {
  const db = await getDatabase();
  // Appariement courant seulement, comme l'appel aux « Prêt » : un salon ouvert
  // pour une paire que le moteur a depuis remplacée ne compte pas.
  const [rows] = await db.query<LobbyBriefRow[]>(
    `SELECT m.id, m.tournament_id, t.name AS tournament_name, t.participant_type,
            m.bracket, m.round_number, ${swissRoundSql("m", "t")},
            m.team1_id, m.team2_id, t1.name AS team1_name, t2.name AS team2_name,
            m.launch_pairing, m.host_team_id, es1.rank AS team1_seed, es2.rank AS team2_seed,
            m.first_map, m.self_managed, m.referee_user_id
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
       ${seedJoins("m")}
      WHERE m.status = 'READY' AND m.is_bye = 0
        AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)
        AND m.lobby_opened_at > NOW() - INTERVAL ? MINUTE
        AND NOT EXISTS (SELECT 1 FROM bg_match_start_notices n
                         WHERE n.match_id = m.id AND n.pairing = m.launch_pairing AND n.phase = ?)
      ORDER BY m.id`,
    [LOBBY_BRIEF_WINDOW_MINUTES, LOBBY_BRIEF_PHASE],
  );
  if (rows.length === 0) return 0;

  // Réservation d'abord, destinataires ensuite : c'est elle qui interdit le doublon.
  const planned: LobbyBriefRow[] = [];
  for (const row of rows) {
    if (await claimLobbyBrief(Number(row.id), String(row.launch_pairing))) planned.push(row);
  }
  if (planned.length === 0) return 0;

  const { managers, castersByMatch } = await readBriefRecipients(db, planned);
  const referees = await readEligibleReferees(db, planned);

  let sent = 0;
  for (const row of planned) {
    const sides = lobbyBriefSides(row, {
      cast: (castersByMatch.get(Number(row.id)) ?? []).length > 0,
      refereeEligible: row.referee_user_id !== null && referees.has(Number(row.referee_user_id)),
    });
    const url = `${siteCanonicalBase()}${matchPageHref(Number(row.tournament_id), Number(row.id))}`;
    for (const { teamId, side } of sides) {
      const userIds = managers.get(teamId) ?? [];
      if (userIds.length === 0) continue;
      if (await sendSideBrief(Number(row.id), userIds, side, url)) sent += 1;
    }
  }
  return sent;
}

/** Étranglement : celui des départs de match (dix secondes). */
const LOBBY_BRIEF_THROTTLE_MS = 10_000;

let lastSweepAt = 0;
let pendingSweep: Promise<number> | null = null;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

/** Rejoue le balayage une fois l'étranglement écoulé : un appel étranglé n'est pas perdu. */
function scheduleTrailingSweep(delayMs: number): void {
  if (trailingTimer) return;
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    void dispatchLobbyBriefs();
  }, Math.max(0, delayMs));
  trailingTimer.unref?.();
}

/**
 * Envoie les briefs dus. Jamais bloquant, jamais une exception : l'appelant est
 * une écriture déjà faite ou une lecture de page.
 *
 * @returns le nombre d'engagées briefées.
 */
export async function dispatchLobbyBriefs(): Promise<number> {
  if (pendingSweep) {
    scheduleTrailingSweep(LOBBY_BRIEF_THROTTLE_MS);
    return pendingSweep;
  }
  const sinceLast = Date.now() - lastSweepAt;
  if (sinceLast < LOBBY_BRIEF_THROTTLE_MS) {
    scheduleTrailingSweep(LOBBY_BRIEF_THROTTLE_MS - sinceLast);
    return 0;
  }
  pendingSweep = (async () => {
    try {
      return await runLobbyBriefSweep();
    } catch (error) {
      if (!isMissingTableError(error)) console.error("[lobby-brief] briefs du salon non envoyés", error);
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
export function resetLobbyBriefThrottle(): void {
  lastSweepAt = 0;
  pendingSweep = null;
  if (trailingTimer) clearTimeout(trailingTimer);
  trailingTimer = null;
}
