import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/cast-notices");
jest.mock("@/lib/server/tournaments/referee-notices");

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import {
  announceCastChange,
  discardCastChanges,
  flushCastChanges,
  queueCastChange,
} from "@/lib/server/tournaments/cast-notices";
import { announceRefereeChange, queueRefereeChange } from "@/lib/server/tournaments/referee-notices";
import {
  assignMatchReferee,
  claimMatchCast,
  forceLaunchMatch,
  loadViewerCastBlock,
  maintainMatchLaunches,
  releaseIneligibleCast,
  releaseIneligibleReferee,
  releaseMatchCast,
  releaseMatchReferee,
  releaseObjectingReferee,
  setMatchFirstMap,
  setMatchHost,
  setMatchReady,
  setMatchSelfManaged,
  setRoundSelfManaged,
  takeMatchReferee,
} from "@/lib/server/tournaments/match-launch";
import { fakeConnection } from "../../helpers/sql-double";

/**
 * Service du lancement d'un match, contre une connexion **à état** : les
 * écritures sont rejouées sur la ligne du match, si bien qu'une lecture qui
 * suit une écriture voit ce qu'elle a écrit — c'est ce qui décide du lancement.
 */

const TEAM1 = 10;
const TEAM2 = 20;
const CASTER = 900;

type MatchState = {
  id: number;
  tournament_id: number;
  tournament_state: string;
  /** Option du tournoi : 1 = phase de lancement allumée. */
  match_launch_phase: number;
  status: string;
  is_bye: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_is_ghost: number;
  team2_is_ghost: number;
  start_at: string | null;
  lobby_opened_at: string | null;
  launch_pairing: string | null;
  launched_at: string | null;
  team1_ready_at: string | null;
  team2_ready_at: string | null;
  host_team_id: number | null;
  /** Arbitre désigné (`docs/features/MATCH_REFEREE.md`), son « Prêt », l'autogestion, la première carte. */
  referee_user_id: number | null;
  referee_ready_at: string | null;
  self_managed: number;
  first_map: string | null;
  /** `bg_match_casters` du match, dans l'ordre d'inscription. */
  casters: CasterState[];
  /** `bg_match_streams` du match (`staff_owned` : 1 = stream du staff). */
  streams: { id: number; live_url: string | null; staff_owned?: number; link_user_id?: number }[];
};

type CasterState = { user_id: number; stream_id: number; ready_at: string | null };

/**
 * Raccourci des fixtures : `caster_user_id` / `caster_ready_at` décrivent le
 * premier caster (sur le stream 1), comme avant les co-casters.
 */
type MatchOverrides = Partial<MatchState> & { caster_user_id?: number | null; caster_ready_at?: string | null };

type Membership = { userId: number; teamId: number; roles: string[] };

type World = {
  match: MatchState | null;
  memberships: Membership[];
  soloEntries: { userId: number; teamId: number }[];
  users: Record<number, { discord_verified_at: string | null; discord_pseudo: string | null; blizzard_sub: string | null; overwatch_battletag: string | null; is_deleted: number; is_admin?: number; platform_roles_json?: string | null; referee_objection_at?: string | null }>;
  writes: string[];
  /** Réservations d'alerte d'arbitrage (`bg_referee_alerts`), `match:clé`. */
  alerts?: string[];
  /** Cartes réglées de la manche du match (`bg_tournament_round_maps.slots_json`), aucune par défaut. */
  roundSlots?: string;
};

const STAMP = "2026-09-24 20:00:00";

function matchState(overrides: MatchOverrides = {}): MatchState {
  const { caster_user_id: casterId = null, caster_ready_at: casterReadyAt = null, ...rest } = overrides;
  const firstCaster: CasterState[] = casterId === null ? [] : [{ user_id: casterId, stream_id: 1, ready_at: casterReadyAt }];
  return {
    id: 42,
    tournament_id: 7,
    tournament_state: "RUNNING",
    match_launch_phase: 1,
    status: "READY",
    is_bye: 0,
    team1_id: TEAM1,
    team2_id: TEAM2,
    team1_is_ghost: 0,
    team2_is_ghost: 0,
    start_at: null,
    lobby_opened_at: null,
    launch_pairing: `${TEAM1}:${TEAM2}`,
    launched_at: null,
    team1_ready_at: null,
    team2_ready_at: null,
    host_team_id: null,
    referee_user_id: null,
    referee_ready_at: null,
    self_managed: 0,
    first_map: null,
    casters: firstCaster,
    streams: casterId === null ? [] : [{ id: 1, live_url: null }],
    ...rest,
  };
}

/** Premier caster du match, `null` sans. */
function casterOf(state: World): number | null {
  return state.match?.casters[0]?.user_id ?? null;
}

/** « Prêt » du premier caster, `null` sans. */
function casterReadyOf(state: World): string | null {
  return state.match?.casters[0]?.ready_at ?? null;
}

function world(overrides: Partial<World> = {}): World {
  return {
    match: matchState(),
    memberships: [
      { userId: 1, teamId: TEAM1, roles: ["CAPITAINE"] },
      { userId: 2, teamId: TEAM1, roles: ["DPS"] },
      { userId: 3, teamId: TEAM2, roles: ["OWNER"] },
    ],
    soloEntries: [],
    users: {},
    writes: [],
    ...overrides,
  };
}

/** Les trois signaux « prêt » : posés à `NOW()`, levés à `NULL`. */
function applyReadyStamps(sql: string, set: (column: keyof MatchState, value: unknown) => void) {
  for (const column of ["team1_ready_at", "team2_ready_at", "referee_ready_at"] as const) {
    if (sql.includes(`${column} = NOW()`)) set(column, STAMP);
    if (sql.includes(`${column} = NULL`)) set(column, null);
  }
}

/** Rejoue une écriture sur la ligne du match — ce que ferait la base. */
function applyUpdate(state: World, sql: string, params: unknown[]) {
  const match = state.match;
  if (!match) return;
  const set = (column: keyof MatchState, value: unknown) => {
    (match as Record<string, unknown>)[column] = value;
  };
  applyReadyStamps(sql, set);
  if (sql.includes("lobby_opened_at = COALESCE(lobby_opened_at, NOW())") && !match.lobby_opened_at) {
    set("lobby_opened_at", STAMP);
  }
  if (sql.includes("SET lobby_opened_at = NOW()")) set("lobby_opened_at", STAMP);
  if (sql.includes("launched_at = NOW()")) set("launched_at", STAMP);
  if (sql.includes("SET host_team_id = ?")) set("host_team_id", params[0]);
  if (sql.includes("SET referee_user_id = ?")) set("referee_user_id", params[0]);
  if (sql.includes("referee_ready_at = ?, self_managed = 0")) set("referee_ready_at", params[1]);
  if (sql.includes("referee_user_id = NULL")) set("referee_user_id", null);
  if (sql.includes("self_managed = 1")) set("self_managed", 1);
  if (sql.includes("self_managed = 0")) set("self_managed", 0);
  if (sql.includes("SET first_map = ?")) set("first_map", params[0]);
  if (sql.includes("SET launch_pairing = ?")) {
    set("launch_pairing", params[0]);
    for (const column of ["lobby_opened_at", "launched_at", "team1_ready_at", "team2_ready_at", "referee_ready_at"] as const) {
      set(column, null);
    }
  }
}

/** Contexte du match relu hors verrou (tournoi, statut fantôme). */
function matchContextRows(state: World) {
  const match = state.match;
  if (!match) return [];
  return [{
    tournament_state: match.tournament_state,
    match_launch_phase: match.match_launch_phase,
    team1_is_ghost: match.team1_is_ghost,
    team2_is_ghost: match.team2_is_ghost,
  }];
}

/** Candidat au lancement : prêt, jamais lancé (ou appariement périmé), deux équipes. */
function launchCandidateRows(state: World) {
  const match = state.match;
  if (!match) return [];
  const stale = match.launch_pairing !== `${match.team1_id}:${match.team2_id}`;
  const candidate =
    match.status === "READY" &&
    (match.launched_at === null || stale) &&
    match.team1_id &&
    match.team2_id;
  return candidate ? [{ ...match }] : [];
}

/**
 * Écritures sur les casters et les streams du match (`bg_match_casters`,
 * `bg_match_streams`), rejouées sur l'état ; `null` : pas l'une d'elles.
 */
function applyCastWrite(state: World, sql: string, params: unknown[]): unknown[] | null {
  const match = state.match;
  if (!/^(UPDATE|DELETE FROM|INSERT INTO) bg_match_(casters|streams)/.test(sql)) return null;
  state.writes.push(sql);
  if (!match) return [{ affectedRows: 0 }, []];
  if (sql.includes("bg_match_streams")) return applyStreamWrite(match, sql, params);
  applyCasterWrite(match, sql, params);
  return [{ affectedRows: 1 }, []];
}

/** `bg_match_casters` : « Prêt », retrait, inscription. */
function applyCasterWrite(match: MatchState, sql: string, params: unknown[]): void {
  if (sql.startsWith("UPDATE bg_match_casters SET ready_at")) {
    const value = sql.includes("ready_at = NOW()") ? STAMP : null;
    const userId = sql.includes("AND user_id = ?") ? Number(params[1]) : null;
    for (const caster of match.casters) if (userId === null || caster.user_id === userId) caster.ready_at = value;
  } else if (sql.startsWith("DELETE FROM bg_match_casters")) {
    const ids = params.slice(1).map(Number);
    match.casters = match.casters.filter((caster) => !ids.includes(caster.user_id));
  } else if (sql.startsWith("INSERT INTO bg_match_casters")) {
    match.casters.push({ user_id: Number(params[1]), stream_id: Number(params[2]), ready_at: null });
  }
}

/** `bg_match_streams` : ménage et stream neuf (qui rend son `insertId`). */
function applyStreamWrite(match: MatchState, sql: string, params: unknown[]): unknown[] {
  if (sql.startsWith("DELETE FROM bg_match_streams")) {
    const ids = params.slice(1).map(Number);
    match.streams = match.streams.filter((stream) => !ids.includes(stream.id));
  } else if (sql.startsWith("INSERT INTO bg_match_streams")) {
    const id = Math.max(0, ...match.streams.map((stream) => stream.id)) + 1;
    const linkUserId = params[2] == null ? {} : { link_user_id: Number(params[2]) };
    match.streams.push({ id, live_url: (params[1] as string | null) ?? null, ...linkUserId });
    return [{ affectedRows: 1, insertId: id }, []];
  }
  return [{ affectedRows: 1 }, []];
}

/** Lectures des casters et des streams d'un match. */
function readCastRows(state: World, sql: string): unknown[] | null {
  const match = state.match;
  if (sql.includes("FROM bg_match_casters WHERE match_id = ?")) {
    return [(match?.casters ?? []).map((caster) => ({ match_id: match?.id, ...caster })), []];
  }
  if (sql.includes("FROM bg_match_streams WHERE match_id = ?")) {
    return [(match?.streams ?? []).map((stream) => ({ match_id: match?.id, ...stream })), []];
  }
  return null;
}

/** Lectures de la première carte et des cartes de la manche (`ROUND_MAPS.md`), `null` pour les autres requêtes. */
function readFirstMapRows(state: World, sql: string): [unknown, unknown[]] | null {
  if (sql.startsWith("SELECT tournament_id, status, first_map, phase_id, bracket, round_number FROM bg_matches")) {
    return [state.match ? [{ ...state.match }] : [], []];
  }
  if (sql.startsWith("SELECT slots_json FROM bg_tournament_round_maps")) {
    return [state.roundSlots ? [{ slots_json: state.roundSlots }] : [], []];
  }
  return null;
}

/** Lectures et réservations du bloc « arbitre désigné », `null` pour les autres requêtes. */
function readRefereeRows(state: World, sql: string, params: unknown[]): [unknown, unknown[]] | null {
  if (sql.startsWith("SELECT 1 FROM bg_referee_alerts")) {
    return [(state.alerts ?? []).includes(`${params[0]}:${params[1]}`) ? [{ 1: 1 }] : [], []];
  }
  if (sql.startsWith("INSERT IGNORE INTO bg_referee_alerts")) {
    state.alerts = [...(state.alerts ?? []), `${params[0]}:${params[1]}`];
    return [{ affectedRows: 1, insertId: state.alerts.length }, []];
  }
  const mapRows = readFirstMapRows(state, sql);
  if (mapRows) return mapRows;
  if (sql.startsWith("SELECT id FROM bg_tournaments")) {
    return [state.match ? [{ id: state.match.tournament_id }] : [], []];
  }
  if (sql.startsWith("SELECT id FROM bg_matches WHERE tournament_id = ?")) {
    const match = state.match;
    return [match && match.status !== "COMPLETED" && match.is_bye === 0 ? [{ id: match.id }] : [], []];
  }
  return null;
}

/** Le double de `execute`, non typé en `PoolConnection` : les tests le composent. */
function executeFor(state: World) {
  return async (rawSql: string, params: unknown[] = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    const castResult = applyCastWrite(state, sql, params) ?? readCastRows(state, sql);
    if (castResult) return castResult;
    if (sql.startsWith("UPDATE")) {
      state.writes.push(sql);
      applyUpdate(state, sql, params);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("FROM bg_users WHERE id = ?")) {
      const user = state.users[Number(params[0])];
      return [user ? [user] : [], []];
    }
    if (sql.includes("solo_user_id = ?")) {
      const userId = Number(params[0]);
      const ids = params.slice(1).map(Number);
      const rows = state.soloEntries
        .filter((s) => s.userId === userId && ids.includes(s.teamId))
        .map((s) => ({ id: s.teamId }));
      return [rows, []];
    }
    if (sql.includes("FROM bg_team_members")) {
      const userId = Number(params[0]);
      const ids = params.slice(1).map(Number);
      const rows = state.memberships
        .filter((m) => m.userId === userId && ids.includes(m.teamId))
        .map((m) => ({ team_id: m.teamId, roles_json: JSON.stringify(m.roles) }));
      return [rows.slice(0, 1), []];
    }
    const refereeResult = readRefereeRows(state, sql, params);
    if (refereeResult) return refereeResult;
    if (sql.includes("AS tournament_state") && !sql.includes("FROM bg_matches")) {
      return [matchContextRows(state), []];
    }
    if (sql.includes("FROM bg_matches m") && sql.includes("WHERE m.tournament_id = ?")) {
      return [launchCandidateRows(state), []];
    }
    if (sql.includes("FROM bg_matches m")) {
      return [state.match ? [{ ...state.match }] : [], []];
    }
    throw new Error(`requête inattendue : ${sql}`);
  };
}

function connectionFor(state: World): PoolConnection {
  return fakeConnection({
    execute: executeFor(state),
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
  });
}

let state: World;

beforeEach(() => {
  jest.clearAllMocks();
  state = world();
  jest
    .mocked(withConnection)
    .mockImplementation((run) => run(connectionFor(state)));
});

describe("setMatchReady", () => {
  it("pose le « Prêt » du capitaine et ouvre le délai de lancement", async () => {
    await expect(setMatchReady(42, 1, true)).resolves.toEqual({ launched: false });
    expect(state.match?.team1_ready_at).toBe(STAMP);
    expect(state.match?.lobby_opened_at).toBe(STAMP);
    expect(state.match?.launched_at).toBeNull();
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
  });

  it("lance le match au dernier « Prêt » attendu", async () => {
    state.match = matchState({ team2_ready_at: STAMP });
    await expect(setMatchReady(42, 1, true)).resolves.toEqual({ launched: true });
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("attend le caster inscrit avant de lancer", async () => {
    state.match = matchState({ team2_ready_at: STAMP, caster_user_id: CASTER });
    state.users[CASTER] = ELIGIBLE_CASTER;
    await expect(setMatchReady(42, 1, true)).resolves.toEqual({ launched: false });
    await expect(setMatchReady(42, CASTER, true)).resolves.toEqual({ launched: true });
    expect(casterReadyOf(state)).toBe(STAMP);
  });

  it("co-casters : chacun son « Prêt », le match part au dernier attendu", async () => {
    state.match = matchState({ team1_ready_at: STAMP, team2_ready_at: STAMP, caster_user_id: CASTER });
    state.match.casters.push({ user_id: 901, stream_id: 1, ready_at: null });
    state.users[CASTER] = ELIGIBLE_CASTER;
    state.users[901] = ELIGIBLE_CASTER;
    await expect(setMatchReady(42, CASTER, true)).resolves.toEqual({ launched: false });
    expect(state.match?.casters.map((caster) => caster.ready_at)).toEqual([STAMP, null]);
    await expect(setMatchReady(42, 901, true)).resolves.toEqual({ launched: true });
    expect(state.match?.casters.map((caster) => caster.ready_at)).toEqual([STAMP, STAMP]);
  });

  it("co-casters : retirer son « Prêt » ne touche pas celui de l'autre", async () => {
    state.match = matchState({ caster_user_id: CASTER, caster_ready_at: STAMP });
    state.match.casters.push({ user_id: 901, stream_id: 1, ready_at: STAMP });
    state.users[901] = ELIGIBLE_CASTER;
    await setMatchReady(42, 901, false);
    expect(state.match?.casters.map((caster) => caster.ready_at)).toEqual([STAMP, null]);
  });

  it.each<[string, Partial<typeof ELIGIBLE_CASTER>]>([
    ["sans la permission `live`", { platform_roles_json: JSON.stringify(["RECRUTEUR"]) }],
    ["au tag décertifié", { discord_verified_at: null }],
    ["sans Battle.net", { blizzard_sub: null }],
  ])("refuse le « Prêt » d'un caster inscrit %s", async (_label, overrides) => {
    state.match = matchState({ team2_ready_at: STAMP, caster_user_id: CASTER });
    state.users[CASTER] = { ...ELIGIBLE_CASTER, ...overrides };
    await expect(setMatchReady(42, CASTER, true)).rejects.toThrow("NOT_MATCH_PARTY");
    expect(casterReadyOf(state)).toBeNull();
  });

  it("compte une fantôme prête d'office : l'équipe réelle suffit", async () => {
    state.match = matchState({ team2_is_ghost: 1 });
    await expect(setMatchReady(42, 1, true)).resolves.toEqual({ launched: true });
  });

  it("retire un « Prêt » sans rien lancer", async () => {
    state.match = matchState({ team1_ready_at: STAMP });
    await expect(setMatchReady(42, 1, false)).resolves.toEqual({ launched: false });
    expect(state.match?.team1_ready_at).toBeNull();
  });

  it("écrit dans la colonne de l'équipe 2 pour son propriétaire", async () => {
    await setMatchReady(42, 3, true);
    expect(state.match?.team2_ready_at).toBe(STAMP);
    expect(state.match?.team1_ready_at).toBeNull();
  });

  it("accepte le joueur d'une entrée solo", async () => {
    state.soloEntries = [{ userId: 50, teamId: TEAM2 }];
    await setMatchReady(42, 50, true);
    expect(state.match?.team2_ready_at).toBe(STAMP);
  });

  it("refuse un joueur du roster sans rôle d'engagement", async () => {
    await expect(setMatchReady(42, 2, true)).rejects.toThrow("NOT_TEAM_READY_ROLE");
    expect(state.writes).toEqual([]);
  });

  it("refuse qui n'est ni joueur ni caster du match", async () => {
    await expect(setMatchReady(42, 777, true)).rejects.toThrow("NOT_MATCH_PARTY");
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse un match introuvable", async () => {
    state.match = null;
    await expect(setMatchReady(42, 1, true)).rejects.toThrow("MATCH_NOT_FOUND");
  });

  it("tient pour introuvable un match dont le tournoi a disparu", async () => {
    // Même effet que l'ancienne jointure interne : pas de ligne, donc pas un
    // « tournoi pas en cours » qui laisserait croire qu'il existe encore.
    const base = executeFor(state);
    jest.mocked(withConnection).mockImplementation((run) =>
      run(
        fakeConnection({
          execute: async (sql: string, params: unknown[] = []) =>
            /AS tournament_state/.test(sql) && !/FROM bg_matches/.test(sql)
              ? [[{ tournament_state: null, team1_is_ghost: null, team2_is_ghost: null }], []]
              : base(sql, params),
          beginTransaction: async () => undefined,
          commit: async () => undefined,
          rollback: async () => undefined,
        }),
      ),
    );
    await expect(setMatchReady(42, 1, true)).rejects.toThrow("MATCH_NOT_FOUND");
  });

  it("refuse hors d'un tournoi en cours", async () => {
    state.match = matchState({ tournament_state: "FINISHED" });
    await expect(setMatchReady(42, 1, true)).rejects.toThrow("TOURNAMENT_NOT_RUNNING");
  });

  it("refuse avant l'heure de début", async () => {
    state.match = matchState({ start_at: new Date(Date.now() + 3_600_000).toISOString() });
    await expect(setMatchReady(42, 1, true)).rejects.toThrow("MATCH_NOT_IN_LOBBY");
  });

  it("refuse de retirer un « Prêt » une fois le match lancé", async () => {
    state.match = matchState({ launched_at: STAMP, team1_ready_at: STAMP });
    await expect(setMatchReady(42, 1, false)).rejects.toThrow("MATCH_ALREADY_LAUNCHED");
    expect(state.match?.team1_ready_at).toBe(STAMP);
  });
});

describe("setMatchReady — appariement réécrit sur place", () => {
  it("n'hérite pas du « Prêt » de l'équipe remplacée", async () => {
    // Le créneau 2 portait l'équipe 30, prête ; une correction y a mis l'équipe
    // 20. Son « Prêt » ne vaut rien pour la nouvelle.
    state.match = matchState({ launch_pairing: `${TEAM1}:30`, team2_ready_at: STAMP });
    await expect(setMatchReady(42, 1, true)).resolves.toEqual({ launched: false });
    expect(state.match?.launch_pairing).toBe(`${TEAM1}:${TEAM2}`);
    expect(state.match?.team2_ready_at).toBeNull();
    expect(state.match?.team1_ready_at).toBe(STAMP);
  });

  it("ne tient pas pour lancé un match lancé sous un autre appariement", async () => {
    state.match = matchState({ launch_pairing: `${TEAM1}:30`, launched_at: STAMP });
    await expect(setMatchReady(42, 1, true)).resolves.toEqual({ launched: false });
    expect(state.match?.launched_at).toBeNull();
  });
});

describe("caster inscrit avant que son équipe n'atteigne le match", () => {
  it("le désinscrit quand l'appariement qui arrive compte son équipe", async () => {
    // Inscrit sur un match aux créneaux vides, puis son équipe (TEAM1) l'atteint.
    state.memberships.push({ userId: CASTER, teamId: TEAM1, roles: ["DPS"] });
    state.match = matchState({ launch_pairing: null, caster_user_id: CASTER });
    const connection = connectionFor(state);
    await maintainMatchLaunches(connection, 7);
    expect(casterOf(state)).toBeNull();
    // Annoncé comme tout retrait d'office, après le commit de l'appelant.
    expect(queueCastChange).toHaveBeenCalledWith(connection, {
      kind: "AUTO_RELEASED",
      matchId: 42,
      casterId: CASTER,
      reason: "JOINED_TEAM",
    });
    expect(announceCastChange).not.toHaveBeenCalled();
  });

  it("garde un caster étranger aux deux équipes", async () => {
    state.match = matchState({ launch_pairing: null, caster_user_id: CASTER });
    await maintainMatchLaunches(connectionFor(state), 7);
    expect(casterOf(state)).toBe(CASTER);
    expect(queueCastChange).not.toHaveBeenCalled();
  });

  it("annonce après le commit le caster désinscrit par un « Prêt »", async () => {
    state.memberships.push({ userId: CASTER, teamId: TEAM1, roles: ["DPS"] });
    state.match = matchState({ launch_pairing: null, caster_user_id: CASTER });
    await setMatchReady(42, 1, true);
    expect(casterOf(state)).toBeNull();
    expect(queueCastChange).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "JOINED_TEAM" }));
    expect(flushCastChanges).toHaveBeenCalledTimes(1);
    expect(discardCastChanges).not.toHaveBeenCalled();
  });

  it("n'annonce rien quand la transaction échoue", async () => {
    state.memberships.push({ userId: CASTER, teamId: TEAM1, roles: ["DPS"] });
    state.match = matchState({ launch_pairing: null, caster_user_id: CASTER });
    // Un lecteur étranger au match : refusé après la désinscription, tout est annulé.
    await expect(setMatchReady(42, 999, true)).rejects.toThrow("NOT_MATCH_PARTY");
    expect(queueCastChange).toHaveBeenCalledTimes(1);
    expect(discardCastChanges).toHaveBeenCalledTimes(1);
    expect(flushCastChanges).not.toHaveBeenCalled();
  });

  it("fait agir en joueur celui qui est à la fois inscrit comme caster et joueur", async () => {
    state.match = matchState({ caster_user_id: 1 });
    await setMatchReady(42, 1, true);
    expect(state.match?.team1_ready_at).toBe(STAMP);
    expect(casterReadyOf(state)).toBeNull();
  });
});

describe("forceLaunchMatch", () => {
  it("lance un match en lancement sans attendre", async () => {
    await forceLaunchMatch(42);
    expect(state.match?.launched_at).toBe(STAMP);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
  });

  it("lance aussi avant l'heure de début", async () => {
    state.match = matchState({ start_at: new Date(Date.now() + 3_600_000).toISOString() });
    await forceLaunchMatch(42);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("refuse un match déjà lancé, sans ses deux engagées, ou hors tournoi en cours", async () => {
    state.match = matchState({ launched_at: STAMP });
    await expect(forceLaunchMatch(42)).rejects.toThrow("MATCH_ALREADY_LAUNCHED");
    state.match = matchState({ team2_id: null });
    await expect(forceLaunchMatch(42)).rejects.toThrow("MATCH_NOT_LAUNCHABLE");
    state.match = matchState({ tournament_state: "UPCOMING" });
    await expect(forceLaunchMatch(42)).rejects.toThrow("TOURNAMENT_NOT_RUNNING");
    state.match = null;
    await expect(forceLaunchMatch(42)).rejects.toThrow("MATCH_NOT_FOUND");
  });
});

/** Un caster qui remplit toujours la condition : permission `live` et identité. */
const ELIGIBLE_CASTER = {
  discord_verified_at: STAMP as string | null,
  discord_pseudo: "caster" as string | null,
  blizzard_sub: "sub" as string | null,
  overwatch_battletag: "Caster#1" as string | null,
  is_deleted: 0,
  is_admin: 0,
  platform_roles_json: JSON.stringify(["CASTER"]) as string | null,
};

describe("claimMatchCast", () => {
  const verified = {
    discord_verified_at: STAMP,
    discord_pseudo: "caster",
    blizzard_sub: "sub",
    overwatch_battletag: "Caster#1",
    is_deleted: 0,
  };

  it("inscrit un caster à l'identité vérifiée", async () => {
    state.users[CASTER] = verified;
    await claimMatchCast(42, CASTER, true);
    expect(casterOf(state)).toBe(CASTER);
    // Sans stream sur le match : un stream sans lien est ouvert pour lui.
    expect(state.match?.streams).toEqual([{ id: 1, live_url: null }]);
    expect(state.match?.casters).toEqual([{ user_id: CASTER, stream_id: 1, ready_at: null }]);
    // Aucun lien neuf : l'accueil n'a rien à relire.
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: false });
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "CLAIMED", matchId: 42, replacedCasterId: null });
  });

  it("ouvre un stream à part avec son lien, normalisé : l'accueil relit", async () => {
    state.users[CASTER] = verified;
    state.users[901] = ELIGIBLE_CASTER;
    state.match = matchState({ caster_user_id: 901 });
    await claimMatchCast(42, CASTER, true, { liveUrl: "  https://www.twitch.tv/Voix  " });
    expect(state.match?.streams).toEqual([
      { id: 1, live_url: null },
      // Le lien est rattaché à celui qui le fournit : son effacement le retire.
      { id: 2, live_url: "https://www.twitch.tv/Voix", link_user_id: CASTER },
    ]);
    expect(state.match?.casters.map((caster) => [caster.user_id, caster.stream_id])).toEqual([[901, 1], [CASTER, 2]]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
  });

  it("co-caste un stream du match : aucun stream de plus", async () => {
    state.users[CASTER] = verified;
    state.users[901] = ELIGIBLE_CASTER;
    state.match = matchState({ caster_user_id: 901 });
    await claimMatchCast(42, CASTER, true, { streamId: 1 });
    expect(state.match?.streams).toHaveLength(1);
    expect(state.match?.casters.map((caster) => [caster.user_id, caster.stream_id])).toEqual([[901, 1], [CASTER, 1]]);
  });

  it("refuse un stream qui n'est pas celui du match, sans rien écrire", async () => {
    state.users[CASTER] = verified;
    state.match = matchState({ caster_user_id: 901 });
    await expect(claimMatchCast(42, CASTER, true, { streamId: 99 })).rejects.toThrow("STREAM_NOT_FOUND");
    expect(state.writes).toEqual([]);
    expect(announceCastChange).not.toHaveBeenCalled();
  });

  it("refuse, avant le lancement, un stream que seul tient un caster tu : sa chaîne ne réapparaît pas", async () => {
    state.users[CASTER] = verified;
    // 901 a perdu la permission `live` : son stream (et son lien) est tu.
    state.users[901] = { ...ELIGIBLE_CASTER, platform_roles_json: null };
    state.match = matchState({ caster_user_id: 901, streams: [{ id: 1, live_url: "https://twitch.tv/a" }] });
    await expect(claimMatchCast(42, CASTER, true, { streamId: 1 })).rejects.toThrow("STREAM_NOT_FOUND");
    expect(state.writes).toEqual([]);
    expect(announceCastChange).not.toHaveBeenCalled();
    // Un caster encore éligible sur le même stream le rend montré, donc joignable.
    state.users[902] = ELIGIBLE_CASTER;
    state.match.casters.push({ user_id: 902, stream_id: 1, ready_at: null });
    await claimMatchCast(42, CASTER, true, { streamId: 1 });
    expect(state.match.casters.map((caster) => caster.user_id)).toEqual([901, 902, CASTER]);
  });

  it("rejoint le stream du staff sans caster, et tout stream d'un match lancé", async () => {
    state.users[CASTER] = verified;
    state.match = matchState({ streams: [{ id: 1, live_url: "https://twitch.tv/officiel", staff_owned: 1 }] });
    await claimMatchCast(42, CASTER, true, { streamId: 1 });
    expect(state.match.casters).toEqual([{ user_id: CASTER, stream_id: 1, ready_at: null }]);
    // Lancé : la lecture ne tait plus aucun caster, son stream se rejoint.
    state.users[901] = { ...ELIGIBLE_CASTER, platform_roles_json: null };
    state.match = matchState({ caster_user_id: 901, launched_at: STAMP });
    await claimMatchCast(42, CASTER, true, { streamId: 1 });
    expect(state.match.casters.map((caster) => caster.user_id)).toEqual([901, CASTER]);
  });

  it("refuse un lien non reconnu avant toute lecture", async () => {
    state.users[CASTER] = verified;
    await expect(claimMatchCast(42, CASTER, true, { liveUrl: "https://exemple.invalid/live" })).rejects.toThrow("INVALID_STREAM_URL");
    expect(withConnection).not.toHaveBeenCalled();
    // Un lien vide vaut « sans lien ».
    await claimMatchCast(42, CASTER, true, { liveUrl: "   " });
    expect(state.match?.streams).toEqual([{ id: 1, live_url: null }]);
  });

  it("refuse sans la permission `live`", async () => {
    state.users[CASTER] = verified;
    await expect(claimMatchCast(42, CASTER, false)).rejects.toThrow("NOT_CASTER");
    expect(casterOf(state)).toBeNull();
    expect(announceCastChange).not.toHaveBeenCalled();
  });

  it("refuse sans tag Discord certifié, ou sans compte Battle.net rattaché", async () => {
    state.users[CASTER] = { ...verified, discord_verified_at: null };
    await expect(claimMatchCast(42, CASTER, true)).rejects.toThrow("CASTER_IDENTITY_REQUIRED");
    state.users[CASTER] = { ...verified, blizzard_sub: null };
    await expect(claimMatchCast(42, CASTER, true)).rejects.toThrow("CASTER_IDENTITY_REQUIRED");
    state.users[CASTER] = { ...verified, overwatch_battletag: null };
    await expect(claimMatchCast(42, CASTER, true)).rejects.toThrow("CASTER_IDENTITY_REQUIRED");
  });

  it("refuse un compte supprimé ou introuvable", async () => {
    state.users[CASTER] = { ...verified, is_deleted: 1 };
    await expect(claimMatchCast(42, CASTER, true)).rejects.toThrow("CASTER_IDENTITY_REQUIRED");
    await expect(claimMatchCast(42, 12345, true)).rejects.toThrow("CASTER_IDENTITY_REQUIRED");
  });

  it("refuse un joueur du match", async () => {
    state.users[1] = verified;
    await expect(claimMatchCast(42, 1, true)).rejects.toThrow("CASTER_IS_PLAYER");
  });

  it("sans plafond : un troisième caster s'ajoute ; rejouer sa propre inscription ne change rien", async () => {
    state.users[CASTER] = verified;
    state.users[901] = ELIGIBLE_CASTER;
    state.users[902] = ELIGIBLE_CASTER;
    state.match = matchState({ caster_user_id: 901 });
    state.match.casters.push({ user_id: 902, stream_id: 1, ready_at: null });
    await claimMatchCast(42, CASTER, true, { streamId: 1 });
    expect(state.match?.casters.map((caster) => caster.user_id)).toEqual([901, 902, CASTER]);
    jest.clearAllMocks();
    state.match = matchState({ caster_user_id: CASTER, caster_ready_at: STAMP });
    state.writes = [];
    await claimMatchCast(42, CASTER, true, { liveUrl: "https://twitch.tv/autre" });
    expect(state.writes).toEqual([]);
    // Rejouée, l'inscription ne défait pas un « Prêt » déjà donné.
    expect(casterReadyOf(state)).toBe(STAMP);
    // Ni l'inscription refusée ni l'inscription rejouée ne s'annoncent.
    expect(announceCastChange).not.toHaveBeenCalled();
  });

  it("ne déplace personne : un caster inéligible garde sa place (`releaseIneligibleCast` la reprend), le nouveau s'ajoute", async () => {
    state.users[CASTER] = verified;
    state.users[901] = { ...ELIGIBLE_CASTER, platform_roles_json: null };
    state.match = matchState({ caster_user_id: 901, caster_ready_at: STAMP });
    await claimMatchCast(42, CASTER, true);
    expect(state.match?.casters).toEqual([
      { user_id: 901, stream_id: 1, ready_at: STAMP },
      { user_id: CASTER, stream_id: 2, ready_at: null },
    ]);
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "CLAIMED", matchId: 42, replacedCasterId: null });
  });

  it("un match lancé accueille un co-caster sans toucher au caster en place", async () => {
    state.users[CASTER] = verified;
    state.match = matchState({ caster_user_id: 901, caster_ready_at: STAMP, launched_at: STAMP });
    await claimMatchCast(42, CASTER, true, { streamId: 1 });
    expect(state.match?.casters).toEqual([
      { user_id: 901, stream_id: 1, ready_at: STAMP },
      { user_id: CASTER, stream_id: 1, ready_at: null },
    ]);
  });

  it("refuse un match terminé ou une exemption", async () => {
    state.users[CASTER] = verified;
    state.match = matchState({ status: "COMPLETED" });
    await expect(claimMatchCast(42, CASTER, true)).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    state.match = matchState({ is_bye: 1, team2_id: null });
    await expect(claimMatchCast(42, CASTER, true)).rejects.toThrow("MATCH_NOT_LAUNCHABLE");
  });
});

describe("releaseMatchCast", () => {
  it("retire son inscription et le « Prêt » qui va avec", async () => {
    state.match = matchState({ caster_user_id: CASTER, caster_ready_at: STAMP });
    await releaseMatchCast(42, CASTER, false);
    expect(casterOf(state)).toBeNull();
    expect(casterReadyOf(state)).toBeNull();
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: false });
  });

  it("un arbitre qui retire sa propre inscription n'est pas « le staff »", async () => {
    state.match = matchState({ caster_user_id: CASTER });
    await releaseMatchCast(42, CASTER, true);
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: false });
  });

  it("lance le match quand les deux équipes n'attendaient plus que le caster", async () => {
    state.match = matchState({ caster_user_id: CASTER, team1_ready_at: STAMP, team2_ready_at: STAMP });
    await releaseMatchCast(42, CASTER, false);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("refuse de retirer le caster d'un autre sans être arbitre", async () => {
    state.match = matchState({ caster_user_id: CASTER });
    await expect(releaseMatchCast(42, 1, false, CASTER)).rejects.toThrow("NOT_MATCH_CASTER");
    expect(announceCastChange).not.toHaveBeenCalled();
    // Un co-caster non plus : chacun ne retire que lui-même.
    state.match.casters.push({ user_id: 901, stream_id: 1, ready_at: null });
    await expect(releaseMatchCast(42, 901, false, CASTER)).rejects.toThrow("NOT_MATCH_CASTER");
    await releaseMatchCast(42, 1, true, CASTER);
    expect(state.match?.casters.map((caster) => caster.user_id)).toEqual([901]);
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true });
  });

  it("co-caster qui part : l'autre reste, avec son « Prêt », sur le stream qu'ils partageaient", async () => {
    state.match = matchState({ caster_user_id: 901, caster_ready_at: STAMP });
    state.match.casters.push({ user_id: CASTER, stream_id: 1, ready_at: null });
    await releaseMatchCast(42, CASTER, false);
    expect(state.match?.casters).toEqual([{ user_id: 901, stream_id: 1, ready_at: STAMP }]);
    expect(state.match?.streams).toEqual([{ id: 1, live_url: null }]);
  });

  it("le stream à part d'un caster qui part disparaît ; celui du staff reste avec son lien", async () => {
    state.match = matchState({ caster_user_id: 901 });
    const staffStream = { id: 1, live_url: "https://twitch.tv/match", staff_owned: 1 };
    state.match.streams = [{ ...staffStream }, { id: 2, live_url: "https://twitch.tv/voix" }];
    state.match.casters.push({ user_id: CASTER, stream_id: 2, ready_at: null });
    await releaseMatchCast(42, CASTER, false);
    expect(state.match?.streams).toEqual([staffStream]);
    // Le dernier caster parti, le lien du staff demeure.
    await releaseMatchCast(42, 901, false);
    expect(state.match?.casters).toEqual([]);
    expect(state.match?.streams).toEqual([staffStream]);
  });

  it("le lien de la chaîne d'un caster part avec lui, même premier et seul lien du match", async () => {
    state.match = matchState({ caster_user_id: CASTER });
    state.match.streams = [{ id: 1, live_url: "https://twitch.tv/voix" }];
    await releaseMatchCast(42, CASTER, false);
    expect(state.match?.streams).toEqual([]);
  });

  it("lance le match quand toutes les parties n'attendaient plus que le caster qui part", async () => {
    state.match = matchState({ caster_user_id: 901, caster_ready_at: STAMP, team1_ready_at: STAMP, team2_ready_at: STAMP });
    state.match.casters.push({ user_id: CASTER, stream_id: 1, ready_at: null });
    await releaseMatchCast(42, CASTER, false);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("ne fait rien sur un match sans caster", async () => {
    await releaseMatchCast(42, CASTER, false);
    expect(state.writes).toEqual([]);
    expect(announceCastChange).not.toHaveBeenCalled();
  });
});

describe("setMatchHost", () => {
  it("désigne l'une des deux engagées, et rend le défaut sur `null`", async () => {
    await setMatchHost(42, TEAM2);
    expect(state.match?.host_team_id).toBe(TEAM2);
    await setMatchHost(42, null);
    expect(state.match?.host_team_id).toBeNull();
  });

  it("refuse une équipe étrangère au match", async () => {
    await expect(setMatchHost(42, 999)).rejects.toThrow("INVALID_HOST_TEAM");
    expect(state.writes).toEqual([]);
  });

  it("refuse un match introuvable", async () => {
    state.match = null;
    await expect(setMatchHost(42, TEAM1)).rejects.toThrow("MATCH_NOT_FOUND");
  });
});

describe("maintainMatchLaunches", () => {
  const connection = () => connectionFor(state);

  it("ouvre le délai d'un match qui vient d'entrer en lancement", async () => {
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(1);
    expect(state.match?.lobby_opened_at).toBe(STAMP);
    expect(state.match?.launched_at).toBeNull();
  });

  it("ne réécrit rien sur un délai déjà ouvert et non échu", async () => {
    state.match = matchState({ lobby_opened_at: new Date().toISOString() });
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(0);
    expect(state.writes).toEqual([]);
  });

  it("lance d'office un match dont le délai est écoulé", async () => {
    state.match = matchState({ lobby_opened_at: new Date(Date.now() - 16 * 60_000).toISOString() });
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(1);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("lance sur-le-champ un match entre deux fantômes", async () => {
    state.match = matchState({ team1_is_ghost: 1, team2_is_ghost: 1 });
    await maintainMatchLaunches(connection(), 7);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("remet en lancement un match lancé sous un autre appariement", async () => {
    state.match = matchState({ launch_pairing: `30:${TEAM2}`, launched_at: STAMP, lobby_opened_at: STAMP });
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(1);
    expect(state.match?.launch_pairing).toBe(`${TEAM1}:${TEAM2}`);
    expect(state.match?.launched_at).toBeNull();
    // Le délai repart de l'observation du nouvel appariement.
    expect(state.match?.lobby_opened_at).toBe(STAMP);
  });

  it("relit chaque candidat sous verrou : un « Prêt » validé entre-temps n'est pas effacé", async () => {
    // La lecture ordinaire voit l'empreinte vide ; le temps que l'entretien
    // écrive, un capitaine a validé son « Prêt » (empreinte posée).
    state.match = matchState({ launch_pairing: null, lobby_opened_at: null });
    const base = executeFor(state);
    const connection = fakeConnection({
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("FOR UPDATE") && state.match) {
          state.match = {
            ...state.match,
            launch_pairing: `${TEAM1}:${TEAM2}`,
            lobby_opened_at: STAMP,
            team1_ready_at: STAMP,
          };
        }
        return base(sql, params);
      },
    });
    await maintainMatchLaunches(connection, 7);
    expect(state.match?.team1_ready_at).toBe(STAMP);
    expect(state.writes.some((w) => w.includes("SET launch_pairing = ?"))).toBe(false);
  });

  it("verrouille la seule ligne du match, en SQL que MariaDB comprend", async () => {
    const queries: string[] = [];
    const base = executeFor(state);
    await maintainMatchLaunches(
      fakeConnection({
        execute: async (sql: string, params: unknown[] = []) => {
          queries.push(sql.replace(/\s+/g, " ").trim());
          return base(sql, params);
        },
      }),
      7,
    );
    const locks = queries.filter((q) => /FOR UPDATE/.test(q));
    expect(locks.length).toBeGreaterThan(0);
    for (const lock of locks) {
      // Pas de clause `OF` (erreur de syntaxe sous MariaDB, la production) ni
      // de jointure : un `FOR UPDATE` nu sur une jointure verrouillerait aussi
      // le tournoi et les équipes.
      expect(lock).not.toMatch(/FOR UPDATE OF/);
      expect(lock).not.toMatch(/JOIN/);
      // La ligne du match, puis ses casters : chaque table verrouillée seule.
      expect(lock).toMatch(/FROM bg_matches m WHERE m\.id = \?|FROM bg_match_casters WHERE match_id = \?/);
    }
    // Le contexte (état du tournoi, fantômes) est relu sans verrou.
    const context = queries.find((q) => q.includes("AS tournament_state") && !q.includes("FROM bg_matches"));
    expect(context).toBeDefined();
    expect(context).not.toMatch(/FOR UPDATE|LOCK IN SHARE MODE/);
  });

  it("parcourt les candidats dans un ordre fixe, pour verrouiller sans interblocage", async () => {
    const queries: string[] = [];
    const base = executeFor(state);
    await maintainMatchLaunches(
      fakeConnection({
        execute: async (sql: string, params: unknown[] = []) => {
          queries.push(sql.replace(/\s+/g, " "));
          return base(sql, params);
        },
      }),
      7,
    );
    expect(queries.find((q) => q.includes("WHERE m.tournament_id = ?"))).toMatch(/ORDER BY m\.id/);
  });

  it("ne touche pas un match programmé plus tard", async () => {
    state.match = matchState({ start_at: new Date(Date.now() + 3_600_000).toISOString() });
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(0);
    expect(state.writes).toEqual([]);
  });
});

describe("loadViewerCastBlock", () => {
  it("refuse sans la permission, sans même lire l'identité", async () => {
    await expect(loadViewerCastBlock(CASTER, false)).resolves.toBe("NOT_CASTER");
    expect(withConnection).not.toHaveBeenCalled();
  });

  it("lit l'identité avec la permission", async () => {
    await expect(loadViewerCastBlock(CASTER, true)).resolves.toBe("CASTER_IDENTITY_REQUIRED");
    state.users[CASTER] = {
      discord_verified_at: STAMP,
      discord_pseudo: "caster",
      blizzard_sub: "sub",
      overwatch_battletag: "Caster#1",
      is_deleted: 0,
    };
    await expect(loadViewerCastBlock(CASTER, true)).resolves.toBeNull();
  });
});

describe("releaseIneligibleCast", () => {
  const ineligible = { ...ELIGIBLE_CASTER, platform_roles_json: null };

  it("retire un caster qui ne remplit plus la condition, et lance ce qui n'attendait que lui", async () => {
    state.users[CASTER] = ineligible;
    state.match = matchState({ caster_user_id: CASTER, team1_ready_at: STAMP, team2_ready_at: STAMP });
    await expect(releaseIneligibleCast(42, CASTER)).resolves.toBe(true);
    expect(casterOf(state)).toBeNull();
    expect(state.match?.launched_at).toBe(STAMP);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "AUTO_RELEASED", matchId: 42, casterId: CASTER, reason: "INELIGIBLE" });
  });

  it.each<[string, MatchOverrides]>([
    ["un match lancé", { launched_at: STAMP }],
    ["un match joué entre-temps", { status: "COMPLETED" }],
    ["un match qu'il ne caste plus", { caster_user_id: 901 }],
  ])("ne touche pas à %s", async (_label, overrides) => {
    state.users[CASTER] = ineligible;
    state.match = matchState({ caster_user_id: CASTER, ...overrides });
    const before = casterOf(state);
    await expect(releaseIneligibleCast(42, CASTER)).resolves.toBe(false);
    expect(casterOf(state)).toBe(before);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(announceCastChange).not.toHaveBeenCalled();
  });

  it("garde un compte redevenu éligible", async () => {
    state.users[CASTER] = ELIGIBLE_CASTER;
    state.match = matchState({ caster_user_id: CASTER });
    await expect(releaseIneligibleCast(42, CASTER)).resolves.toBe(false);
    expect(casterOf(state)).toBe(CASTER);
    expect(announceCastChange).not.toHaveBeenCalled();
  });

  // Inscrit puis entré dans un roster du match : son « Prêt » de caster ne viendrait jamais.
  it("retire un caster éligible devenu joueur du match, et lance ce qui n'attendait que lui", async () => {
    state.users[CASTER] = ELIGIBLE_CASTER;
    state.memberships.push({ userId: CASTER, teamId: TEAM1, roles: ["DPS"] });
    state.match = matchState({ caster_user_id: CASTER, team1_ready_at: STAMP, team2_ready_at: STAMP });
    await expect(releaseIneligibleCast(42, CASTER)).resolves.toBe(true);
    expect(casterOf(state)).toBeNull();
    expect(state.match?.launched_at).toBe(STAMP);
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "AUTO_RELEASED", matchId: 42, casterId: CASTER, reason: "JOINED_TEAM" });
  });

  it("dit d'abord les conditions du cast quand le caster, inéligible, a aussi rejoint une équipe du match", async () => {
    state.users[CASTER] = ineligible;
    state.memberships.push({ userId: CASTER, teamId: TEAM1, roles: ["DPS"] });
    state.match = matchState({ caster_user_id: CASTER });
    await expect(releaseIneligibleCast(42, CASTER)).resolves.toBe(true);
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "AUTO_RELEASED", matchId: 42, casterId: CASTER, reason: "INELIGIBLE" });
  });
});

describe("phase de lancement éteinte (`match_launch_phase = 0`)", () => {
  const connection = () => connectionFor(state);

  it("lance aussitôt un match jouable, sans attendre aucun « Prêt »", async () => {
    state.match = matchState({ match_launch_phase: 0 });
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(1);
    expect(state.match?.launched_at).toBe(STAMP);
    expect(state.match?.lobby_opened_at).toBe(STAMP);
    expect(state.match?.team1_ready_at).toBeNull();
  });

  it("lance un match dont l'heure vient de passer", async () => {
    state.match = matchState({ match_launch_phase: 0, start_at: new Date(Date.now() - 60_000).toISOString() });
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(1);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("ne touche pas un match programmé plus tard", async () => {
    state.match = matchState({ match_launch_phase: 0, start_at: new Date(Date.now() + 3_600_000).toISOString() });
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(0);
    expect(state.writes).toEqual([]);
  });

  it("refuse le « Prêt » : la règle tient déjà le match pour lancé", async () => {
    state.match = matchState({ match_launch_phase: 0 });
    await expect(setMatchReady(42, 1, true)).rejects.toThrow("MATCH_ALREADY_LAUNCHED");
    expect(state.match?.team1_ready_at).toBeNull();
  });

  it("forcer un match à l'heure passée que l'entretien n'a pas encore écrit l'enregistre", async () => {
    state.match = matchState({ match_launch_phase: 0, start_at: new Date(Date.now() - 5_000).toISOString() });
    await forceLaunchMatch(42);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("forcer un match dont le lancement est déjà écrit reste refusé", async () => {
    state.match = matchState({ match_launch_phase: 0, launched_at: STAMP });
    await expect(forceLaunchMatch(42)).rejects.toThrow("MATCH_ALREADY_LAUNCHED");
  });

  it("allumée, le même match entre en lancement sans partir", async () => {
    state.match = matchState({ match_launch_phase: 1 });
    await expect(maintainMatchLaunches(connection(), 7)).resolves.toBe(1);
    expect(state.match?.launched_at).toBeNull();
    expect(state.match?.lobby_opened_at).toBe(STAMP);
  });
});

describe("arbitre désigné (`docs/features/MATCH_REFEREE.md`)", () => {
  const REFEREE = 950;
  const OTHER_REFEREE = 951;
  const refereeUser = {
    discord_verified_at: STAMP,
    discord_pseudo: "arbitre",
    blizzard_sub: "sub",
    overwatch_battletag: "Arbitre#1",
    is_deleted: 0,
    is_admin: 0,
    platform_roles_json: JSON.stringify(["ARBITRE"]),
  };

  beforeEach(() => {
    state.users[REFEREE] = { ...refereeUser };
    state.users[OTHER_REFEREE] = { ...refereeUser };
  });

  it("« Je prends ce match » : arbitre posé, autogestion éteinte, annonce après le commit", async () => {
    state.match = matchState({ self_managed: 1 });
    await takeMatchReferee(42, REFEREE);
    expect(state.match?.referee_user_id).toBe(REFEREE);
    expect(state.match?.self_managed).toBe(0);
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), { kind: "TAKEN", matchId: 42 });
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("reprendre son propre match ne change rien ; un autre arbitre éligible en place refuse", async () => {
    state.match = matchState({ referee_user_id: REFEREE });
    await takeMatchReferee(42, REFEREE);
    expect(queueRefereeChange).not.toHaveBeenCalled();
    await expect(takeMatchReferee(42, OTHER_REFEREE)).rejects.toThrow("MATCH_ALREADY_REFEREED");
    expect(state.match?.referee_user_id).toBe(REFEREE);
  });

  it("reprend le match d'un arbitre devenu inéligible et le prévient", async () => {
    state.users[REFEREE] = { ...refereeUser, platform_roles_json: null };
    state.match = matchState({ referee_user_id: REFEREE });
    await takeMatchReferee(42, OTHER_REFEREE);
    expect(state.match?.referee_user_id).toBe(OTHER_REFEREE);
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), {
      kind: "AUTO_RELEASED",
      matchId: 42,
      refereeId: REFEREE,
      reason: "INELIGIBLE",
    });
  });

  it("refuse sans la permission `tournaments`, sans identité certifiée, ou à un joueur du match", async () => {
    state.users[REFEREE] = { ...refereeUser, platform_roles_json: JSON.stringify(["CASTER"]) };
    await expect(takeMatchReferee(42, REFEREE)).rejects.toThrow("NOT_REFEREE");
    state.users[REFEREE] = { ...refereeUser, blizzard_sub: null };
    await expect(takeMatchReferee(42, REFEREE)).rejects.toThrow("REFEREE_IDENTITY_REQUIRED");
    state.users[1] = { ...refereeUser };
    await expect(takeMatchReferee(42, 1)).rejects.toThrow("REFEREE_IS_PLAYER");
    expect(state.match?.referee_user_id).toBeNull();
  });

  it("refuse un match introuvable, joué, ou une exemption", async () => {
    state.match = null;
    await expect(takeMatchReferee(42, REFEREE)).rejects.toThrow("MATCH_NOT_FOUND");
    state.match = matchState({ status: "COMPLETED" });
    await expect(takeMatchReferee(42, REFEREE)).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    state.match = matchState({ is_bye: 1, team2_id: null });
    await expect(assignMatchReferee(42, 1, REFEREE)).rejects.toThrow("MATCH_NOT_LAUNCHABLE");
  });

  it("l'arbitre est une 4e partie : le match attend son « Prêt », qui vaut aussi s'il caste", async () => {
    state.match = matchState({ referee_user_id: REFEREE, team1_ready_at: STAMP, team2_ready_at: STAMP });
    await setMatchReady(42, REFEREE, true);
    expect(state.match?.referee_ready_at).toBe(STAMP);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("un caster déjà prêt qui devient arbitre n'a pas à se redéclarer : son « Prêt » vaut pour les deux", async () => {
    state.match = matchState({ caster_user_id: REFEREE, caster_ready_at: STAMP, team1_ready_at: STAMP, team2_ready_at: STAMP });
    await takeMatchReferee(42, REFEREE);
    expect(state.match?.referee_ready_at).toBe(STAMP);
    state.match = matchState({ caster_user_id: OTHER_REFEREE, caster_ready_at: null });
    await assignMatchReferee(42, 1, OTHER_REFEREE);
    expect(state.match?.referee_ready_at).toBeNull();
  });

  it("un arbitre qui rejoint une équipe du match sans changer l'appariement n'est plus attendu", async () => {
    state.match = matchState({ referee_user_id: REFEREE, team1_ready_at: STAMP });
    state.memberships.push({ userId: REFEREE, teamId: TEAM2, roles: ["DPS"] });
    await setMatchReady(42, 3, true);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("un match joué garde son arbitre : ni retrait par lui-même ni par le staff", async () => {
    state.match = matchState({ referee_user_id: REFEREE, status: "COMPLETED" });
    await expect(releaseMatchReferee(42, REFEREE, false)).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    await expect(assignMatchReferee(42, 1, null)).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    expect(state.match?.referee_user_id).toBe(REFEREE);
    expect(queueRefereeChange).not.toHaveBeenCalled();
  });

  it("sans arbitre, les deux équipes suffisent", async () => {
    state.match = matchState({ team1_ready_at: STAMP });
    await setMatchReady(42, 3, true);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("l'arbitre qui se retire libère un match qui n'attendait plus que lui", async () => {
    state.match = matchState({ referee_user_id: REFEREE, team1_ready_at: STAMP, team2_ready_at: STAMP });
    await releaseMatchReferee(42, REFEREE, false);
    expect(state.match?.referee_user_id).toBeNull();
    expect(state.match?.launched_at).toBe(STAMP);
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), {
      kind: "RELEASED",
      matchId: 42,
      refereeId: REFEREE,
      byStaff: false,
    });
  });

  it("seul le staff retire l'arbitre d'un autre ; il est alors prévenu", async () => {
    state.match = matchState({ referee_user_id: REFEREE });
    await expect(releaseMatchReferee(42, OTHER_REFEREE, false)).rejects.toThrow("NOT_MATCH_REFEREE");
    await assignMatchReferee(42, OTHER_REFEREE, null);
    expect(state.match?.referee_user_id).toBeNull();
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), {
      kind: "RELEASED",
      matchId: 42,
      refereeId: REFEREE,
      byStaff: true,
    });
  });

  it("le staff désigne ou remplace l'arbitre ; l'arbitre remplacé est nommé pour l'avis", async () => {
    state.match = matchState({ referee_user_id: REFEREE, referee_ready_at: STAMP });
    await assignMatchReferee(42, 1, OTHER_REFEREE);
    expect(state.match?.referee_user_id).toBe(OTHER_REFEREE);
    expect(state.match?.referee_ready_at).toBeNull();
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), {
      kind: "ASSIGNED",
      matchId: 42,
      replacedRefereeId: REFEREE,
    });
    jest.mocked(queueRefereeChange).mockClear();
    await assignMatchReferee(42, 1, OTHER_REFEREE);
    expect(queueRefereeChange).not.toHaveBeenCalled();
  });

  it("autogestion : l'allumer retire l'arbitre (prévenu), l'éteindre ne désigne personne ; rien d'office", async () => {
    state.match = matchState({ referee_user_id: REFEREE });
    await setMatchSelfManaged(42, true);
    expect(state.match?.self_managed).toBe(1);
    expect(state.match?.referee_user_id).toBeNull();
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), {
      kind: "SELF_MANAGED",
      matchId: 42,
      enabled: true,
      replacedRefereeId: REFEREE,
    });
    jest.mocked(queueRefereeChange).mockClear();
    await setMatchSelfManaged(42, true);
    expect(queueRefereeChange).not.toHaveBeenCalled();
    await setMatchSelfManaged(42, false);
    expect(state.match?.self_managed).toBe(0);
    expect(state.match?.referee_user_id).toBeNull();
  });

  it("autogestion d'une manche : chaque match à jouer, une ligne au journal, un avis par arbitre retiré", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    state.match = matchState({ referee_user_id: REFEREE });
    expect(await setRoundSelfManaged(7, { phaseId: 0, roundNumber: 1, bracket: null }, true)).toBe(1);
    expect(state.match?.self_managed).toBe(1);
    expect(announceRefereeChange).toHaveBeenCalledWith(
      { kind: "SELF_MANAGED", matchId: 42, enabled: true, replacedRefereeId: REFEREE },
      { log: false },
    );
    expect(await setRoundSelfManaged(7, { phaseId: 0, roundNumber: 1, bracket: "UPPER" }, true)).toBe(0);
    state.match = null;
    await expect(setRoundSelfManaged(7, { phaseId: 0, roundNumber: 1, bracket: null }, true)).rejects.toThrow(
      "TOURNAMENT_NOT_FOUND",
    );
    quiet.mockRestore();
  });

  it("première carte : normalisée, retirée sur vide, refusée trop longue ou sur un match joué", async () => {
    await setMatchFirstMap(42, "  Ilios  ");
    expect(state.match?.first_map).toBe("Ilios");
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), { kind: "FIRST_MAP", matchId: 42, set: true });
    await setMatchFirstMap(42, "");
    expect(state.match?.first_map).toBeNull();
    await expect(setMatchFirstMap(42, "x".repeat(65))).rejects.toThrow("INVALID_FIRST_MAP");
    await expect(setMatchFirstMap(42, 12)).rejects.toThrow("INVALID_FIRST_MAP");
    state.match = matchState({ status: "COMPLETED" });
    await expect(setMatchFirstMap(42, "Ilios")).rejects.toThrow("MATCH_ALREADY_COMPLETED");
  });

  it("setMatchFirstMap_roundWithPool_refusesRoundMapsSet", async () => {
    state.roundSlots = '[["Ilios","Nepal"]]';
    await expect(setMatchFirstMap(42, "Nepal")).rejects.toThrow("ROUND_MAPS_SET");
    expect(state.match?.first_map).toBeNull();
  });

  it("setMatchFirstMap_roundWithImposedMap_refusesRoundMapsSet", async () => {
    state.roundSlots = '[["Busan"]]';
    await expect(setMatchFirstMap(42, "")).rejects.toThrow("ROUND_MAPS_SET");
    expect(queueRefereeChange).not.toHaveBeenCalled();
  });

  it("setMatchFirstMap_inTransaction_locksTournamentFirst", async () => {
    const base = executeFor(state);
    const statements: string[] = [];
    jest.mocked(withConnection).mockImplementation((run) =>
      run(
        fakeConnection({
          execute: async (sql: string, params: unknown[] = []) => {
            statements.push(sql);
            return base(sql, params);
          },
          beginTransaction: async () => {
            statements.push("BEGIN");
          },
          commit: async () => undefined,
          rollback: async () => undefined,
        }),
      ),
    );
    await setMatchFirstMap(42, "Ilios");
    const begin = statements.indexOf("BEGIN");
    expect(statements[begin + 1]).toMatch(/FROM bg_tournaments WHERE id = \? FOR UPDATE/);
  });

  it("retire d'office un arbitre devenu inéligible avant le lancement, jamais après", async () => {
    state.users[REFEREE] = { ...refereeUser, discord_verified_at: null };
    state.match = matchState({ referee_user_id: REFEREE, launched_at: STAMP });
    expect(await releaseIneligibleReferee(42, REFEREE)).toBe(false);
    state.match = matchState({ referee_user_id: REFEREE });
    expect(await releaseIneligibleReferee(42, REFEREE)).toBe(true);
    expect(state.match?.referee_user_id).toBeNull();
    expect(announceRefereeChange).toHaveBeenCalledWith({
      kind: "AUTO_RELEASED",
      matchId: 42,
      refereeId: REFEREE,
      reason: "INELIGIBLE",
    });
  });

  it("retire d'office, motif « équipe rejointe », un arbitre éligible qui joue désormais le match", async () => {
    state.memberships.push({ userId: REFEREE, teamId: TEAM2, roles: ["DPS"] });
    state.match = matchState({ referee_user_id: REFEREE });
    expect(await releaseIneligibleReferee(42, REFEREE)).toBe(true);
    expect(state.match?.referee_user_id).toBeNull();
    expect(announceRefereeChange).toHaveBeenCalledWith({
      kind: "AUTO_RELEASED",
      matchId: 42,
      refereeId: REFEREE,
      reason: "JOINED_TEAM",
    });
  });

  it("garde un arbitre éligible qui ne joue pas le match", async () => {
    state.match = matchState({ referee_user_id: REFEREE });
    expect(await releaseIneligibleReferee(42, REFEREE)).toBe(false);
    expect(state.match?.referee_user_id).toBe(REFEREE);
  });
});

describe("maintainMatchLaunches — avertissement « sans arbitre »", () => {
  const connection = () => connectionFor(state);

  it("match planifié : une alerte par appariement, jamais d'autogestion d'office", async () => {
    state.match = matchState({ start_at: "2026-09-24 19:00:00" });
    await maintainMatchLaunches(connection(), 7);
    await maintainMatchLaunches(connection(), 7);
    expect(state.alerts).toEqual([`42:NO_REFEREE:${TEAM1}:${TEAM2}`]);
    expect(state.match?.self_managed).toBe(0);
    // Nouvel appariement : nouvelle alerte.
    state.match = matchState({ ...state.match, team2_id: 30, launch_pairing: `${TEAM1}:${TEAM2}` });
    await maintainMatchLaunches(connection(), 7);
    expect(state.alerts).toEqual([`42:NO_REFEREE:${TEAM1}:${TEAM2}`, `42:NO_REFEREE:${TEAM1}:30`]);
  });

  it("match sans horaire : alerte de sa manche, réservée par appariement sur le match lui-même", async () => {
    await maintainMatchLaunches(connection(), 7);
    await maintainMatchLaunches(connection(), 7);
    expect(state.alerts).toEqual([`42:NO_REFEREE:${TEAM1}:${TEAM2}`]);
    // Réappariement : il repart sans décision, le staff est de nouveau averti.
    state.match = matchState({ ...state.match, team2_id: 30, launch_pairing: `${TEAM1}:${TEAM2}` });
    await maintainMatchLaunches(connection(), 7);
    expect(state.alerts).toEqual([`42:NO_REFEREE:${TEAM1}:${TEAM2}`, `42:NO_REFEREE:${TEAM1}:30`]);
    expect(state.match?.self_managed).toBe(0);
  });

  it("une heure posée après coup ne signale pas le match une seconde fois", async () => {
    await maintainMatchLaunches(connection(), 7);
    state.match = matchState({ ...state.match, start_at: "2026-09-24 19:00:00" });
    await maintainMatchLaunches(connection(), 7);
    expect(state.alerts).toEqual([`42:NO_REFEREE:${TEAM1}:${TEAM2}`]);
  });

  it("se tait sur un match arbitré ou en autogestion", async () => {
    state.users[950] = {
      discord_verified_at: STAMP,
      discord_pseudo: "arbitre",
      blizzard_sub: "sub",
      overwatch_battletag: "Arbitre#1",
      is_deleted: 0,
      is_admin: 0,
      platform_roles_json: JSON.stringify(["ARBITRE"]),
    };
    state.match = matchState({ referee_user_id: 950 });
    await maintainMatchLaunches(connection(), 7);
    state.match = matchState({ self_managed: 1 });
    await maintainMatchLaunches(connection(), 7);
    expect(state.alerts ?? []).toEqual([]);
  });
});

describe("opposition d'arbitre retenue (`releaseObjectingReferee`, `REFEREE_OBJECTION`)", () => {
  const REFEREE = 960;
  const refereeUser = {
    discord_verified_at: STAMP,
    discord_pseudo: "arbitre",
    blizzard_sub: "sub",
    overwatch_battletag: "Arbitre#1",
    is_deleted: 0,
    is_admin: 0,
    platform_roles_json: JSON.stringify(["ARBITRE"]),
  };

  beforeEach(() => {
    state.users[REFEREE] = { ...refereeUser };
  });

  it("takeMatchReferee_objectionUpheld_throwsRefereeObjection", async () => {
    state.users[REFEREE] = { ...refereeUser, referee_objection_at: STAMP };
    state.match = matchState();

    await expect(takeMatchReferee(42, REFEREE)).rejects.toThrow("REFEREE_OBJECTION");

    expect(state.match?.referee_user_id).toBeNull();
    expect(queueRefereeChange).not.toHaveBeenCalled();
  });

  it("assignMatchReferee_objectionUpheld_throwsRefereeObjection", async () => {
    state.users[REFEREE] = { ...refereeUser, referee_objection_at: STAMP };
    state.match = matchState();

    await expect(assignMatchReferee(42, 1, REFEREE)).rejects.toThrow("REFEREE_OBJECTION");

    expect(state.match?.referee_user_id).toBeNull();
  });

  it("releaseObjectingReferee_unfinishedMatch_clearsRefereeAndQueuesObjectionRelease", async () => {
    state.users[REFEREE] = { ...refereeUser, referee_objection_at: STAMP };
    state.match = matchState({ referee_user_id: REFEREE, referee_ready_at: STAMP });

    const released = await releaseObjectingReferee(42, REFEREE);

    expect(released).toBe(true);
    expect(state.match?.referee_user_id).toBeNull();
    expect(state.match?.referee_ready_at).toBeNull();
    expect(queueRefereeChange).toHaveBeenCalledWith(expect.anything(), {
      kind: "OBJECTION_RELEASED",
      matchId: 42,
      refereeId: REFEREE,
    });
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("releaseObjectingReferee_launchedMatch_stillReleases", async () => {
    state.users[REFEREE] = { ...refereeUser, referee_objection_at: STAMP };
    state.match = matchState({ referee_user_id: REFEREE, launched_at: STAMP });

    const released = await releaseObjectingReferee(42, REFEREE);

    expect(released).toBe(true);
    expect(state.match?.referee_user_id).toBeNull();
  });

  it("releaseObjectingReferee_completedMatch_returnsFalseNoWrite", async () => {
    state.match = matchState({ referee_user_id: REFEREE, status: "COMPLETED" });

    const released = await releaseObjectingReferee(42, REFEREE);

    expect(released).toBe(false);
    expect(state.match?.referee_user_id).toBe(REFEREE);
    expect(state.writes).toEqual([]);
  });

  it("releaseObjectingReferee_otherReferee_returnsFalseNoWrite", async () => {
    state.match = matchState({ referee_user_id: 961 });

    const released = await releaseObjectingReferee(42, REFEREE);

    expect(released).toBe(false);
    expect(state.match?.referee_user_id).toBe(961);
    expect(queueRefereeChange).not.toHaveBeenCalled();
  });

  it("releaseObjectingReferee_onlyRefereeMissing_launchesMatch", async () => {
    state.users[REFEREE] = { ...refereeUser, referee_objection_at: STAMP };
    state.match = matchState({ referee_user_id: REFEREE, team1_ready_at: STAMP, team2_ready_at: STAMP });

    await releaseObjectingReferee(42, REFEREE);

    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("releaseObjectingReferee_objectionLiftedMeanwhile_returnsFalseNoWrite", async () => {
    state.match = matchState({ referee_user_id: REFEREE });

    const released = await releaseObjectingReferee(42, REFEREE);

    expect(released).toBe(false);
    expect(state.match?.referee_user_id).toBe(REFEREE);
    expect(queueRefereeChange).not.toHaveBeenCalled();
  });

  it("assignMatchReferee_sameObjectingReferee_throwsRefereeObjection", async () => {
    state.users[REFEREE] = { ...refereeUser, referee_objection_at: STAMP };
    state.match = matchState({ referee_user_id: REFEREE });

    await expect(assignMatchReferee(42, 1, REFEREE)).rejects.toThrow("REFEREE_OBJECTION");
  });

  it("takeMatchReferee_selfAlreadyRefereeWithObjection_throwsRefereeObjection", async () => {
    state.users[REFEREE] = { ...refereeUser, referee_objection_at: STAMP };
    state.match = matchState({ referee_user_id: REFEREE });

    await expect(takeMatchReferee(42, REFEREE)).rejects.toThrow("REFEREE_OBJECTION");
  });

  it("takeMatchReferee_currentRefereeObjecting_otherRefereeTakesOver", async () => {
    state.users[REFEREE] = { ...refereeUser, referee_objection_at: STAMP };
    state.users[961] = { ...refereeUser, overwatch_battletag: "Autre#1" };
    state.match = matchState({ referee_user_id: REFEREE });

    await takeMatchReferee(42, 961);

    expect(state.match?.referee_user_id).toBe(961);
  });
});
