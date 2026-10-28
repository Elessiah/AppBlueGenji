/**
 * Brief du salon (`MATCH_LOBBY_BRIEF`, `docs/features/MATCH_LOBBY_BRIEF.md`) :
 * quand le salon d'un match s'ouvre, ceux qui gèrent chaque engagée reçoivent
 * les réglages de la partie par message privé Discord et notification push.
 *
 * **Pourquoi un balayage.** Comme l'appel aux « Prêt » (`./player-pushes`),
 * l'ouverture du salon (`lobby_opened_at`) est posée par des transactions qui
 * n'ont pas à connaître les notifications. Le balayage relit après coup les
 * salons ouverts récemment, **réserve** le brief dans `bg_match_start_notices`
 * (phases `LOBBY_BRIEF_1` / `LOBBY_BRIEF_2`, une par engagée et par appariement — deux balayages
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
import {
  effectiveFirstMap,
  firstBanTeamFor,
  parseFirstBanRule,
  parseMapPicks,
  parseNextBanRule,
  parseNextPickRule,
  parseStoredSlots,
  resolveMatchMaps,
} from "@/lib/shared/round-maps";
import { loadEligibleRefereeIds } from "./cast-eligibility";
import { seedJoins } from "./match-host-seeds";
import { readMatchCasters } from "./player-pushes";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

/** Place d'une engagée dans le match (`team1_id` / `team2_id`). */
export type LobbyBriefSlot = 1 | 2;

/**
 * Phase de la réservation dans `bg_match_start_notices`, une par engagée : un
 * côté en échec rend la sienne sans toucher à l'autre (16 caractères au plus).
 */
export function lobbyBriefPhase(slot: LobbyBriefSlot): string {
  return `LOBBY_BRIEF_${slot}`;
}

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
  /** Cartes choisies au-delà de la carte 1, et créneaux de la manche (`ROUND_MAPS.md`). */
  map_picks?: string | null;
  round_slots_json?: string | null;
  first_ban_rule?: string | null;
  next_ban_rule?: string | null;
  next_pick_rule?: string | null;
};

/**
 * Un match qui porte déjà un score est joué : le staff qui le replanifie ou
 * allume l'arbitrage planifié le tient pour lancé (`lobby_opened_at` posé,
 * `match-schedule`, `referee-scheduling`), sans qu'aucun salon ne s'ouvre.
 */
const NO_SCORE_SQL = "AND m.team1_score IS NULL AND m.team2_score IS NULL";

type Db = Awaited<ReturnType<typeof getDatabase>>;
type ClaimedSide = { row: LobbyBriefRow; slot: LobbyBriefSlot };

/**
 * Réserve un côté **si le salon est toujours ouvert pour cet appariement** :
 * la condition relit le match dans l'instruction même. Entre la lecture des
 * candidats et la réservation, un lancement défait (`match-schedule`,
 * `referee-scheduling`) efface les réservations et referme le salon ; une
 * réservation posée après coup enverrait des réglages périmés, puis ferait
 * taire le brief de la réouverture (même appariement). Et l'appariement doit
 * rester celui des équipes du match : un réappariement (suisse, survie, BG
 * Survie) change `team1_id` / `team2_id` sans toucher `launch_pairing` — le
 * brief partirait aux managers d'équipes qui ne jouent plus ce match.
 */
async function claimLobbyBrief(db: Db, claim: ClaimedSide): Promise<boolean> {
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_match_start_notices (match_id, pairing, phase)
     SELECT m.id, m.launch_pairing, ? FROM bg_matches m
      WHERE m.id = ? AND m.launch_pairing = ? AND m.status = 'READY' AND m.is_bye = 0
        AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)
        AND m.lobby_opened_at IS NOT NULL ${NO_SCORE_SQL}`,
    [lobbyBriefPhase(claim.slot), Number(claim.row.id), String(claim.row.launch_pairing)],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/**
 * Réserve chaque côté encore libre. Une panne en cours de route rend ce qui a
 * déjà été pris, puis remonte : rien n'est parti.
 */
async function claimLobbyBriefs(db: Db, rows: readonly LobbyBriefRow[]): Promise<ClaimedSide[]> {
  const claimed: ClaimedSide[] = [];
  try {
    for (const row of rows) {
      for (const slot of [1, 2] as const) {
        if (await claimLobbyBrief(db, { row, slot })) claimed.push({ row, slot });
      }
    }
    return claimed;
  } catch (error) {
    await releaseQuietly(db, claimed);
    throw error;
  }
}

/**
 * Rend des réservations dont le brief n'est pas parti : une panne de base ne
 * doit pas le perdre pour de bon, le balayage suivant réessaie. Une seule
 * instruction : tout est rendu, ou rien. Jamais d'exception (journal pm2).
 */
async function releaseQuietly(db: Db, claims: readonly ClaimedSide[]): Promise<void> {
  if (claims.length === 0) return;
  try {
    await db.execute(
      `DELETE FROM bg_match_start_notices
        WHERE ${claims.map(() => "(match_id = ? AND pairing = ? AND phase = ?)").join(" OR ")}`,
      claims.flatMap((claim) => [Number(claim.row.id), String(claim.row.launch_pairing), lobbyBriefPhase(claim.slot)]),
    );
  } catch (error) {
    console.error("[lobby-brief] réservations non rendues", error);
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
  const slots = parseStoredSlots(row.round_slots_json);
  const storedFirstMap = row.first_map === null || row.first_map === "" ? null : String(row.first_map);
  const banFirstTeamId = firstBanTeamFor(parseFirstBanRule(row.first_ban_rule), hostTeamId, team1Id, team2Id);
  const base = {
    tournamentId: Number(row.tournament_id),
    tournamentName: String(row.tournament_name),
    matchId: Number(row.id),
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    swiss: isSwissRound(row),
    solo: row.participant_type === "SOLO",
    firstMap: effectiveFirstMap(slots, storedFirstMap),
    maps: resolveMatchMaps(slots, storedFirstMap, parseMapPicks(row.map_picks)),
    nextBan: parseNextBanRule(row.next_ban_rule),
    nextPick: parseNextPickRule(row.next_pick_rule),
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
    side: { ...base, teamName, opponentName, hosting: teamId === hostTeamId, banFirst: teamId === banFirstTeamId },
  }));
}

/** Managers des engagées réservées ; une panne rend les réservations, puis remonte. */
async function readBriefManagers(
  db: Db,
  claims: readonly ClaimedSide[],
  teamIds: readonly number[],
): Promise<Map<number, number[]>> {
  try {
    return await loadEntrantManagerIds(teamIds);
  } catch (error) {
    await releaseQuietly(db, claims);
    throw error;
  }
}

/**
 * Envoie le brief d'une engagée ; un côté en échec n'empêche pas les autres.
 *
 * - `"sent"` : parti ;
 * - `"retry"` : la lecture des destinataires a échoué, **rien** n'est parti — la
 *   réservation de ce côté peut être rendue ;
 * - `"failed"` : l'envoi a levé, une partie a pu partir (le push et le message
 *   privé partent ensemble) — la réservation reste, pour ne jamais envoyer
 *   deux fois.
 */
async function sendSideBrief(
  matchId: number,
  userIds: number[],
  side: LobbyBriefSide,
  url: string,
): Promise<"sent" | "retry" | "failed"> {
  let recipients: Awaited<ReturnType<typeof loadNotificationRecipients>>;
  try {
    recipients = await loadNotificationRecipients(userIds, "certified", { matchDm: true });
  } catch (error) {
    console.error(`[lobby-brief] destinataires du match ${matchId} illisibles, brief remis au balayage suivant`, error);
    return "retry";
  }
  try {
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
    return "sent";
  } catch (error) {
    console.error(`[lobby-brief] brief du match ${matchId} non envoyé à une engagée, sans nouvel essai`, error);
    return "failed";
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
            m.first_map, m.self_managed, m.referee_user_id, m.map_picks,
            t.first_ban_rule, t.next_ban_rule, t.next_pick_rule,
            (SELECT rm.slots_json FROM bg_tournament_round_maps rm
              WHERE rm.tournament_id = m.tournament_id AND rm.phase_id = m.phase_id
                AND rm.bracket = m.bracket AND rm.round_number = m.round_number) AS round_slots_json
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
       ${seedJoins("m")}
      WHERE m.status = 'READY' AND m.is_bye = 0
        AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)
        AND m.lobby_opened_at > NOW() - INTERVAL ? MINUTE ${NO_SCORE_SQL}
        AND (SELECT COUNT(*) FROM bg_match_start_notices n
              WHERE n.match_id = m.id AND n.pairing = m.launch_pairing AND n.phase IN (?, ?)) < 2
      ORDER BY m.id`,
    [LOBBY_BRIEF_WINDOW_MINUTES, lobbyBriefPhase(1), lobbyBriefPhase(2)],
  );
  if (rows.length === 0) return 0;

  // Réservation d'abord, destinataires ensuite : c'est elle qui interdit le doublon.
  const claims = await claimLobbyBriefs(db, rows);
  if (claims.length === 0) return 0;

  const planned = [...new Set(claims.map((claim) => claim.row))];
  // Ces deux lectures ne lèvent pas : une panne envoie le brief sans la ligne.
  const castersByMatch = await readMatchCasters(db, planned.map((row) => Number(row.id)));
  const referees = await readEligibleReferees(db, planned);
  // Une fois par match : les deux côtés et le lien ; un côté réservé y lit le sien.
  const briefs = new Map(
    planned.map((row) => [
      row,
      {
        sides: lobbyBriefSides(row, {
          cast: (castersByMatch.get(Number(row.id)) ?? []).length > 0,
          refereeEligible: row.referee_user_id !== null && referees.has(Number(row.referee_user_id)),
        }),
        url: `${siteCanonicalBase()}${matchPageHref(Number(row.tournament_id), Number(row.id))}`,
      },
    ]),
  );
  const sideOf = ({ row, slot }: ClaimedSide) => briefs.get(row)!.sides[slot - 1];
  const managers = await readBriefManagers(
    db,
    claims,
    claims.map((claim) => sideOf(claim).teamId),
  );

  let sent = 0;
  for (const claim of claims) {
    const { teamId, side } = sideOf(claim);
    // Fantôme : personne, la réservation reste.
    const userIds = managers.get(teamId) ?? [];
    if (userIds.length === 0) continue;
    const outcome = await sendSideBrief(Number(claim.row.id), userIds, side, briefs.get(claim.row)!.url);
    if (outcome === "sent") sent += 1;
    // Rien n'est parti pour ce côté : il rend sa réservation, l'autre garde la sienne.
    else if (outcome === "retry") await releaseQuietly(db, [claim]);
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
