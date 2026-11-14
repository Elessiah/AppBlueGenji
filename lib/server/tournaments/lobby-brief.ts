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
 * (phase `LOBBY_BRIEF`, une par **match et engagée** — l'id de l'engagée tient
 * lieu d'appariement ; deux balayages concurrents n'envoient qu'une fois), relit
 * les réglages du match et l'envoie : un arrêt du processus entre deux côtés ne
 * laisse au plus qu'une réservation sans envoi. Mêmes déclencheurs que les
 * départs de match.
 *
 * **Jamais deux fois** (2026-11-06) : une fois parti, le check-in d'une engagée
 * pour ce match ne repart plus — ni sur une nouvelle heure (même dans le quart
 * d'heure), ni sur un lancement défait, ni sur un réappariement (l'engagée qui
 * reste n'est pas rebriefée, celle qui arrive reçoit le sien). Les ménages de
 * `bg_match_start_notices` (`match-schedule`, `match-launch`,
 * `referee-scheduling`) épargnent donc les phases `LOBBY_BRIEF%`. Les
 * réservations de l'ancien format (`LOBBY_BRIEF_1` / `_2`, clé
 * `team1_id:team2_id`) valent encore pour leur engagée.
 *
 * **Indépendant du push** : le message privé part même quand les notifications
 * push sont éteintes (clés absentes). Bot injoignable : le push part quand même,
 * les comptes non joints sont dits dans pm2 (par nombre), sans nouvel essai —
 * la réservation reste, le brief ne part qu'une fois. Un côté dont personne
 * n'a rien reçu (messages privés coupés, tag non certifié, push éteint) n'est
 * pas compté comme briefé, et pm2 le dit.
 *
 * **Autogestion seulement** (décision de l'utilisateur, 2026-11-05) : le
 * check-in ne part que pour un match en autogestion (`self_managed = 1`, sans
 * arbitre désigné, dans `BRIEF_DUE_SQL`) — un match arbitré ou sans décision
 * n'en reçoit aucun, l'arbitre ou le staff mène la partie.
 *
 * Destinataires : **ceux qui gèrent** chaque engagée (`loadEntrantManagerIds` :
 * `OWNER` et `MANAGER` d'une équipe, le joueur d'une entrée solo), personne
 * pour une fantôme (réservation gardée) — ce sont eux qui créent la partie et
 * relaient au reste de l'équipe (décision de l'utilisateur, 2026-11-05). Une
 * vraie équipe sans gérant actif n'est pas réservée : pm2 le dit une fois, et
 * un gérant nommé dans la fenêtre est briefé. Le message privé est
 * un message de match : l'interrupteur « messages privés de mes matchs » de
 * « Mon profil » le coupe, et seul un tag Discord certifié le reçoit ; le push a
 * son propre sujet.
 */
import {
  clipMapPointTargets,
  effectiveMapPointTargets,
  hasPerMapTargets,
  parseStoredMapPointTarget,
  parseStoredMapPointTargets,
} from "@/lib/shared/map-points";
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
import { LOBBY_BRIEF_LEAD_MINUTES, type LobbyBriefKickoff, type LobbyBriefSide } from "@/lib/shared/lobby-brief";
import { LOCALES, type Locale } from "@/lib/shared/locales";
import type { PushContent } from "@/lib/shared/push-notifications";
import type { TournamentGame } from "@/lib/shared/types";
import { LAUNCH_AUTO_DELAY_MINUTES } from "@/lib/shared/match-launch";
import { matchPageHref } from "@/lib/shared/match-anchor";
import { matchHostTeamId } from "@/lib/shared/match-referee";
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
import { roundAllowsTiebreak, roundMaxMaps, tiebreakTournamentFromRow } from "@/lib/shared/round-plan";
import type { PhaseFormat, TournamentFormat } from "@/lib/shared/types";
import { streamUrlCandidatesSql } from "./match-casters";
import { firstAnnounceableUrl } from "@/lib/shared/live-announcements";
import { formatLobbyBriefDm } from "./lobby-brief-dm";
import { seedJoins } from "./match-host-seeds";
import { readMatchCasters } from "./player-pushes";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

/** Place d'une engagée dans le match (`team1_id` / `team2_id`). */
export type LobbyBriefSlot = 1 | 2;

/**
 * Phase de la réservation dans `bg_match_start_notices` (16 caractères au
 * plus) ; sa colonne `pairing` porte l'id de l'engagée briefée : un côté en
 * échec rend la sienne sans toucher à l'autre, et la clé ne change ni avec
 * l'horaire ni avec l'adversaire.
 */
export const LOBBY_BRIEF_PHASE = "LOBBY_BRIEF";

/**
 * Une réservation à l'ancien format (`LOBBY_BRIEF_1` / `_2`, rangée par
 * position) tient-elle l'engagée `team` ? Une seule écriture pour la
 * réservation et le balayage : ils jugent le même côté réservé.
 */
function legacyBriefSql(alias: string, team: string): string {
  return `(${alias}.phase = 'LOBBY_BRIEF_1' AND ${alias}.pairing LIKE CONCAT(${team}, ':%'))
                  OR (${alias}.phase = 'LOBBY_BRIEF_2' AND ${alias}.pairing LIKE CONCAT('%:', ${team}))`;
}

/**
 * Une réservation de l'ancien format (`LOBBY_BRIEF_1` / `_2`, clé
 * `team1_id:team2_id`) déjà posée pour l'engagée `?` du match `m` : elle
 * vaut réservation, le check-in ne repart pas au déploiement.
 */
const LEGACY_BRIEF_SQL = `EXISTS (SELECT 1 FROM bg_match_start_notices o
              WHERE o.match_id = m.id AND (${legacyBriefSql("o", "?")}))`;

/**
 * Le check-in de l'engagée `team` (expression SQL) est-il déjà parti pour la
 * **place** du match `m` (`bg_lobby_brief_marks`) ? La marque survit au match :
 * un retour arrière ou une manche régénérée efface le match et ses
 * réservations, la place et l'engagée restent — le check-in ne repart jamais
 * deux fois. Seule la reconstruction du plateau l'efface (`forgetLobbyBriefMarks`) :
 * ses rencontres sont nouvelles.
 */
function briefMarkSql(team: string): string {
  return `EXISTS (SELECT 1 FROM bg_lobby_brief_marks k
              WHERE k.tournament_id = m.tournament_id AND k.phase_id = m.phase_id
                AND k.bracket = m.bracket AND k.round_number = m.round_number
                AND k.match_number = m.match_number AND k.team_id = ${team})`;
}

/**
 * L'engagée `team` (expression SQL) du match `m` est-elle déjà réservée — au
 * format courant (`?` = `LOBBY_BRIEF_PHASE`) ou à l'ancien, **comme le juge
 * la réservation** (`LEGACY_BRIEF_SQL`) : un côté que la réservation refuserait
 * ne garde pas le match candidat à chaque balayage.
 */
function sideBriefedSql(team: string): string {
  return `(EXISTS (SELECT 1 FROM bg_match_start_notices n
              WHERE n.match_id = m.id
                AND ((n.phase = ? AND n.pairing = CONCAT(${team}, '')) OR ${legacyBriefSql("n", team)}))
            OR ${briefMarkSql(team)}
            OR ${mutedBriefSql(team)})`;
}

/** Id de l'engagée de ce côté, clé de sa réservation. */
function slotTeamId(row: LobbyBriefRow, slot: LobbyBriefSlot): number {
  return Number(slot === 1 ? row.team1_id : row.team2_id);
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
  /**
   * Liens de diffusion publics du match (`streamUrlCandidatesSql`, staff
   * d'abord), `null` sans lien ou match pas annoncé casté (`live_trigger`).
   */
  stream_urls?: string | null;
  host_team_id: number | null;
  team1_seed: number | null;
  team2_seed: number | null;
  first_map: string | null;
  self_managed: number;
  referee_user_id: number | null;
  /** Déjà lancé (lancement forcé, ou tous « Prêt » avant le balayage) : le brief dit « lancé ». */
  launched_at?: Date | string | null;
  /** Déclencheur du check-in, jugé sur l'horloge de la base (`LobbyBriefKickoff`). */
  kickoff_state?: string | null;
  /** Engagées fantômes (`is_ghost`) : personne à briefer de ce côté. */
  team1_ghost?: number | null;
  team2_ghost?: number | null;
  /** Cartes choisies au-delà de la carte 1, et créneaux de la manche (`ROUND_MAPS.md`). */
  map_picks?: string | null;
  round_slots_json?: string | null;
  first_ban_rule?: string | null;
  next_ban_rule?: string | null;
  /** Map de départage du tour et ce qui dit si elle s'applique (play-offs à format défini). */
  round_tiebreak_map?: string | null;
  /** Format Duel / Arcade : points du tournoi et réglage propre au tour (`DUEL_ARCADE.md`). */
  tournament_point_target?: number | null;
  round_point_target?: number | null;
  round_point_targets?: string | null;
  phase_id?: number | null;
  phase_format?: PhaseFormat | null;
  tournament_format?: TournamentFormat | null;
  match_format_type?: "BO" | "FT" | null;
  match_format_value?: number | null;
  match_format_max_maps?: number | null;
  match_format_draws?: number | null;
  endurance_playoff_format_type?: "BO" | "FT" | null;
  endurance_playoff_format_value?: number | null;
  /**
   * Côté déjà réservé, lu par le balayage seul (`sideBriefedSql`) : ni
   * réservation rejouée, ni destinataires relus pour lui. Absent : non.
   */
  team1_briefed?: number | null;
  team2_briefed?: number | null;
};

/**
 * Déclencheur lu de la base ; une valeur absente (ancienne ligne de test) vaut
 * l'horaire à venir. `UNSCHEDULED` vaut aussi pour un horaire **au-delà du
 * quart d'heure** : un tel match n'est dû que par son salon (lancé tôt), et le
 * salon de check-in n'y est pas plus ouvert que sans horaire.
 */
function briefKickoff(state: string | null | undefined): LobbyBriefKickoff {
  return state === "PASSED" || state === "UNSCHEDULED" ? state : "SOON";
}

/**
 * Map de départage annoncée au brief : celle du tour, si le tour s'y prête
 * encore (format relu avec le match, `roundAllowsTiebreak`) ; `null` sinon.
 */
export function briefTiebreakMap(row: LobbyBriefRow): string | null {
  const map = parseStoredTiebreak(row.round_tiebreak_map);
  if (map === null || !row.tournament_format) return null;
  const phaseId = Number(row.phase_id ?? 0);
  const allowed = roundAllowsTiebreak(
    tiebreakTournamentFromRow(
      { ...row, format: row.tournament_format },
      row.phase_format ? [{ id: phaseId, format: row.phase_format }] : null,
    ),
    { phaseId, bracket: String(row.bracket), roundNumber: Number(row.round_number) },
  );

  return allowed ? map : null;
}

/**
 * Points par carte annoncés au brief (format Duel / Arcade) : ceux du tour,
 * sinon du tournoi ; `null` quand le format est éteint sur le tournoi (un
 * réglage de tour resté ne rallume rien).
 */
export function briefPointTarget(row: LobbyBriefRow): number | null {
  const tournament = parseStoredMapPointTarget(row.tournament_point_target);
  return tournament === null ? null : (parseStoredMapPointTarget(row.round_point_target) ?? tournament);
}

/** Cartes au plus d'un match de ce tour (`roundMaxMaps`), `null` en score libre ou format inconnu. */
export function briefMaxMaps(row: LobbyBriefRow): number | null {
  if (!row.tournament_format) return null;
  return roundMaxMaps(tiebreakTournamentFromRow({ ...row, format: row.tournament_format }, null), Number(row.round_number));
}

/**
 * Points réglés carte par carte sur le tour, effectifs (la carte, sinon
 * {@link briefPointTarget}), limités aux cartes que le match joue ; `null`
 * quand toutes les cartes ont le même N (la page du match dit alors un seul
 * « premier à N », `hasPerMapTargets`).
 */
export function briefPointTargets(
  row: LobbyBriefRow,
  target: number | null = briefPointTarget(row),
  /** Cartes au plus du match, si l'appelant l'a déjà calculé (`briefMaxMaps`). */
  maxMaps?: number | null,
): number[] | null {
  // Sans réglage carte par carte (le cas courant) ou format éteint : rien à
  // résoudre, ni le format du match à relire.
  if (target === null || !row.round_point_targets) return null;
  const perMap = effectiveMapPointTargets(
    target,
    clipMapPointTargets(
      parseStoredMapPointTargets(row.round_point_targets),
      maxMaps === undefined ? briefMaxMaps(row) : maxMaps,
    ),
  );
  return hasPerMapTargets(target, perMap) ? perMap : null;
}

/**
 * Un match qui porte déjà un score est joué : le staff qui le replanifie ou
 * allume l'arbitrage planifié le tient pour lancé (`lobby_opened_at` posé,
 * `match-schedule`, `referee-scheduling`), sans qu'aucun salon ne s'ouvre.
 */
const NO_SCORE_SQL = "AND m.team1_score IS NULL AND m.team2_score IS NULL";

type Db = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Colonnes du brief, lues pour les candidats puis relues après chaque réservation.
 * Le lien de diffusion reste tu tant que le match n'est pas annoncé casté
 * (`live_trigger` vide), comme sur la page du match (`matchPageStreams`).
 */
const BRIEF_COLUMNS = `m.id, m.tournament_id, t.name AS tournament_name, t.participant_type, t.game,
            m.bracket, m.round_number, ${swissRoundSql("m", "t")},
            m.team1_id, m.team2_id, t1.name AS team1_name, t2.name AS team2_name,
            t1.is_ghost AS team1_ghost, t2.is_ghost AS team2_ghost,
            m.launch_pairing, CONCAT(m.team1_id, ':', m.team2_id) AS brief_pairing,
            m.launched_at, m.host_team_id, es1.rank AS team1_seed, es2.rank AS team2_seed,
            CASE WHEN m.start_at IS NULL OR m.start_at > NOW() + INTERVAL ${LOBBY_BRIEF_LEAD_MINUTES} MINUTE
                   THEN 'UNSCHEDULED'
                 WHEN m.start_at > NOW() THEN 'SOON' ELSE 'PASSED' END
              AS kickoff_state,
            (t.team_voice_channels = 1 AND t.participant_type <> 'SOLO'
              AND t1.is_ghost = 0 AND t2.is_ghost = 0 AND m.start_at IS NOT NULL
              AND m.start_at <= NOW() + INTERVAL ${LOBBY_BRIEF_LEAD_MINUTES} MINUTE) AS voice_tracked,
            CASE WHEN m.live_trigger IS NULL THEN NULL ELSE ${streamUrlCandidatesSql("m")} END AS stream_urls,
            m.first_map, m.self_managed, m.referee_user_id, m.map_picks,
            t.first_ban_rule, t.next_ban_rule,
            rm.slots_json AS round_slots_json,
            rm.tiebreak_map AS round_tiebreak_map,
            t.map_point_target AS tournament_point_target,
            rm.map_point_target AS round_point_target,
            rm.map_point_targets AS round_point_targets,
            m.phase_id, t.format AS tournament_format,
            (SELECT p.format FROM bg_tournament_phases p WHERE p.id = m.phase_id) AS phase_format,
            t.match_format_type, t.match_format_value, t.match_format_max_maps, t.match_format_draws,
            t.endurance_playoff_format_type, t.endurance_playoff_format_value`;

const BRIEF_FROM = `FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
       LEFT JOIN bg_tournament_round_maps rm ON rm.tournament_id = m.tournament_id AND rm.phase_id = m.phase_id
         AND rm.bracket = m.bracket AND rm.round_number = m.round_number
       ${seedJoins("m")}`;

/**
 * Option « Check-in des matchs » du tournoi (`MATCH_CHECK_IN_SETTING.md`),
 * relue à chaque lecture des candidats, dans la réservation **et** à la
 * relecture de chaque côté juste avant l'envoi (`rereadBriefRow`) : éteinte,
 * rien ne part ni n'est réservé (la réservation d'un côté relu éteint est rendue). Ce qui est devenu dû pendant l'arrêt est
 * réservé sans message par la remise en marche ({@link silencePausedLobbyBriefs}) ;
 * ce qui était dû avant l'arrêt reste libre et part, rallumée, dans sa fenêtre.
 */
const CHECK_IN_ON_SQL = `t.match_check_in = 1`;

/** {@link BRIEF_WINDOW_SQL} par l'horaire : dans son quart d'heure, pas trop en retard. */
const TIME_BRANCH_SQL = `m.start_at IS NOT NULL
              AND m.start_at <= NOW() + INTERVAL ${LOBBY_BRIEF_LEAD_MINUTES} MINUTE
              AND m.start_at > NOW() - INTERVAL ${LOBBY_BRIEF_LATE_MINUTES} MINUTE`;

/** {@link BRIEF_WINDOW_SQL} par le salon : ouvert pour l'appariement actuel, depuis peu. */
const LOBBY_BRANCH_SQL = `m.lobby_opened_at IS NOT NULL
              AND (m.start_at IS NULL OR m.start_at <= NOW() OR m.launched_at IS NOT NULL)
              AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)
              AND m.lobby_opened_at > NOW() - INTERVAL ${LOBBY_BRIEF_WINDOW_MINUTES} MINUTE`;

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
 * nouveau. Par le salon encore, l'horaire ne doit pas être **à venir**, sauf
 * match **lancé** : un salon ouvert tôt sans lancement attend son quart
 * d'heure ; un match lancé tôt (lancement forcé à 18 h pour 21 h) se joue
 * tout de suite, son check-in part donc à l'ouverture — « match lancé », sans
 * la ligne du salon de check-in ni celle du vocal, qui n'ouvrent qu'au quart
 * d'heure de l'horaire (`kickoff_state`, `voice_tracked`) — et plus rien à
 * H-15 (même réservation). Un tournoi masqué de nouveau (`start_visibility_at` à venir) n'envoie
 * rien, comme les salons vocaux : son nom et ses équipes ne sortent pas. La
 * réservation porte l'engagée, pas l'appariement : ni `adoptCurrentPairing` ni
 * une nouvelle heure ne l'effacent.
 *
 * Toutes les bornes sont des instants de la base (`NOW()`), comme les fenêtres
 * de l'appel aux « Prêt » : le brief ne se compare à aucun instant du processus.
 */
const BRIEF_WINDOW_SQL = `m.status = 'READY' AND m.is_bye = 0 ${NO_SCORE_SQL}
        AND m.self_managed = 1 AND m.referee_user_id IS NULL
        AND t.start_visibility_at <= NOW()
        AND ((${TIME_BRANCH_SQL}) OR (${LOBBY_BRANCH_SQL}))`;

/** {@link BRIEF_WINDOW_SQL} d'un tournoi dont le check-in est allumé. */
const BRIEF_DUE_SQL = `${BRIEF_WINDOW_SQL}
        AND ${CHECK_IN_ON_SQL}`;

/**
 * Instant où le salon a fait entrer le match dans {@link LOBBY_BRANCH_SQL}
 * (horloge de la base, comme `lobby_opened_at` et `launched_at`) : le
 * lancement pour un match lancé, l'ouverture faute d'horaire, sinon le plus
 * tard de l'ouverture et de l'horaire — un salon ouvert tôt sans lancement
 * attend l'horaire, un salon ouvert en retard compte à son ouverture.
 */
const LOBBY_ENTRY_SQL = `CASE WHEN m.launched_at IS NOT NULL THEN GREATEST(m.lobby_opened_at, m.launched_at)
              WHEN m.start_at IS NULL THEN m.lobby_opened_at
              ELSE GREATEST(m.lobby_opened_at, m.start_at) END`;

/**
 * Phase des réservations **muettes** de la remise en marche (16 caractères au
 * plus ; préfixe `LOBBY_BRIEF`, épargné comme le check-in par les retours
 * arrière). Sa clé (`pairing`) porte l'engagée **et l'horaire** du match
 * ({@link mutedBriefKeySql}) : une nouvelle heure n'est plus tue, son check-in
 * part — la réservation d'un check-in parti, elle, vaut quelle que soit l'heure.
 */
export const LOBBY_BRIEF_MUTED_PHASE = "LOBBY_BRIEF_MUTE";

/** Clé d'une réservation muette : `<engagée>@<horaire AAAAMMJJhhmmss>` (vide sans horaire). */
function mutedBriefKeySql(team: string): string {
  return `CONCAT(${team}, '@', COALESCE(DATE_FORMAT(m.start_at, '%Y%m%d%H%i%s'), ''))`;
}

/** L'engagée `team` du match `m` a-t-elle été tue par une remise en marche, pour l'horaire actuel ? */
function mutedBriefSql(team: string): string {
  return `EXISTS (SELECT 1 FROM bg_match_start_notices u
              WHERE u.match_id = m.id AND u.phase = '${LOBBY_BRIEF_MUTED_PHASE}'
                AND u.pairing = ${mutedBriefKeySql(team)})`;
}

/**
 * Remise en marche du check-in (`setMatchCheckIn`, dans sa transaction) :
 * tait, côté par côté, le check-in des matchs du tournoi qui est dû maintenant
 * et l'est devenu **pendant l'arrêt** — aucune des branches qui le rendent dû
 * (horaire : H-15 ; salon : {@link LOBBY_ENTRY_SQL}) n'y est entrée avant
 * l'arrêt. Un check-in dû avant l'arrêt, encore dans sa fenêtre, reste libre (il
 * part) ; un match devenu dû après la remise en marche n'est pas touché. La
 * réservation muette ({@link LOBBY_BRIEF_MUTED_PHASE}) solde l'arrêt une fois
 * pour toutes (un second arrêt ne le rouvre pas) mais pour l'horaire du moment
 * seulement : déplacé, le match reçoit son check-in à la nouvelle heure.
 * L'horaire se compare à l'arrêt (heure du processus, comme les horaires) ; le
 * salon, à l'arrêt ramené sur l'horloge de la base (`NOW()` moins le temps
 * écoulé depuis l'arrêt, `now` pris à chaque tentative de la transaction).
 * Sans arrêt daté (tournoi créé sans check-in), tout ce qui est dû se tait.
 * Une seule instruction pour les deux côtés.
 */
export async function silencePausedLobbyBriefs(
  connection: Pick<Db, "execute">,
  tournamentId: number,
  pausedAt: Date | null,
  now: Date,
): Promise<void> {
  const dueBeforePause =
    pausedAt === null
      ? ""
      : `AND NOT (((${TIME_BRANCH_SQL}) AND m.start_at - INTERVAL ${LOBBY_BRIEF_LEAD_MINUTES} MINUTE < ?)
                OR ((${LOBBY_BRANCH_SQL}) AND ${LOBBY_ENTRY_SQL} < NOW() - INTERVAL ? SECOND))`;
  const params =
    pausedAt === null ? [] : [pausedAt, Math.max(0, Math.floor((now.getTime() - pausedAt.getTime()) / 1000))];
  // Lecture sans verrou d'abord : l'`INSERT … SELECT` pose des verrous sur
  // chaque ligne qu'il parcourt, et sur toute la liste des matchs du tournoi
  // il ferait attendre les scores et les lancements sous le verrou du tournoi.
  // Il ne parcourt plus que les matchs retenus (clé primaire) ; ses conditions
  // restent les mêmes, relues sous le verrou.
  const windowSql = `m.tournament_id = ? AND ${BRIEF_WINDOW_SQL} ${dueBeforePause}`;
  const [due] = await connection.execute<RowDataPacket[]>(
    `SELECT m.id FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
      WHERE ${windowSql}`,
    [tournamentId, ...params],
  );
  if (due.length === 0) return;
  const ids = due.map((row) => Number(row.id));
  await connection.execute(
    `INSERT IGNORE INTO bg_match_start_notices (match_id, pairing, phase)
     SELECT m.id, ${mutedBriefKeySql("IF(side.n = 1, m.team1_id, m.team2_id)")}, ? FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
       JOIN (SELECT 1 AS n UNION ALL SELECT 2) side
      WHERE m.id IN (${ids.map(() => "?").join(", ")}) AND ${windowSql}`,
    [LOBBY_BRIEF_MUTED_PHASE, ...ids, tournamentId, ...params],
  );
}

/**
 * Réserve un côté — clé (match, id de l'engagée, `LOBBY_BRIEF`), une seule
 * instruction et `affectedRows` — **si le salon est toujours ouvert pour cet
 * appariement** et qu'aucune réservation de l'ancien format ne couvre l'engagée :
 * la condition relit le match dans l'instruction même. Entre la lecture des
 * candidats et la réservation, un lancement défait (`match-schedule`,
 * `referee-scheduling`) referme le salon — il efface les autres avis du match,
 * jamais les réservations du check-in (`LOBBY\_BRIEF%`) ; une
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
  const teamKey = String(slotTeamId(row, slot));
  const key = [Number(row.id), teamKey, LOBBY_BRIEF_PHASE];
  try {
    const [result] = await db.execute(
      `INSERT IGNORE INTO bg_match_start_notices (match_id, pairing, phase)
       SELECT m.id, ?, ? FROM bg_matches m
        JOIN bg_tournaments t ON t.id = m.tournament_id AND t.state = 'RUNNING'
        WHERE m.id = ? AND CONCAT(m.team1_id, ':', m.team2_id) = ? AND ${BRIEF_DUE_SQL}
          AND NOT ${LEGACY_BRIEF_SQL}
          AND NOT ${briefMarkSql("?")}
          AND NOT ${mutedBriefSql("?")}`,
      [teamKey, LOBBY_BRIEF_PHASE, key[0], String(row.brief_pairing), teamKey, teamKey, teamKey, teamKey],
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
 * Marque le check-in d'un côté comme parti, par la place du match
 * (`briefMarkSql`) : posée **juste avant** l'envoi, le brief rédigé — un arrêt
 * du processus entre l'envoi et la marque ne laisse plus la seule
 * réservation, qu'un retour arrière efface (check-in renvoyé). Rien ne part
 * sans elle (`retry`, avant la rédaction ou faute de destinataire) : aucune
 * marque. Jamais d'exception : une marque manquée laisse la réservation, qui
 * suffit tant que le match existe.
 */
async function markBriefSent(db: Db, matchId: number, teamId: number): Promise<void> {
  try {
    await db.execute(
      `INSERT IGNORE INTO bg_lobby_brief_marks (tournament_id, phase_id, bracket, round_number, match_number, team_id)
       SELECT m.tournament_id, m.phase_id, m.bracket, m.round_number, m.match_number, ? FROM bg_matches m WHERE m.id = ?`,
      [teamId, matchId],
    );
  } catch (error) {
    console.error(`[lobby-brief] check-in du match ${matchId} parti sans marque durable`, error);
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

/**
 * Les deux côtés du brief d'un match en autogestion : chaque engagée lit « ton
 * équipe contre l'autre ». Aucun arbitre n'y crée la partie : l'hôte la crée,
 * le premier ban suit la règle du tournoi.
 */
export function lobbyBriefSides(
  row: LobbyBriefRow,
  options: { cast: boolean },
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
  // Résolus une fois par ligne. Le format du match n'est relu que pour un tour
  // réglé carte par carte (format allumé) : seul ce cas le lit (`briefPointTargets`, DM).
  const pointTarget = briefPointTarget(row);
  const maxMaps = pointTarget !== null && row.round_point_targets ? briefMaxMaps(row) : null;
  const base = {
    tournamentId: Number(row.tournament_id),
    tournamentName: String(row.tournament_name),
    matchId: Number(row.id),
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    swiss: isSwissRound(row),
    game: row.game,
    solo: row.participant_type === "SOLO",
    // `launched_at` peut venir d'un appariement remplacé (correction de score) :
    // « match lancé » ne se dit que si le lancement est celui de l'appariement courant.
    launched: (row.launched_at ?? null) !== null && row.launch_pairing === row.brief_pairing,
    kickoff: briefKickoff(row.kickoff_state),
    firstMap: effectiveFirstMap(slots, storedFirstMap),
    maps: resolveMatchMaps(slots, storedFirstMap, parseMapPicks(row.map_picks)),
    tiebreakMap: briefTiebreakMap(row),
    pointTarget,
    pointTargets: briefPointTargets(row, pointTarget, maxMaps),
    maxMaps,
    nextBan: parseNextBanRule(row.next_ban_rule),
    cast: options.cast,
    // Le bot n'ouvre de salon vocal que pour un match suivi (`MATCH_VOICE.md`) :
    // la ligne du vocal n'est écrite que là, sinon elle annoncerait un salon
    // qui n'arrivera jamais.
    voice: Number(row.voice_tracked ?? 0) === 1,
    // Un lien de diffusion vide ou fait d'invisibles n'est pas un lien ; une page de redirection ou une
    // adresse enfouie (`youtube.com/redirect?q=…`) est refusée comme dans une annonce #live — et le
    // lien suivant du match prend sa place.
    streamUrl: firstAnnounceableUrl(row.stream_urls ?? null),
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
  beforeSend: () => Promise<void>,
): Promise<SideOutcome> {
  let rendered: ReturnType<typeof renderSideBrief>;
  try {
    rendered = renderSideBrief(side, url);
  } catch (error) {
    console.error(`[lobby-brief] brief du match ${matchId} non rédigé, rien n'est parti`, error);
    return "retry";
  }
  // Le brief est rédigé : il part. La marque durable d'abord (`markBriefSent`).
  await beforeSend();
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

/** Une même équipe sans gérant actif n'est dite qu'une fois dans pm2 par appariement. */
const NO_MANAGER_LOGGED = new Set<string>();
const NO_MANAGER_LOGGED_MAX = 1000;

function logNoManager(row: LobbyBriefRow, slot: LobbyBriefSlot): void {
  const key = `${Number(row.id)}:${String(row.brief_pairing)}:${slot}`;
  if (NO_MANAGER_LOGGED.has(key)) return;
  if (NO_MANAGER_LOGGED.size >= NO_MANAGER_LOGGED_MAX) NO_MANAGER_LOGGED.clear();
  NO_MANAGER_LOGGED.add(key);
  console.error(
    `[lobby-brief] match ${Number(row.id)} : une engagée n'a aucun gérant actif, check-in en attente d'un gérant`,
  );
}

/** Ce qu'un balayage a lu une fois pour tous les matchs candidats. */
type SweepContext = {
  managers: Map<number, number[]>;
  recipients: readonly NotificationRecipient[];
  briefSides: (row: LobbyBriefRow) => { teamId: number; side: LobbyBriefSide }[];
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
 * Gérants d'un côté : `null` pour une vraie équipe sans gérant actif — pas de
 * réservation, un gérant nommé dans la fenêtre sera briefé au balayage
 * suivant (pm2 le dit une fois).
 */
function sideManagers(
  row: LobbyBriefRow,
  slot: LobbyBriefSlot,
  context: SweepContext,
): { ghost: boolean; userIds: number[] } | null {
  const teamId = slotTeamId(row, slot);
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
  // Destinataires relus juste avant l'envoi : ils ont été lus au début du
  // balayage, et un membre retiré entre-temps (`left_at`) recevrait encore le
  // lien du match, l'adversaire et l'ordre des bans. Une relecture en panne
  // lève : la réservation est rendue, le côté rejoué au balayage suivant.
  const stillActive = new Set((await loadEntrantManagerIds([slotTeamId(row, slot)])).get(slotTeamId(row, slot)) ?? []);
  const recipients = context.recipients.filter(
    (recipient) => userIds.includes(recipient.userId) && stillActive.has(recipient.userId),
  );
  // Plus aucun gérant actif (le seul a quitté l'équipe depuis la lecture du
  // balayage) : rien ne part et la réservation est rendue — comme une équipe
  // sans gérant, le côté attend qu'un gérant soit nommé dans la fenêtre.
  if (recipients.length === 0) return "retry";
  const outcome = await sendSideBrief(
    Number(row.id),
    recipients,
    sides[slot - 1].side,
    siteUrl(matchPageHref(Number(row.tournament_id), Number(row.id))),
    () => markBriefSent(db, Number(row.id), slotTeamId(row, slot)),
  );
  // Rien n'est parti (`retry`) : la réservation est rendue, aucune marque posée.
  return outcome;
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
    // Fantôme, ou gérants tous servis par le premier côté (`slotManagers`) :
    // personne à briefer, la réservation reste.
    if (managers.ghost) return { claimId, outcome: "ghost" };
    return { claimId, outcome: await briefClaimedSide(db, row, slot, claimId, managers.userIds, context) };
  } catch (error) {
    return { claimId, outcome: "error", error };
  }
}

/**
 * Gérants à briefer d'un côté ({@link sideManagers}), **sans ceux qui gèrent
 * aussi le premier côté** : membre actif des deux engagées, un compte recevrait
 * deux check-ins contradictoires (« à ton équipe de créer la partie » puis
 * « vérifie les paramètres »). Il reçoit celui du premier côté, seulement.
 * Règle fixe, lue des appartenances et non de l'issue du premier côté : elle
 * vaut à chaque balayage (premier côté déjà briefé, second repris plus tard).
 * Un second côté dont tous les gérants sont ceux du premier n'a personne à
 * briefer : réservé sans envoi, comme une fantôme (`ghost`).
 */
function slotManagers(
  row: LobbyBriefRow,
  slot: LobbyBriefSlot,
  context: SweepContext,
): { ghost: boolean; userIds: number[] } | null {
  const managers = sideManagers(row, slot, context);
  if (managers === null || managers.ghost || slot === 1) return managers;
  // Gérants vivants du premier côté, lus même quand il est déjà réservé
  // (`sweepTeamIds`) : même source que les destinataires du second.
  const first = new Set(context.managers.get(slotTeamId(row, 1)) ?? []);
  const userIds = managers.userIds.filter((userId) => !first.has(userId));
  return { ghost: userIds.length === 0, userIds };
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
    // Côté déjà réservé au balayage : sa réservation ne serait que refusée.
    if (sideBriefed(row, slot)) continue;
    const managers = slotManagers(row, slot, context);
    if (managers === null) continue;
    const result = await briefSlot(db, row, slot, managers, context);
    const done = recordSlot(brief, ghosts, row, result);
    if (done) return done;
  }
  return brief;
}

/**
 * Porte l'issue d'un côté au bilan du match ; rend le bilan **final** quand
 * elle arrête le match (panne, salon refermé), `null` pour passer au côté suivant.
 */
function recordSlot(brief: MatchBrief, ghosts: number[], row: LobbyBriefRow, result: SlotResult): MatchBrief | null {
  const { claimId, outcome, error } = result;
  if (claimId === null) return outcome === "error" ? { ...brief, error } : null;
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
  return null;
}

/** Ce côté était-il déjà réservé à la lecture du balayage ? */
function sideBriefed(row: LobbyBriefRow, slot: LobbyBriefSlot): boolean {
  return Number((slot === 1 ? row.team1_briefed : row.team2_briefed) ?? 0) === 1;
}

/**
 * Engagées dont le balayage lit les gérants : les côtés pas encore réservés,
 * plus le premier côté d'un second à briefer (`slotManagers`) — un match
 * dont un seul côté attend (équipe sans gérant actif, toute la fenêtre) ne
 * relit plus à chaque passe celui déjà briefé.
 */
function sweepTeamIds(rows: readonly LobbyBriefRow[]): number[] {
  const read = new Set<number>();
  for (const row of rows) {
    if (!sideBriefed(row, 1)) read.add(slotTeamId(row, 1));
    if (!sideBriefed(row, 2)) {
      read.add(slotTeamId(row, 2));
      read.add(slotTeamId(row, 1));
    }
  }
  return [...read];
}

async function runLobbyBriefSweep(): Promise<number> {
  const db = await getDatabase();
  // Chaque côté réservé est lu une fois, en colonne : le filtre et le balayage
  // jugent le même côté réservé.
  const [rows] = await db.query<LobbyBriefRow[]>(
    `SELECT ${BRIEF_COLUMNS},
            ${sideBriefedSql("m.team1_id")} AS team1_briefed,
            ${sideBriefedSql("m.team2_id")} AS team2_briefed
       ${BRIEF_FROM}
      WHERE ${BRIEF_DUE_SQL}
     HAVING NOT (team1_briefed = 1 AND team2_briefed = 1)
      ORDER BY m.id`,
    [LOBBY_BRIEF_PHASE, LOBBY_BRIEF_PHASE],
  );
  if (rows.length === 0) {
    // Lecture commune réussie : la panne qui avait armé une relance est passée.
    retries.delete(SWEEP_RETRY_KEY);
    return 0;
  }

  // Destinataires de tous les côtés en deux lectures, **avant** toute
  // réservation : une panne ici ne réserve rien, et arme le balayage suivant
  // (`onError`, dans la limite des relances).
  const memberships = await loadEntrantManagerIds(sweepTeamIds(rows));
  const recipients = await loadNotificationRecipients([...memberships.values()].flat(), "certified", { matchDm: true });
  retries.delete(SWEEP_RETRY_KEY);
  // Gérants dont le compte vit encore : un compte supprimé (anonymisé) garde
  // son appartenance mais ne reçoit plus rien — une équipe qui n'a que lui
  // reste « sans gérant », non réservée, pour qu'un gérant nommé dans la
  // fenêtre soit briefé.
  const live = new Set(recipients.map((recipient) => recipient.userId));
  const managers = new Map(
    [...memberships].map(([teamId, userIds]) => [teamId, userIds.filter((userId) => live.has(userId))]),
  );
  // Un match dont aucun côté n'a de quoi partir (vraies équipes sans gérant
  // actif, seules à attendre) ne coûte aucune lecture des casteurs : il
  // reste candidat toute la fenêtre, et ces lectures seraient refaites à
  // chaque balayage pour rien.
  const hasRecipients = (row: LobbyBriefRow, slot: LobbyBriefSlot) =>
    !sideBriefed(row, slot) &&
    (Number((slot === 1 ? row.team1_ghost : row.team2_ghost) ?? 0) === 1 ||
      (managers.get(slotTeamId(row, slot)) ?? []).length > 0);
  const briefable = rows.filter((row) => hasRecipients(row, 1) || hasRecipients(row, 2));
  // Ces lectures ne lèvent pas : une panne envoie le brief sans la ligne.
  const castersByMatch = await readMatchCasters(
    db,
    briefable.map((row) => ({ id: Number(row.id), game: row.game })),
  );

  /** Les deux côtés d'un match relu. */
  const briefSides = (row: LobbyBriefRow) =>
    lobbyBriefSides(row, { cast: (castersByMatch.get(Number(row.id)) ?? []).length > 0 });

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
