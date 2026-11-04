/**
 * Check-in du match (`MATCH_LOBBY_BRIEF`, `docs/features/MATCH_LOBBY_BRIEF.md`) :
 * **15 minutes avant le coup d'envoi**, les joueurs des deux engagées reçoivent
 * le check-in du match par message privé Discord et notification push — vocal
 * d'équipe, qui héberge, paramètres de partie, déroulé des maps, cast, saisie
 * des scores et à qui s'adresser en cas de problème.
 *
 * **Deux repères, un seul message** (décision de l'utilisateur, 2026-11-04).
 * L'horaire du match donne le quart d'heure (`LOBBY_BRIEF_LEAD_MINUTES`) ; un
 * match **sans horaire** n'en a pas, et son check-in part à l'ouverture du
 * salon, comme avant la fusion. Les deux repères partagent la même réservation :
 * un match programmé puis ouvert n'est briefé qu'une fois.
 *
 * **Pourquoi un balayage.** Next.js n'a pas d'ordonnanceur, et l'ouverture du
 * salon (`lobby_opened_at`) est posée par des transactions qui n'ont pas à
 * connaître les notifications. Le balayage relit ce qui est dû, lit d'un coup
 * les destinataires de tous les côtés,
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
 * Destinataires : **tous les joueurs** de chaque engagée (`loadEntrantPlayerIds` :
 * membres actifs d'une équipe, le joueur d'une entrée solo), personne pour une
 * fantôme (réservation gardée) — le check-in demande à chacun de rejoindre le
 * vocal de son équipe, pas seulement à qui la gère (décision de l'utilisateur,
 * 2026-11-04). Une vraie équipe sans joueur actif n'est pas réservée : pm2 le
 * dit une fois, et un joueur ajouté dans la fenêtre est briefé. Le message privé est
 * un message de match : l'interrupteur « messages privés de mes matchs » de
 * « Mon profil » le coupe, et seul un tag Discord certifié le reçoit ; le push a
 * son propre sujet.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import {
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  notifyUsers,
  type NotificationRecipient,
} from "@/lib/server/notify";
import { siteUrl } from "@/lib/server/site-url";
import { throttledSweep } from "@/lib/server/throttled-sweep";
import { LOBBY_BRIEF_LEAD_MINUTES, type LobbyBriefSide } from "@/lib/shared/lobby-brief";
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
import { firstStreamUrlSql } from "./match-casters";
import { normalizeStreamUrl } from "@/lib/shared/live-streams";
import { formatLobbyBriefDm } from "./lobby-brief-dm";
import { seedJoins } from "./match-host-seeds";
import { playsMatchSql } from "./match-players";
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

/**
 * Au-delà de son horaire, un match programmé n'est plus briefé par l'horaire :
 * même fenêtre que le salon. Un match devenu jouable en retard (manche
 * précédente longue) reçoit encore son check-in ; un match commencé depuis
 * longtemps sans phase de lancement n'en reçoit pas en pleine partie (au
 * déploiement, ou après un réappariement).
 */
const LOBBY_BRIEF_LATE_MINUTES = LOBBY_BRIEF_WINDOW_MINUTES;

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
  launch_pairing: string | null;
  /** Appariement courant (`team1_id:team2_id`) : la clé de la réservation, posée avant toute ouverture de salon. */
  brief_pairing: string;
  /** Option « Salons vocaux d'équipe » du tournoi, et match suivi (ni solo, ni fantôme). */
  voice_tracked?: number | null;
  /** Lien de diffusion public du match (`firstStreamUrlSql`), `null` sans live annonçable. */
  stream_url?: string | null;
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
            m.launch_pairing, CONCAT(m.team1_id, ':', m.team2_id) AS brief_pairing,
            m.launched_at, m.host_team_id, es1.rank AS team1_seed, es2.rank AS team2_seed,
            (t.team_voice_channels = 1 AND t.participant_type <> 'SOLO'
              AND t1.is_ghost = 0 AND t2.is_ghost = 0 AND m.start_at IS NOT NULL) AS voice_tracked,
            ${firstStreamUrlSql("m")} AS stream_url,
            m.first_map, m.self_managed, m.referee_user_id, m.map_picks,
            (m.referee_user_id IS NOT NULL
              AND ${playsMatchSql("m.referee_user_id", "m.team1_id", "m.team2_id", "rp")}) AS referee_plays,
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
 * Un match dû : jouable, pas un bye, sans score, et **dans son quart d'heure**
 * — par son horaire (`LOBBY_BRIEF_LEAD_MINUTES`, borné par
 * `LOBBY_BRIEF_LATE_MINUTES`) ou, à défaut d'horaire, par l'ouverture de son
 * salon (`LOBBY_BRIEF_WINDOW_MINUTES`).
 *
 * Par l'horaire, l'appariement **n'est pas** comparé à `launch_pairing` : il
 * est vide tant qu'aucun lancement n'a été adopté (`adoptCurrentPairing`), et
 * le check-in part avant l'ouverture du salon. Par le salon, il l'est : un salon
 * ouvert pour un appariement remplacé (correction de score) ne vaut rien pour le
 * nouveau. Un tournoi masqué de nouveau (`start_visibility_at` à venir) n'envoie
 * rien, comme les salons vocaux : son nom et ses équipes ne sortent pas. La réservation porte l'appariement courant
 * (`brief_pairing`) : un réappariement change la clé, et `adoptCurrentPairing`
 * efface de son côté les réservations du match quand il remplace une empreinte
 * déjà posée.
 *
 * Toutes les bornes sont des instants de la base (`NOW()`), comme les fenêtres
 * de l'appel aux « Prêt » : le brief ne se compare à aucun instant du processus.
 */
const BRIEF_DUE_SQL = `m.status = 'READY' AND m.is_bye = 0 ${NO_SCORE_SQL}
        AND t.start_visibility_at <= NOW()
        AND ((m.start_at IS NOT NULL
              AND m.start_at <= NOW() + INTERVAL ${LOBBY_BRIEF_LEAD_MINUTES} MINUTE
              AND m.start_at > NOW() - INTERVAL ${LOBBY_BRIEF_LATE_MINUTES} MINUTE)
          OR (m.lobby_opened_at IS NOT NULL
              AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)
              AND m.lobby_opened_at > NOW() - INTERVAL ${LOBBY_BRIEF_WINDOW_MINUTES} MINUTE))`;

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
  const key = [Number(row.id), String(row.brief_pairing), lobbyBriefPhase(slot)];
  try {
    const [result] = await db.execute(
      `INSERT IGNORE INTO bg_match_start_notices (match_id, pairing, phase)
       SELECT m.id, CONCAT(m.team1_id, ':', m.team2_id), ? FROM bg_matches m
        JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
        WHERE m.id = ? AND CONCAT(m.team1_id, ':', m.team2_id) = ? AND ${BRIEF_DUE_SQL}`,
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
    console.error(`[lobby-brief] ${claimIds.length} réservation(s) non rendue(s), restée(s) en base`, error);
    return false;
  }
}

/** Les arbitres de la liste qui remplissent encore la condition ; une panne n'en compte aucun. */
async function readEligibleReferees(
  db: Db,
  ids: readonly number[],
  game: TournamentGame,
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  try {
    return await loadEligibleRefereeIds(db, ids, game);
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
    // Le bot n'ouvre de salon vocal que pour un match suivi (`MATCH_VOICE.md`) :
    // la ligne du vocal n'est écrite que là, sinon elle annoncerait un salon
    // qui n'arrivera jamais.
    voice: Number(row.voice_tracked ?? 0) === 1,
    // Un lien de diffusion vide ou fait d'invisibles n'est pas un lien.
    streamUrl: normalizeStreamUrl(row.stream_url ?? null),
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
 * Relit les réglages du match juste réservé, **pour chaque côté** : hôte,
 * cartes, arbitre et autogestion ont pu changer entre la lecture des candidats
 * et la réservation, ou entre deux côtés (lancement défait puis rouvert). Une
 * relecture en panne lève : la réservation est rendue et le match rejoué au
 * balayage suivant — envoyer sur la lecture des candidats pourrait partir sans
 * réservation, puis une seconde fois.
 *
 * @returns `null` si le salon s'est refermé depuis la réservation (lancement
 *   défait, réappariement) ; sinon la ligne relue, `claim_kept` disant si la
 *   réservation `claimId` existe encore (un lancement défait puis rouvert, ou
 *   un autre processus, a pu l'effacer).
 */
async function rereadBriefRow(
  db: Db,
  row: LobbyBriefRow,
  claimId: number,
): Promise<(LobbyBriefRow & { claim_kept: number }) | null> {
  const [rows] = await db.query<(LobbyBriefRow & { claim_kept: number })[]>(
    `SELECT ${BRIEF_COLUMNS},
            EXISTS (SELECT 1 FROM bg_match_start_notices n WHERE n.id = ?) AS claim_kept
       ${BRIEF_FROM} WHERE m.id = ? AND CONCAT(m.team1_id, ':', m.team2_id) = ? AND ${BRIEF_DUE_SQL}`,
    [claimId, Number(row.id), String(row.brief_pairing)],
  );
  return rows[0] ?? null;
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

/** Une même équipe sans joueur actif n'est dite qu'une fois dans pm2 par appariement. */
const NO_MANAGER_LOGGED = new Set<string>();
const NO_MANAGER_LOGGED_MAX = 1000;

function logNoManager(row: LobbyBriefRow, slot: LobbyBriefSlot): void {
  const key = `${Number(row.id)}:${String(row.brief_pairing)}:${slot}`;
  if (NO_MANAGER_LOGGED.has(key)) return;
  if (NO_MANAGER_LOGGED.size >= NO_MANAGER_LOGGED_MAX) NO_MANAGER_LOGGED.clear();
  NO_MANAGER_LOGGED.add(key);
  console.error(
    `[lobby-brief] match ${Number(row.id)} : une engagée n'a aucun joueur actif, check-in en attente d'un joueur`,
  );
}

/** Ce qu'un balayage a lu une fois pour tous les matchs candidats. */
type SweepContext = {
  managers: Map<number, number[]>;
  recipients: readonly NotificationRecipient[];
  briefSides: (row: LobbyBriefRow) => Promise<{ teamId: number; side: LobbyBriefSide }[]>;
};

/**
 * Bilan d'un match (voir {@link briefMatch}) : côtés briefés, réservations à
 * rendre — `retry` quand rien n'est parti (le balayage suivant les reprend),
 * `closed` quand le salon s'est refermé (rien à reprendre, aucune relance) —,
 * `lost` quand une réservation a disparu salon ouvert (relance, rien à
 * rendre), `error` quand le match s'est interrompu (relance).
 */
type MatchBrief = { sent: number; retry: number[]; closed: number[]; lost: boolean; error?: unknown };

/**
 * Joueurs d'un côté : `null` pour une vraie équipe sans joueur actif — pas de
 * réservation, un joueur ajouté dans la fenêtre sera briefé au balayage
 * suivant (pm2 le dit une fois).
 */
function sideManagers(
  row: LobbyBriefRow,
  slot: LobbyBriefSlot,
  context: SweepContext,
): { ghost: boolean; userIds: number[] } | null {
  const teamId = Number(slot === 1 ? row.team1_id : row.team2_id);
  const ghost = Number((slot === 1 ? row.team1_ghost : row.team2_ghost) ?? 0) === 1;
  const userIds = context.managers.get(teamId) ?? [];
  if (!ghost && userIds.length === 0) {
    logNoManager(row, slot);
    return null;
  }
  return { ghost, userIds };
}

/**
 * Relecture d'un côté réservé : `"closed"` — salon refermé, rien ne part du
 * match ; `"lost"` — salon ouvert mais réservation effacée entre-temps, rien
 * ne part de ce côté, le balayage suivant le reprend ; sinon les deux côtés relus.
 */
async function freshSides(
  db: Db,
  row: LobbyBriefRow,
  claimId: number,
  context: SweepContext,
): Promise<"closed" | "lost" | { teamId: number; side: LobbyBriefSide }[]> {
  const fresh = await rereadBriefRow(db, row, claimId);
  if (fresh === null) return "closed";
  if (Number(fresh.claim_kept) !== 1) return "lost";
  return context.briefSides(fresh);
}

/** Relecture puis envoi d'un côté réservé (voir {@link freshSides}). */
async function briefClaimedSide(
  db: Db,
  row: LobbyBriefRow,
  slot: LobbyBriefSlot,
  claimId: number,
  userIds: readonly number[],
  context: SweepContext,
): Promise<SideOutcome | "lost" | "closed"> {
  const sides = await freshSides(db, row, claimId, context);
  if (typeof sides === "string") return sides;
  return sendSideBrief(
    Number(row.id),
    context.recipients.filter((recipient) => userIds.includes(recipient.userId)),
    sides[slot - 1].side,
    siteUrl(matchPageHref(Number(row.tournament_id), Number(row.id))),
  );
}

/** Issue d'un côté au balayage : réservation posée (ou non) et ce qu'il en est advenu. */
type SlotResult = {
  claimId: number | null;
  outcome: SideOutcome | "lost" | "closed" | "ghost" | "taken" | "error";
  error?: unknown;
};

/**
 * Un côté : réservation, puis relecture et envoi. Jamais d'exception : une
 * réservation interrompue (rendue par sa clé), une relecture en panne ou des
 * réglages illisibles rendent `"error"`, rien n'étant parti de ce côté.
 */
async function briefSlot(
  db: Db,
  row: LobbyBriefRow,
  slot: LobbyBriefSlot,
  managers: { ghost: boolean; userIds: number[] },
  context: SweepContext,
): Promise<SlotResult> {
  let claimId: number | null = null;
  try {
    claimId = await claimLobbyBrief(db, row, slot);
    if (claimId === null) return { claimId, outcome: "taken" };
    // Fantôme : personne à briefer, la réservation reste.
    if (managers.ghost) return { claimId, outcome: "ghost" };
    return { claimId, outcome: await briefClaimedSide(db, row, slot, claimId, managers.userIds, context) };
  } catch (error) {
    return { claimId, outcome: "error", error };
  }
}

/**
 * Brief des deux côtés d'un match, **côté par côté**. Jamais d'exception :
 * une panne interrompt le match et figure au bilan, avec la réservation du
 * côté en cours à rendre.
 */
async function briefMatch(db: Db, row: LobbyBriefRow, context: SweepContext): Promise<MatchBrief> {
  const brief: MatchBrief = { sent: 0, retry: [], closed: [], lost: false };
  // Fantômes réservées : rendues seulement si le salon se referme — un côté
  // déjà briefé garde la sienne, sinon il le serait deux fois au retour de
  // l'appariement.
  const ghosts: number[] = [];
  for (const slot of [1, 2] as const) {
    const managers = sideManagers(row, slot, context);
    if (managers === null) continue;
    const { claimId, outcome, error } = await briefSlot(db, row, slot, managers, context);
    if (claimId === null) {
      if (outcome === "error") return { ...brief, error };
      continue;
    }
    if (outcome === "ghost") ghosts.push(claimId);
    else if (outcome === "error") return { ...brief, retry: [...brief.retry, claimId], error };
    // Salon refermé depuis la réservation : rien de plus ne part de ce match,
    // ses réservations sans envoi sont rendues, sans relance.
    else if (outcome === "closed") return { sent: brief.sent, retry: [], closed: [...ghosts, ...brief.retry, claimId], lost: false };
    else if (outcome === "sent") brief.sent += 1;
    else if (outcome === "retry") brief.retry.push(claimId);
    else if (outcome === "lost") {
      console.error(
        `[lobby-brief] match ${Number(row.id)} : réservation effacée avant l'envoi, salon toujours ouvert, reprise au balayage suivant`,
      );
      brief.lost = true;
    }
  }
  return brief;
}

async function runLobbyBriefSweep(): Promise<number> {
  const db = await getDatabase();
  const [rows] = await db.query<LobbyBriefRow[]>(
    `SELECT ${BRIEF_COLUMNS} ${BRIEF_FROM}
      WHERE ${BRIEF_DUE_SQL}
        AND (SELECT COUNT(*) FROM bg_match_start_notices n
              WHERE n.match_id = m.id AND n.pairing = CONCAT(m.team1_id, ':', m.team2_id)
                AND n.phase IN (?, ?)) < 2
      ORDER BY m.id`,
    [lobbyBriefPhase(1), lobbyBriefPhase(2)],
  );
  if (rows.length === 0) {
    // Lecture commune réussie : la panne qui avait armé une relance est passée.
    retries.delete(SWEEP_RETRY_KEY);
    return 0;
  }

  // Destinataires de tous les côtés en deux lectures, **avant** toute
  // réservation : une panne ici ne réserve rien, et arme le balayage suivant
  // (`onError`, dans la limite des relances).
  const memberships = await loadEntrantPlayerIds(rows.flatMap((row) => [Number(row.team1_id), Number(row.team2_id)]));
  const recipients = await loadNotificationRecipients([...memberships.values()].flat(), "certified", { matchDm: true });
  retries.delete(SWEEP_RETRY_KEY);
  // Joueurs dont le compte vit encore : un compte supprimé (anonymisé) garde
  // son appartenance mais ne reçoit plus rien — une équipe qui n'a que lui
  // reste « sans joueur », non réservée, pour qu'un joueur ajouté dans la
  // fenêtre soit briefé.
  const live = new Set(recipients.map((recipient) => recipient.userId));
  const managers = new Map(
    [...memberships].map(([teamId, userIds]) => [teamId, userIds.filter((userId) => live.has(userId))]),
  );
  // Un match dont aucun côté n'a de quoi partir (vraies équipes sans joueur
  // actif, seules à attendre) ne coûte ni casteurs ni arbitres : il
  // reste candidat toute la fenêtre, et ces lectures seraient refaites à
  // chaque balayage pour rien.
  const hasRecipients = (teamId: number, ghost: number | null | undefined) =>
    Number(ghost ?? 0) === 1 || (managers.get(teamId) ?? []).length > 0;
  const briefable = rows.filter(
    (row) => hasRecipients(Number(row.team1_id), row.team1_ghost) || hasRecipients(Number(row.team2_id), row.team2_ghost),
  );
  // Ces lectures ne lèvent pas : une panne envoie le brief sans la ligne.
  const castersByMatch = await readMatchCasters(
    db,
    briefable.map((row) => ({ id: Number(row.id), game: row.game })),
  );
  // La condition d'arbitrage dépend du jeu (Battle.net en Overwatch seulement) :
  // les arbitres lus se retiennent par jeu.
  const refereeIdsOf = (list: readonly LobbyBriefRow[], game: TournamentGame) =>
    list.flatMap((row) => (row.referee_user_id === null || row.game !== game ? [] : [Number(row.referee_user_id)]));
  const games = new Set<TournamentGame>(briefable.map((row) => row.game));
  const checkedReferees = new Map<TournamentGame, Set<number>>();
  const eligibleReferees = new Map<TournamentGame, Set<number>>();
  await Promise.all(
    [...games].map(async (game) => {
      const ids = new Set(refereeIdsOf(briefable, game));
      checkedReferees.set(game, ids);
      eligibleReferees.set(game, await readEligibleReferees(db, [...ids], game));
    }),
  );

  /** Les deux côtés d'un match relu ; un arbitre désigné depuis la première lecture est lu à part. */
  const briefSides = async (row: LobbyBriefRow) => {
    // Un jeu absent de la première lecture garde ses ensembles : la relecture d'un arbitre ne se fait qu'une fois.
    const checked = checkedReferees.get(row.game) ?? new Set<number>();
    const eligible = eligibleReferees.get(row.game) ?? new Set<number>();
    checkedReferees.set(row.game, checked);
    eligibleReferees.set(row.game, eligible);
    const unread = refereeIdsOf([row], row.game).filter((id) => !checked.has(id));
    for (const id of unread) checked.add(id);
    for (const id of await readEligibleReferees(db, unread, row.game)) eligible.add(id);
    const refereeId = row.referee_user_id === null ? null : Number(row.referee_user_id);
    return lobbyBriefSides(row, {
      cast: (castersByMatch.get(Number(row.id)) ?? []).length > 0,
      refereeAssigned: refereeId !== null && eligible.has(refereeId) && Number(row.referee_plays ?? 0) !== 1,
    });
  };

  let sent = 0;
  const toRelease: number[] = [];
  const closed: number[] = [];
  const toRetry: string[] = [];
  for (const row of rows) {
    const brief = await briefMatch(db, row, { managers, recipients, briefSides });
    sent += brief.sent;
    toRelease.push(...brief.retry);
    closed.push(...brief.closed);
    if (brief.error !== undefined) {
      // Un match en échec n'empêche pas les suivants ; il est rejoué au balayage suivant.
      console.error(`[lobby-brief] brief du match ${Number(row.id)} interrompu, repris au balayage suivant`, brief.error);
    }
    if (brief.error !== undefined || brief.retry.length > 0 || brief.lost) toRetry.push(matchRetryKey(row));
    else retries.delete(matchRetryKey(row));
  }
  // Leurs réservations sont rendues en un lot ; pm2 ne dit « remis » qu'une
  // fois le rendu fait.
  if (toRelease.length + closed.length > 0 && (await releaseQuietly(db, [...toRelease, ...closed]))) {
    if (toRelease.length > 0) console.error(`[lobby-brief] ${toRelease.length} brief(s) remis au balayage suivant`);
    if (closed.length > 0) {
      console.error(`[lobby-brief] ${closed.length} réservation(s) rendue(s) : salon refermé avant l'envoi`);
    }
  }
  scheduleRetrySweep(toRetry);
  return sent;
}

/** Étranglement : celui des départs de match (dix secondes). */
const LOBBY_BRIEF_THROTTLE_MS = 10_000;
/**
 * Relances armées d'affilée **pour un même match** (ou pour le balayage
 * entier, quand ses lectures communes échouent) : au-delà, il attend un autre
 * déclencheur — une panne durable ne relance pas toutes les dix secondes, et
 * un match qui échoue toujours n'épuise pas les relances des autres.
 */
const LOBBY_BRIEF_MAX_RETRIES = 3;
const RETRIES_MAX_KEYS = 1000;
const SWEEP_RETRY_KEY = "sweep";
const retries = new Map<string, number>();

function matchRetryKey(row: LobbyBriefRow): string {
  return `${Number(row.id)}:${String(row.brief_pairing)}`;
}

const sweeps = throttledSweep({
  throttleMs: LOBBY_BRIEF_THROTTLE_MS,
  sweep: runLobbyBriefSweep,
  onError: (error) => {
    if (isMissingTableError(error)) return;
    console.error("[lobby-brief] briefs du salon non envoyés", error);
    scheduleRetrySweep([SWEEP_RETRY_KEY]);
  },
});

/**
 * Arme le balayage suivant pour ces matchs, sans attendre un autre
 * déclencheur, tant que l'un d'eux n'a pas épuisé ses relances.
 */
function scheduleRetrySweep(keys: readonly string[]): void {
  if (keys.length === 0) return;
  if (retries.size >= RETRIES_MAX_KEYS) retries.clear();
  let armed = false;
  for (const key of keys) {
    const count = (retries.get(key) ?? 0) + 1;
    retries.set(key, count);
    if (count <= LOBBY_BRIEF_MAX_RETRIES) armed = true;
  }
  if (armed) sweeps.schedule(LOBBY_BRIEF_THROTTLE_MS);
  else console.error("[lobby-brief] relances épuisées, brief en attente du prochain évènement du tournoi");
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
  retries.clear();
  NO_MANAGER_LOGGED.clear();
}
