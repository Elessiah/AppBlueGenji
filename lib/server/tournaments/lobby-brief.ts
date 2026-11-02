/**
 * Brief du salon (`MATCH_LOBBY_BRIEF`, `docs/features/MATCH_LOBBY_BRIEF.md`) :
 * quand le salon d'un match s'ouvre, ceux qui gèrent chaque engagée reçoivent
 * les réglages de la partie par message privé Discord et notification push.
 *
 * **Pourquoi un balayage.** Comme l'appel aux « Prêt » (`./player-pushes`),
 * l'ouverture du salon (`lobby_opened_at`) est posée par des transactions qui
 * n'ont pas à connaître les notifications. Le balayage relit après coup les
 * salons ouverts récemment, lit d'un coup les destinataires de tous les côtés,
 * puis, **côté par côté**, réserve le brief dans `bg_match_start_notices`
 * (phases `LOBBY_BRIEF_1` / `LOBBY_BRIEF_2`, une par engagée et par
 * appariement — deux balayages concurrents n'envoient qu'une fois), relit les
 * réglages du match et l'envoie : un arrêt du processus entre deux côtés ne
 * laisse au plus qu'une réservation sans envoi. Mêmes déclencheurs que les
 * départs de match.
 *
 * **Indépendant du push** : le message privé part même quand les notifications
 * push sont éteintes (clés absentes). Bot injoignable : le push part quand même,
 * les comptes non joints sont dits dans pm2 (par nombre), sans nouvel essai —
 * la réservation reste, le brief ne part qu'une fois. Un côté dont personne
 * n'a rien reçu (messages privés coupés, tag non certifié, push éteint) n'est
 * pas compté comme briefé, et pm2 le dit.
 *
 * Destinataires : `OWNER` et `MANAGER` de chaque équipe (`loadEntrantManagerIds`),
 * le joueur d'une entrée solo, personne pour une fantôme (réservation gardée).
 * Une vraie équipe sans gestionnaire actif n'est pas réservée : pm2 le dit une
 * fois, et un manager ajouté dans la fenêtre est briefé. Le message privé est
 * un message de match : l'interrupteur « messages privés de mes matchs » de
 * « Mon profil » le coupe, et seul un tag Discord certifié le reçoit ; le push a
 * son propre sujet.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import {
  loadEntrantManagerIds,
  loadNotificationRecipients,
  notifyUsers,
  type NotificationRecipient,
} from "@/lib/server/notify";
import { siteUrl } from "@/lib/server/site-url";
import { throttledSweep } from "@/lib/server/throttled-sweep";
import type { LobbyBriefSide } from "@/lib/shared/lobby-brief";
import { LOCALES, type Locale } from "@/lib/shared/locales";
import type { PushContent } from "@/lib/shared/push-notifications";
import type { TournamentGame } from "@/lib/shared/types";
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
  parseStoredSlots,
  parseStoredTiebreak,
  resolveMatchMaps,
} from "@/lib/shared/round-maps";
import { parseMatchFormat } from "@/lib/shared/match-format";
import { roundAllowsTiebreak } from "@/lib/shared/round-plan";
import type { PhaseFormat, TournamentFormat } from "@/lib/shared/types";
import { loadEligibleRefereeIds } from "./cast-eligibility";
import { formatLobbyBriefDm } from "./lobby-brief-dm";
import { seedJoins } from "./match-host-seeds";
import { activeMemberSql } from "./match-players";
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
  game: TournamentGame;
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
  /** Déjà lancé (lancement forcé, ou tous « Prêt » avant le balayage) : le brief dit « lancé ». */
  launched_at?: Date | string | null;
  /** Engagées fantômes (`is_ghost`) : personne à briefer de ce côté. */
  team1_ghost?: number | null;
  team2_ghost?: number | null;
  /**
   * L'arbitre désigné est devenu membre actif (ou joueur solo) d'une des deux
   * engagées depuis sa désignation : le brief n'annonce pas un arbitre qui joue.
   */
  referee_plays?: number | null;
  /** Cartes choisies au-delà de la carte 1, et créneaux de la manche (`ROUND_MAPS.md`). */
  map_picks?: string | null;
  round_slots_json?: string | null;
  first_ban_rule?: string | null;
  next_ban_rule?: string | null;
  /** Map de départage du tour et ce qui dit si elle s'applique (play-offs en vrai best of 3). */
  round_tiebreak_map?: string | null;
  phase_id?: number | null;
  phase_format?: PhaseFormat | null;
  tournament_format?: TournamentFormat | null;
  match_format_type?: "BO" | "FT" | null;
  match_format_value?: number | null;
  match_format_max_maps?: number | null;
  match_format_draws?: number | null;
  endurance_playoff_format_type?: "BO" | "FT" | null;
  endurance_playoff_format_value?: number | null;
};

/**
 * Map de départage annoncée au brief : celle du tour, si le tour s'y prête
 * encore (format relu avec le match, `roundAllowsTiebreak`) ; `null` sinon.
 */
export function briefTiebreakMap(row: LobbyBriefRow): string | null {
  const map = parseStoredTiebreak(row.round_tiebreak_map);
  if (map === null || !row.tournament_format) return null;
  const phaseId = Number(row.phase_id ?? 0);
  const allowed = roundAllowsTiebreak(
    {
      format: row.tournament_format,
      matchFormat: parseMatchFormat(
        row.match_format_type ?? null,
        row.match_format_value ?? null,
        row.match_format_max_maps ?? null,
        row.match_format_draws ?? null,
      ),
      endurancePlayoffFormat: parseMatchFormat(
        row.endurance_playoff_format_type ?? null,
        row.endurance_playoff_format_value ?? null,
      ),
      phases: row.phase_format ? [{ id: phaseId, format: row.phase_format }] : null,
    },
    { phaseId, bracket: String(row.bracket), roundNumber: Number(row.round_number) },
  );
  return allowed ? map : null;
}

/**
 * Un match qui porte déjà un score est joué : le staff qui le replanifie ou
 * allume l'arbitrage planifié le tient pour lancé (`lobby_opened_at` posé,
 * `match-schedule`, `referee-scheduling`), sans qu'aucun salon ne s'ouvre.
 */
const NO_SCORE_SQL = "AND m.team1_score IS NULL AND m.team2_score IS NULL";

type Db = Awaited<ReturnType<typeof getDatabase>>;

/** Colonnes du brief, lues pour les candidats puis relues après chaque réservation. */
const BRIEF_COLUMNS = `m.id, m.tournament_id, t.name AS tournament_name, t.participant_type, t.game,
            m.bracket, m.round_number, ${swissRoundSql("m", "t")},
            m.team1_id, m.team2_id, t1.name AS team1_name, t2.name AS team2_name,
            t1.is_ghost AS team1_ghost, t2.is_ghost AS team2_ghost,
            m.launch_pairing, m.launched_at, m.host_team_id, es1.rank AS team1_seed, es2.rank AS team2_seed,
            m.first_map, m.self_managed, m.referee_user_id, m.map_picks,
            (m.referee_user_id IS NOT NULL
              AND (m.referee_user_id IN (t1.solo_user_id, t2.solo_user_id)
                OR EXISTS (SELECT 1 FROM bg_team_members tm
                            WHERE tm.user_id = m.referee_user_id AND tm.team_id IN (m.team1_id, m.team2_id)
                              AND ${activeMemberSql("tm")}))) AS referee_plays,
            t.first_ban_rule, t.next_ban_rule,
            (SELECT rm.slots_json FROM bg_tournament_round_maps rm
              WHERE rm.tournament_id = m.tournament_id AND rm.phase_id = m.phase_id
                AND rm.bracket = m.bracket AND rm.round_number = m.round_number) AS round_slots_json,
            (SELECT rm.tiebreak_map FROM bg_tournament_round_maps rm
              WHERE rm.tournament_id = m.tournament_id AND rm.phase_id = m.phase_id
                AND rm.bracket = m.bracket AND rm.round_number = m.round_number) AS round_tiebreak_map,
            m.phase_id, t.format AS tournament_format,
            (SELECT p.format FROM bg_tournament_phases p WHERE p.id = m.phase_id) AS phase_format,
            t.match_format_type, t.match_format_value, t.match_format_max_maps, t.match_format_draws,
            t.endurance_playoff_format_type, t.endurance_playoff_format_value`;

const BRIEF_FROM = `FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
       ${seedJoins("m")}`;

/**
 * Salon ouvert pour l'appariement courant, comme l'appel aux « Prêt » : un
 * salon ouvert pour une paire que le moteur a depuis remplacée ne compte pas.
 */
const OPEN_LOBBY_SQL = `m.status = 'READY' AND m.is_bye = 0
        AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)
        AND m.lobby_opened_at IS NOT NULL ${NO_SCORE_SQL}`;

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
 *
 * @returns l'id de la réservation posée, `null` si le côté était déjà pris
 *   (ou le salon refermé). Une instruction qui lève a pu écrire avant que la
 *   connexion ne tombe : la réservation de ce côté est rendue par sa clé, puis
 *   l'erreur remonte — sinon ce côté ne serait jamais briefé pour cet appariement.
 */
async function claimLobbyBrief(db: Db, row: LobbyBriefRow, slot: LobbyBriefSlot): Promise<number | null> {
  const key = [Number(row.id), String(row.launch_pairing), lobbyBriefPhase(slot)];
  try {
    const [result] = await db.execute(
      `INSERT IGNORE INTO bg_match_start_notices (match_id, pairing, phase)
       SELECT m.id, m.launch_pairing, ? FROM bg_matches m
        WHERE m.id = ? AND m.launch_pairing = ? AND ${OPEN_LOBBY_SQL}`,
      [key[2], key[0], key[1]],
    );
    const { affectedRows, insertId } = result as { affectedRows?: number; insertId?: number };
    return affectedRows === 1 && insertId ? Number(insertId) : null;
  } catch (error) {
    try {
      await db.execute(`DELETE FROM bg_match_start_notices WHERE match_id = ? AND pairing = ? AND phase = ?`, key);
    } catch (releaseError) {
      console.error(`[lobby-brief] réservation interrompue du match ${key[0]} non rendue`, releaseError);
    }
    throw error;
  }
}

/**
 * Rend des réservations dont le brief n'est pas parti, **par leur id** : avec
 * deux processus, une réservation reprise par l'autre après un lancement
 * défait puis rouvert n'est jamais effacée (le brief partirait deux fois).
 * Une seule instruction : tout est rendu, ou rien. Jamais d'exception.
 *
 * @returns `true` si les réservations sont rendues.
 */
async function releaseQuietly(db: Db, claimIds: readonly number[]): Promise<boolean> {
  if (claimIds.length === 0) return true;
  try {
    await db.execute(
      `DELETE FROM bg_match_start_notices WHERE id IN (${claimIds.map(() => "?").join(", ")})`,
      [...claimIds],
    );
    return true;
  } catch (error) {
    console.error("[lobby-brief] réservations non rendues", error);
    return false;
  }
}

/** Les arbitres de la liste qui remplissent encore la condition ; une panne n'en compte aucun. */
async function readEligibleReferees(db: Db, ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  try {
    return await loadEligibleRefereeIds(db, ids);
  } catch (error) {
    console.error("[lobby-brief] lecture des arbitres impossible, brief sans arbitre", error);
    return new Set();
  }
}

/**
 * Les deux côtés du brief d'un match : chaque engagée lit « ton équipe contre
 * l'autre ». `refereeAssigned` : un arbitre est désigné, remplit la condition
 * et ne joue pas le match.
 */
export function lobbyBriefSides(
  row: LobbyBriefRow,
  options: { cast: boolean; refereeAssigned: boolean },
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
    game: row.game,
    solo: row.participant_type === "SOLO",
    launched: (row.launched_at ?? null) !== null,
    firstMap: effectiveFirstMap(slots, storedFirstMap),
    maps: resolveMatchMaps(slots, storedFirstMap, parseMapPicks(row.map_picks)),
    tiebreakMap: briefTiebreakMap(row),
    nextBan: parseNextBanRule(row.next_ban_rule),
    cast: options.cast,
    decision: refereeDecision({
      refereeAssigned: options.refereeAssigned,
      selfManaged: Number(row.self_managed ?? 0) === 1,
    }),
  };
  return [
    {
      teamId: team1Id,
      teamName: String(row.team1_name),
      opponentName: String(row.team2_name),
      opponentGhost: Number(row.team2_ghost ?? 0) === 1,
    },
    {
      teamId: team2Id,
      teamName: String(row.team2_name),
      opponentName: String(row.team1_name),
      opponentGhost: Number(row.team1_ghost ?? 0) === 1,
    },
  ].map(({ teamId, teamName, opponentName, opponentGhost }) => ({
    teamId,
    side: {
      ...base,
      teamName,
      opponentName,
      opponentGhost,
      hosting: teamId === hostTeamId,
      banFirst: teamId === banFirstTeamId,
    },
  }));
}

/**
 * Relit les réglages du match juste réservé : hôte, cartes, arbitre et
 * autogestion ont pu changer entre la lecture des candidats et la réservation.
 * Une relecture vide (salon refermé dans l'intervalle) ou en panne garde la
 * lecture des candidats — la page du match, liée, porte les réglages à jour.
 */
async function rereadBriefRow(db: Db, row: LobbyBriefRow): Promise<LobbyBriefRow> {
  try {
    const [rows] = await db.query<LobbyBriefRow[]>(
      `SELECT ${BRIEF_COLUMNS} ${BRIEF_FROM} WHERE m.id = ? AND m.launch_pairing = ? AND ${OPEN_LOBBY_SQL}`,
      [Number(row.id), String(row.launch_pairing)],
    );
    return rows[0] ?? row;
  } catch (error) {
    console.error(`[lobby-brief] réglages du match ${Number(row.id)} non relus, brief sur la lecture des candidats`, error);
    return row;
  }
}

/**
 * Issue de l'envoi d'un côté :
 *
 * - `"sent"` : parti, et quelqu'un l'a reçu (message privé remis ou appareil atteint) ;
 * - `"unreached"` : parti à personne (messages privés coupés, tag non certifié,
 *   push éteint) — dit dans pm2, la réservation reste ;
 * - `"retry"` : le message n'a pas pu être rédigé, **rien** n'est parti — la
 *   réservation de ce côté est rendue ;
 * - `"failed"` : l'envoi a levé, une partie a pu partir (le push et le message
 *   privé partent ensemble) — la réservation reste, pour ne jamais envoyer
 *   deux fois.
 */
type SideOutcome = "sent" | "unreached" | "retry" | "failed";

/** Les deux textes dans chaque langue, rédigés avant tout envoi : un rédacteur qui lève n'envoie rien. */
function renderSideBrief(
  side: LobbyBriefSide,
  url: string | null,
): { dm: Record<Locale, string>; push: Record<Locale, PushContent> } {
  const dm = {} as Record<Locale, string>;
  const push = {} as Record<Locale, PushContent>;
  for (const locale of LOCALES) {
    dm[locale] = formatLobbyBriefDm(side, url, locale);
    push[locale] = lobbyBriefPush(side, locale);
  }
  return { dm, push };
}

async function sendSideBrief(
  matchId: number,
  recipients: readonly NotificationRecipient[],
  side: LobbyBriefSide,
  url: string | null,
): Promise<SideOutcome> {
  let rendered: ReturnType<typeof renderSideBrief>;
  try {
    rendered = renderSideBrief(side, url);
  } catch (error) {
    console.error(`[lobby-brief] brief du match ${matchId} non rédigé, rien n'est parti`, error);
    return "retry";
  }
  try {
    const report = await notifyUsers(recipients, {
      topic: "MATCH_LOBBY_BRIEF",
      discord: { message: (locale) => rendered.dm[locale], context: "lobby-brief" },
      push: (locale) => rendered.push[locale],
    });
    if (report.discordUnreachedUserIds.length > 0) {
      console.error(
        `[lobby-brief] bot injoignable : brief du match ${matchId} non remis sur Discord à ${report.discordUnreachedUserIds.length} compte(s), sans nouvel essai`,
      );
    }
    if ((report.discord?.sent ?? 0) + report.pushed > 0) return "sent";
    console.error(
      `[lobby-brief] brief du match ${matchId} reçu par personne d'une engagée (messages privés coupés, tag non certifié ou push éteint)`,
    );
    return "unreached";
  } catch (error) {
    console.error(`[lobby-brief] brief du match ${matchId} non envoyé à une engagée, sans nouvel essai`, error);
    return "failed";
  }
}

/** Une même équipe sans gestionnaire n'est dite qu'une fois dans pm2 par appariement. */
const NO_MANAGER_LOGGED = new Set<string>();
const NO_MANAGER_LOGGED_MAX = 1000;

function logNoManager(row: LobbyBriefRow, slot: LobbyBriefSlot): void {
  const key = `${Number(row.id)}:${String(row.launch_pairing)}:${slot}`;
  if (NO_MANAGER_LOGGED.has(key)) return;
  if (NO_MANAGER_LOGGED.size >= NO_MANAGER_LOGGED_MAX) NO_MANAGER_LOGGED.clear();
  NO_MANAGER_LOGGED.add(key);
  console.error(
    `[lobby-brief] match ${Number(row.id)} : une engagée n'a aucun gestionnaire actif (OWNER/MANAGER), brief en attente d'un gestionnaire`,
  );
}

/** Ce qu'un balayage a lu une fois pour tous les matchs candidats. */
type SweepContext = {
  managers: Map<number, number[]>;
  recipients: readonly NotificationRecipient[];
  briefSides: (row: LobbyBriefRow) => Promise<{ teamId: number; side: LobbyBriefSide }[]>;
};

/**
 * Brief des deux côtés d'un match, **côté par côté** : réservation, relecture
 * des réglages (une fois par match), envoi. Rend le nombre de côtés briefés ;
 * les réservations à rendre (rien n'est parti) vont dans `toRelease` au fil
 * de l'eau, pour être rendues même si un côté suivant lève.
 */
async function briefMatch(db: Db, row: LobbyBriefRow, context: SweepContext, toRelease: number[]): Promise<number> {
  let sent = 0;
  let sides: { teamId: number; side: LobbyBriefSide }[] | null = null;
  for (const slot of [1, 2] as const) {
    const teamId = Number(slot === 1 ? row.team1_id : row.team2_id);
    const ghost = Number((slot === 1 ? row.team1_ghost : row.team2_ghost) ?? 0) === 1;
    const userIds = context.managers.get(teamId) ?? [];
    // Vraie équipe sans gestionnaire : pas de réservation, un manager
    // ajouté dans la fenêtre sera briefé au balayage suivant.
    if (!ghost && userIds.length === 0) {
      logNoManager(row, slot);
      continue;
    }
    const claimId = await claimLobbyBrief(db, row, slot);
    // Fantôme : personne à briefer, la réservation reste.
    if (claimId === null || ghost) continue;
    sides ??= await context.briefSides(await rereadBriefRow(db, row));
    const outcome = await sendSideBrief(
      Number(row.id),
      context.recipients.filter((recipient) => userIds.includes(recipient.userId)),
      sides[slot - 1].side,
      siteUrl(matchPageHref(Number(row.tournament_id), Number(row.id))),
    );
    if (outcome === "sent") sent += 1;
    else if (outcome === "retry") toRelease.push(claimId);
  }
  return sent;
}

async function runLobbyBriefSweep(): Promise<number> {
  const db = await getDatabase();
  const [rows] = await db.query<LobbyBriefRow[]>(
    `SELECT ${BRIEF_COLUMNS} ${BRIEF_FROM}
      WHERE ${OPEN_LOBBY_SQL}
        AND m.lobby_opened_at > NOW() - INTERVAL ? MINUTE
        AND (SELECT COUNT(*) FROM bg_match_start_notices n
              WHERE n.match_id = m.id AND n.pairing = m.launch_pairing AND n.phase IN (?, ?)) < 2
      ORDER BY m.id`,
    [LOBBY_BRIEF_WINDOW_MINUTES, lobbyBriefPhase(1), lobbyBriefPhase(2)],
  );
  if (rows.length === 0) return 0;

  // Destinataires de tous les côtés en deux lectures, **avant** toute
  // réservation : une panne ici ne réserve rien, le balayage suivant réessaie.
  const managers = await loadEntrantManagerIds(rows.flatMap((row) => [Number(row.team1_id), Number(row.team2_id)]));
  const recipients = await loadNotificationRecipients([...managers.values()].flat(), "certified", { matchDm: true });
  // Ces lectures ne lèvent pas : une panne envoie le brief sans la ligne.
  const castersByMatch = await readMatchCasters(db, rows.map((row) => Number(row.id)));
  const refereeIdsOf = (list: readonly LobbyBriefRow[]) =>
    list.flatMap((row) => (row.referee_user_id === null ? [] : [Number(row.referee_user_id)]));
  const checkedReferees = new Set(refereeIdsOf(rows));
  const eligibleReferees = await readEligibleReferees(db, [...checkedReferees]);

  /** Les deux côtés d'un match relu ; un arbitre désigné depuis la première lecture est lu à part. */
  const briefSides = async (row: LobbyBriefRow) => {
    const unread = refereeIdsOf([row]).filter((id) => !checkedReferees.has(id));
    for (const id of unread) checkedReferees.add(id);
    for (const id of await readEligibleReferees(db, unread)) eligibleReferees.add(id);
    const refereeId = row.referee_user_id === null ? null : Number(row.referee_user_id);
    return lobbyBriefSides(row, {
      cast: (castersByMatch.get(Number(row.id)) ?? []).length > 0,
      refereeAssigned: refereeId !== null && eligibleReferees.has(refereeId) && Number(row.referee_plays ?? 0) !== 1,
    });
  };

  let sent = 0;
  const toRelease: number[] = [];
  try {
    for (const row of rows) {
      sent += await briefMatch(db, row, { managers, recipients, briefSides }, toRelease);
    }
  } finally {
    // Rien n'est parti pour ces côtés : leurs réservations sont rendues en un
    // lot, et le balayage suivant est armé (dans la limite des relances).
    if (toRelease.length > 0 && (await releaseQuietly(db, toRelease))) {
      console.error(`[lobby-brief] ${toRelease.length} brief(s) remis au balayage suivant`);
      scheduleRetrySweep();
    } else if (toRelease.length === 0) {
      retryStreak = 0;
    }
  }
  return sent;
}

/** Étranglement : celui des départs de match (dix secondes). */
const LOBBY_BRIEF_THROTTLE_MS = 10_000;
/**
 * Relances armées d'affilée après un rendu : au-delà, le brief attend un autre
 * déclencheur (une panne durable ne relance pas toutes les dix secondes).
 */
const LOBBY_BRIEF_MAX_RETRIES = 3;
let retryStreak = 0;

const sweeps = throttledSweep({
  throttleMs: LOBBY_BRIEF_THROTTLE_MS,
  sweep: runLobbyBriefSweep,
  onError: (error) => {
    if (!isMissingTableError(error)) console.error("[lobby-brief] briefs du salon non envoyés", error);
  },
});

/** Une réservation rendue arme le balayage suivant, sans attendre un autre déclencheur. */
function scheduleRetrySweep(): void {
  if (retryStreak >= LOBBY_BRIEF_MAX_RETRIES) {
    console.error("[lobby-brief] relances épuisées, brief en attente du prochain évènement du tournoi");
    return;
  }
  retryStreak += 1;
  sweeps.schedule(LOBBY_BRIEF_THROTTLE_MS);
}

/**
 * Envoie les briefs dus. Jamais bloquant, jamais une exception : l'appelant est
 * une écriture déjà faite ou une lecture de page.
 *
 * @returns le nombre d'engagées briefées.
 */
export async function dispatchLobbyBriefs(): Promise<number> {
  return sweeps.run();
}

/** Remet l'étranglement à zéro. Réservé aux tests. */
export function resetLobbyBriefThrottle(): void {
  sweeps.reset();
  retryStreak = 0;
  NO_MANAGER_LOGGED.clear();
}
