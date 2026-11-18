/**
 * Lecture du planning (`docs/features/CAST_PLANNING.md`) : entrées, membres,
 * disponibilités et attributions, en quelques lectures.
 * Partagée par la page (`view.ts`), le calcul automatique (`auto-assign.ts`),
 * et les gestes du staff (`actions.ts`).
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { resolveRoles } from "@/lib/server/auth";
import { jsonRoleLiteral } from "@/lib/server/privacy-consent";
import { firstStreamUrlSql } from "@/lib/server/tournaments/match-casters";
import { rolesGranting } from "@/lib/shared/permissions";
import {
  PLANNING_HORIZON_DAYS,
  PLANNING_PAST_DAYS,
  planningEntryKey,
  planningHistoryStart,
  planningRolesOf,
  planningWeekStart,
  type AssignmentReason,
  type AssignmentSource,
  type AvailabilityStatus,
  type PlanningEntryKind,
  type PlanningRole,
} from "@/lib/shared/planning";
import {
  estimateEventMinutes,
  estimateMatchMinutes,
  parseDurationSettings,
  type PlanningDurationSettings,
} from "@/lib/shared/planning-durations";
import type { PlanningEntrant } from "@/lib/shared/planning-view";
import { visibleText } from "@/lib/shared/visible-text";

export type Executor = Pick<PoolConnection, "execute">;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Comptes du planning : administrateurs et rôles qui accordent `planning`.
 * Les rôles sont des constantes du code (`jsonRoleLiteral`) : rien de saisi
 * n'entre dans la requête.
 */
export const PLANNING_MEMBER_SQL = `(u.is_admin = 1${rolesGranting("planning")
  .map((role) => ` OR JSON_CONTAINS(u.platform_roles_json, ${jsonRoleLiteral(role)})`)
  .join("")})`;

export type LoadedEntry = {
  key: string;
  kind: PlanningEntryKind;
  tournamentId: number;
  tournamentName: string;
  game: "OW" | "MR";
  matchId: number | null;
  roundNumber: number | null;
  team1: PlanningEntrant | null;
  team2: PlanningEntrant | null;
  startAt: number;
  /** Fin estimée (`planning-durations.ts`). */
  endAt: number;
  open: boolean;
  editable: boolean;
  hidden: boolean;
  channelUrl: string | null;
  selfManaged: boolean;
  /** Arbitre désigné du match (`bg_matches.referee_user_id`). */
  matchRefereeId: number | null;
};

export type LoadedAvailability = {
  entryKey: string;
  userId: number;
  role: PlanningRole;
  status: AvailabilityStatus;
  preferred: boolean;
};

export type LoadedAssignment = {
  entryKey: string;
  userId: number;
  role: PlanningRole;
  source: AssignmentSource;
  reason: Exclude<AssignmentReason, "CAST" | "MATCH">;
  /** Proposition du calcul confirmée par le staff (un choix du staff l'est toujours). */
  confirmed: boolean;
};

/** Retrait manuel par le staff (`bg_planning_events`) : le calcul ne replace plus ce membre sur ce rôle de cette entrée. */
export type LoadedRemoval = { entryKey: string; userId: number; role: PlanningRole };

export type LoadedMember = { userId: number; pseudo: string; roles: PlanningRole[]; soloCaster: boolean };

export type PlanningData = {
  entries: LoadedEntry[];
  /** Réglages des durées, lus avec les entrées (une seule lecture par chargement). */
  durations: PlanningDurationSettings;
  availability: LoadedAvailability[];
  assignments: LoadedAssignment[];
  removals: LoadedRemoval[];
  /** Casters inscrits sur un match (`bg_match_casters`) : `entryKey` → comptes. */
  matchCasters: Map<string, number[]>;
  members: LoadedMember[];
};

type TournamentRow = RowDataPacket & {
  id: number;
  name: string;
  game: "OW" | "MR";
  state: string;
  start_at: Date | string;
  live_url: string | null;
  referee_scheduling: number;
  hidden: number;
  match_format_type: "BO" | "FT" | null;
  match_format_value: number | null;
  match_format_max_maps: number | null;
};

type MatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  start_at: Date | string;
  status: string;
  round_number: number | null;
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_solo: number | null;
  team2_solo: number | null;
  referee_user_id: number | null;
  self_managed: number;
  stream_url: string | null;
};

function time(value: Date | string): number {
  return new Date(value).getTime();
}

function entrant(id: number | null, name: string | null, solo: number | null): PlanningEntrant | null {
  if (id === null) return null;
  return { teamId: Number(id), name: visibleText(name ?? ""), soloUserId: solo === null ? null : Number(solo) };
}

export function inList(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

const PLANNING_DURATIONS_KEY = "planning_durations";

/** Réglages des durées estimées (`bg_settings`), la valeur par défaut sinon. */
export async function loadDurationSettings(executor: Executor): Promise<PlanningDurationSettings> {
  const [rows] = await executor.execute<(RowDataPacket & { setting_value: string })[]>(
    "SELECT setting_value FROM bg_settings WHERE setting_key = ? LIMIT 1",
    [PLANNING_DURATIONS_KEY],
  );
  return parseDurationSettings(rows[0]?.setting_value);
}

export async function writeDurationSettings(executor: Executor, settings: PlanningDurationSettings): Promise<void> {
  await executor.execute(
    `INSERT INTO bg_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [PLANNING_DURATIONS_KEY, JSON.stringify(settings)],
  );
}

const MINUTE_MS = 60 * 1000;

/** L'entrée d'un tournoi sans planification des matchs : un évènement, à son heure de début. */
function eventEntry(row: TournamentRow, durations: PlanningDurationSettings, now: number): LoadedEntry {
  const startAt = time(row.start_at);
  return {
    key: planningEntryKey("TOURNAMENT", Number(row.id)),
    kind: "TOURNAMENT",
    tournamentId: Number(row.id),
    tournamentName: visibleText(row.name),
    game: row.game,
    matchId: null,
    roundNumber: null,
    team1: null,
    team2: null,
    startAt,
    endAt: startAt + estimateEventMinutes(durations) * MINUTE_MS,
    open: row.state !== "FINISHED" && startAt > now,
    editable: row.state !== "FINISHED",
    hidden: Number(row.hidden) === 1,
    channelUrl: row.live_url,
    selfManaged: false,
    matchRefereeId: null,
  };
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

/** L'entrée d'un match planifié ; sa fin suit le format de match du tournoi. */
function matchEntry(match: MatchRow, tournament: TournamentRow, durations: PlanningDurationSettings, now: number): LoadedEntry {
  const startAt = time(match.start_at);
  const playable = match.status !== "COMPLETED";
  const minutes = estimateMatchMinutes(
    {
      game: tournament.game,
      type: tournament.match_format_type,
      value: nullableNumber(tournament.match_format_value),
      maxMaps: nullableNumber(tournament.match_format_max_maps),
    },
    durations,
  );
  return {
    key: planningEntryKey("MATCH", Number(match.id)),
    kind: "MATCH",
    tournamentId: Number(tournament.id),
    tournamentName: visibleText(tournament.name),
    game: tournament.game,
    matchId: Number(match.id),
    roundNumber: nullableNumber(match.round_number),
    team1: entrant(match.team1_id, match.team1_name, match.team1_solo),
    team2: entrant(match.team2_id, match.team2_name, match.team2_solo),
    startAt,
    endAt: startAt + minutes * MINUTE_MS,
    open: playable && startAt > now,
    editable: playable,
    hidden: Number(tournament.hidden) === 1,
    channelUrl: match.stream_url ?? tournament.live_url,
    selfManaged: Number(match.self_managed) === 1,
    matchRefereeId: nullableNumber(match.referee_user_id),
  };
}

/** Une seule entrée du planning, nommée par sa clé (`m:<id>` / `t:<id>`). */
export type EntryOnly = { kind: PlanningEntryKind; id: number };

/** Lit une clé d'entrée (`m:<id>` / `t:<id>`) ; `null` si ce n'en est pas une. */
export function parseEntryKey(key: string): EntryOnly | null {
  const found = /^([mt]):([1-9]\d{0,15})$/.exec(key);
  if (!found) return null;
  return { kind: found[1] === "m" ? "MATCH" : "TOURNAMENT", id: Number(found[2]) };
}

type EntriesOptions = {
  now: number;
  includeHidden: boolean;
  /** Réduit la lecture à une entrée : un geste qui n'en touche qu'une ne charge pas toute la fenêtre. */
  only?: EntryOnly;
  durations?: PlanningDurationSettings;
};

/**
 * Les entrées du planning, de {@link PLANNING_PAST_DAYS} jours en arrière à
 * {@link PLANNING_HORIZON_DAYS} jours devant : un tournoi **sans**
 * planification des matchs donne une seule entrée (le tournoi entier, à son
 * heure de début), un tournoi **avec** donne une entrée par match planifié
 * (hors exempts).
 */
export async function loadPlanningEntries(executor: Executor, options: EntriesOptions): Promise<LoadedEntry[]> {
  const durations = options.durations ?? (await loadDurationSettings(executor));
  const from = new Date(options.now - PLANNING_PAST_DAYS * DAY_MS);
  const to = new Date(options.now + PLANNING_HORIZON_DAYS * DAY_MS);
  const hiddenClause = options.includeHidden ? "" : " AND t.start_visibility_at <= NOW()";
  const only = options.only;
  const onlyTournament = only?.kind === "TOURNAMENT" ? " AND t.id = ?" : "";
  const onlyMatchTournament =
    only?.kind === "MATCH" ? " AND EXISTS (SELECT 1 FROM bg_matches om WHERE om.id = ? AND om.tournament_id = t.id)" : "";
  const [tournaments] = await executor.execute<TournamentRow[]>(
    `SELECT t.id, t.name, t.game, t.state, t.start_at, t.live_url, t.referee_scheduling,
            t.match_format_type, t.match_format_value, t.match_format_max_maps,
            (t.start_visibility_at > NOW()) AS hidden
       FROM bg_tournaments t
      WHERE ((t.start_at >= ? AND t.start_at < ?)
             OR (t.referee_scheduling = 1
                 AND EXISTS (SELECT 1 FROM bg_matches pm
                              WHERE pm.tournament_id = t.id AND pm.start_at >= ? AND pm.start_at < ? AND pm.is_bye = 0)))${hiddenClause}${onlyTournament}${onlyMatchTournament}`,
    [from, to, from, to, ...(only ? [only.id] : [])],
  );
  const entries: LoadedEntry[] = tournaments
    // Un tournoi entier n'est qu'une entrée, à son début : passé de
    // `PLANNING_PAST_DAYS`, ou au-delà de l'horizon, il sort du planning comme un match.
    .filter((row) => Number(row.referee_scheduling) !== 1 && time(row.start_at) >= from.getTime() && time(row.start_at) < to.getTime())
    .map((row) => eventEntry(row, durations, options.now));
  const scheduled = tournaments.filter((row) => Number(row.referee_scheduling) === 1);
  if (scheduled.length > 0) {
    const byId = new Map(scheduled.map((row) => [Number(row.id), row]));
    const onlyMatch = only?.kind === "MATCH" ? " AND m.id = ?" : "";
    const [matches] = await executor.execute<MatchRow[]>(
      `SELECT m.id, m.tournament_id, m.start_at, m.status, m.round_number, m.team1_id, m.team2_id,
              t1.name AS team1_name, t2.name AS team2_name, t1.solo_user_id AS team1_solo, t2.solo_user_id AS team2_solo,
              m.referee_user_id, m.self_managed, ${firstStreamUrlSql("m")} AS stream_url
         FROM bg_matches m
         LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
         LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
        WHERE m.tournament_id IN (${inList(scheduled.length)})
          AND m.is_bye = 0 AND m.start_at IS NOT NULL AND m.start_at >= ? AND m.start_at < ?${onlyMatch}`,
      [...byId.keys(), from, to, ...(only?.kind === "MATCH" ? [only.id] : [])],
    );
    for (const match of matches) {
      const tournament = byId.get(Number(match.tournament_id));
      if (tournament) entries.push(matchEntry(match, tournament, durations, options.now));
    }
  }
  return entries.sort((a, b) => a.startAt - b.startAt || a.key.localeCompare(b.key));
}

type MemberRow = RowDataPacket & {
  id: number;
  pseudo: string;
  is_admin: number;
  platform_roles_json: string | null;
  solo_caster: number | null;
};

/** Comptes qui tiennent un rôle du planning (droits **réels**, la vue joueur n'y change rien). */
export async function loadPlanningMembers(executor: Executor): Promise<LoadedMember[]> {
  const [rows] = await executor.execute<MemberRow[]>(
    `SELECT u.id, u.pseudo, u.is_admin, u.platform_roles_json, p.solo_caster
       FROM bg_users u
       LEFT JOIN bg_planning_profiles p ON p.user_id = u.id
      WHERE u.is_deleted = 0 AND ${PLANNING_MEMBER_SQL}
      ORDER BY u.id`,
  );
  return toMembers(rows);
}

function toMembers(rows: readonly MemberRow[]): LoadedMember[] {
  return rows
    .map((row) => ({
      userId: Number(row.id),
      pseudo: visibleText(row.pseudo),
      roles: planningRolesOf({
        isAdmin: Number(row.is_admin) === 1,
        roles: resolveRoles(Number(row.is_admin) === 1, row.platform_roles_json),
      }),
      soloCaster: Number(row.solo_caster ?? 0) === 1,
    }))
    .filter((member) => member.roles.length > 0);
}

/**
 * Les comptes nommés, relus par leur clé (sans parcourir la table) : seuls
 * ceux qui sont encore vivants **et** tiennent encore un rôle du planning
 * sont rendus, avec leurs rôles, leur pseudo et leur réglage « caster
 * autonome » du moment.
 */
export async function loadPlanningMembersByIds(executor: Executor, ids: readonly number[]): Promise<LoadedMember[]> {
  if (ids.length === 0) return [];
  const [rows] = await executor.execute<MemberRow[]>(
    `SELECT u.id, u.pseudo, u.is_admin, u.platform_roles_json, p.solo_caster
       FROM bg_users u
       LEFT JOIN bg_planning_profiles p ON p.user_id = u.id
      WHERE u.id IN (${inList(ids.length)}) AND u.is_deleted = 0
      ORDER BY u.id`,
    [...ids],
  );
  return toMembers(rows);
}

type AvailabilityRow = RowDataPacket & {
  entry_key: string;
  user_id: number;
  role: PlanningRole;
  status: AvailabilityStatus;
  preferred: number;
};

type AssignmentRow = RowDataPacket & {
  entry_key: string;
  user_id: number;
  role: PlanningRole;
  source: AssignmentSource;
  reason: LoadedAssignment["reason"];
  confirmed: number;
};

type RemovalRow = RowDataPacket & { entry_key: string; user_id: number; role: PlanningRole };

type CasterRow = RowDataPacket & { match_id: number; user_id: number };

/**
 * Les comptes déjà lus par l'appelant (page : copie brève, voir `view.ts`) : la
 * lecture des membres n'est pas rejouée. `availabilityOf` : seules les
 * disponibilités de ce compte sont lues (un lecteur sans la permission
 * `tournaments` ne voit que les siennes — celles des autres ne quittent pas la base).
 */
type DataOptions = { now: number; includeHidden: boolean; members?: LoadedMember[]; availabilityOf?: number };

/** Les matchs de la fenêtre et leurs casters inscrits (`entryKey` → comptes), en une lecture. */
async function loadMatchCasters(executor: Executor, matchIds: readonly number[]): Promise<Map<string, number[]>> {
  const matchCasters = new Map<string, number[]>();
  if (matchIds.length === 0) return matchCasters;
  const [casters] = await executor.execute<CasterRow[]>(
    `SELECT match_id, user_id FROM bg_match_casters WHERE match_id IN (${inList(matchIds.length)}) ORDER BY user_id`,
    [...matchIds],
  );
  for (const row of casters) {
    const key = planningEntryKey("MATCH", Number(row.match_id));
    const list = matchCasters.get(key);
    if (list) list.push(Number(row.user_id));
    else matchCasters.set(key, [Number(row.user_id)]);
  }
  return matchCasters;
}

/**
 * Tout le planning des entrées de la fenêtre, en sept lectures au plus (les
 * durées, lues une seule fois, voyagent avec les entrées). Les lectures qui ne
 * dépendent que des entrées partent ensemble : sur une connexion de la piscine,
 * elles ne s'attendent pas l'une l'autre.
 */
export async function loadPlanningData(executor: Executor, options: DataOptions): Promise<PlanningData> {
  const durations = await loadDurationSettings(executor);
  const entries = await loadPlanningEntries(executor, { ...options, durations });
  const keys = entries.map((entry) => entry.key);
  const matchIds = entries.flatMap((entry) => (entry.matchId === null ? [] : [entry.matchId]));
  const membersRead = options.members ? Promise.resolve(options.members) : loadPlanningMembers(executor);
  if (entries.length === 0) {
    return { entries, durations, members: await membersRead, availability: [], assignments: [], removals: [], matchCasters: new Map() };
  }
  const [members, [availability], [assignments], [removals], matchCasters] = await Promise.all([
    membersRead,
    executor.execute<AvailabilityRow[]>(
      `SELECT entry_key, user_id, role, status, preferred FROM bg_planning_availability
        WHERE entry_key IN (${inList(keys.length)})${options.availabilityOf === undefined ? "" : " AND user_id = ?"}`,
      options.availabilityOf === undefined ? keys : [...keys, options.availabilityOf],
    ),
    executor.execute<AssignmentRow[]>(
      `SELECT entry_key, user_id, role, source, reason, confirmed FROM bg_planning_assignments
        WHERE entry_key IN (${inList(keys.length)})`,
      keys,
    ),
    executor.execute<RemovalRow[]>(
      `SELECT DISTINCT entry_key, user_id, role FROM bg_planning_events
        WHERE kind = 'REMOVED' AND source = 'MANUAL' AND entry_key IN (${inList(keys.length)})`,
      keys,
    ),
    loadMatchCasters(executor, matchIds),
  ]);
  return {
    entries,
    durations,
    members,
    availability: availability.map((row) => ({
      entryKey: row.entry_key,
      userId: Number(row.user_id),
      role: row.role,
      status: row.status,
      preferred: Number(row.preferred) === 1,
    })),
    assignments: assignments.map((row) => ({
      entryKey: row.entry_key,
      userId: Number(row.user_id),
      role: row.role,
      source: row.source,
      reason: row.reason,
      confirmed: row.source === "MANUAL" || Number(row.confirmed) === 1,
    })),
    removals: removals.map((row) => ({ entryKey: row.entry_key, userId: Number(row.user_id), role: row.role })),
    matchCasters,
  };
}

type HistoryRow = RowDataPacket & { user_id: number; jobs: number };

/**
 * Charge des semaines qui précèdent celle du lot (équité) : attributions du
 * planning, arbitres désignés et casters inscrits sur les entrées commencées
 * entre {@link planningHistoryStart} et le début de la semaine de `weekOf`
 * (un instant de la semaine du lot). Un lot calculé à l'avance compte donc
 * aussi le travail déjà tenu des semaines qui le séparent d'aujourd'hui. Seul
 * le travail tenu pèse (une attribution retirée, ou restée provisoire, n'y
 * compte pas).
 */
export async function loadPlanningHistory(executor: Executor, weekOf: number): Promise<Map<number, number>> {
  const from = new Date(planningHistoryStart(weekOf));
  const to = new Date(planningWeekStart(weekOf));
  const [rows] = await executor.execute<HistoryRow[]>(
    `SELECT user_id, COUNT(*) AS jobs FROM (
       SELECT a.user_id FROM bg_planning_assignments a
         JOIN bg_tournaments t ON t.id = a.tournament_id
         LEFT JOIN bg_matches m ON m.id = a.match_id
        WHERE NOT (a.role = 'REFEREE' AND a.match_id IS NOT NULL)
          AND (a.source = 'MANUAL' OR a.confirmed = 1)
          AND COALESCE(m.start_at, t.start_at) >= ? AND COALESCE(m.start_at, t.start_at) < ?
       UNION ALL
       SELECT m.referee_user_id AS user_id FROM bg_matches m
        WHERE m.referee_user_id IS NOT NULL AND m.start_at >= ? AND m.start_at < ?
       UNION ALL
       SELECT c.user_id FROM bg_match_casters c JOIN bg_matches m ON m.id = c.match_id
        WHERE m.start_at >= ? AND m.start_at < ?
          AND NOT EXISTS (SELECT 1 FROM bg_planning_assignments pa
                           WHERE pa.match_id = c.match_id AND pa.user_id = c.user_id AND pa.role = 'CASTER'
                             AND (pa.source = 'MANUAL' OR pa.confirmed = 1))
     ) jobs GROUP BY user_id`,
    [from, to, from, to, from, to],
  );
  return new Map(rows.map((row) => [Number(row.user_id), Number(row.jobs)]));
}
