import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import {
  claimMatchCast,
  forceLaunchMatch,
  loadViewerCastBlock,
  maintainMatchLaunches,
  releaseMatchCast,
  setMatchHost,
  setMatchReady,
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
  caster_user_id: number | null;
  caster_ready_at: string | null;
  host_team_id: number | null;
};

type Membership = { userId: number; teamId: number; roles: string[] };

type World = {
  match: MatchState | null;
  memberships: Membership[];
  soloEntries: { userId: number; teamId: number }[];
  users: Record<number, { discord_verified_at: string | null; discord_pseudo: string | null; blizzard_sub: string | null; overwatch_battletag: string | null; is_deleted: number }>;
  writes: string[];
};

const STAMP = "2026-09-24 20:00:00";

function matchState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    id: 42,
    tournament_id: 7,
    tournament_state: "RUNNING",
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
    caster_user_id: null,
    caster_ready_at: null,
    host_team_id: null,
    ...overrides,
  };
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

/** Rejoue une écriture sur la ligne du match — ce que ferait la base. */
function applyUpdate(state: World, sql: string, params: unknown[]) {
  const match = state.match;
  if (!match) return;
  const set = (column: keyof MatchState, value: unknown) => {
    (match as Record<string, unknown>)[column] = value;
  };
  for (const column of ["team1_ready_at", "team2_ready_at", "caster_ready_at"] as const) {
    if (sql.includes(`${column} = NOW()`)) set(column, STAMP);
    if (sql.includes(`${column} = NULL`)) set(column, null);
  }
  if (sql.includes("lobby_opened_at = COALESCE(lobby_opened_at, NOW())") && !match.lobby_opened_at) {
    set("lobby_opened_at", STAMP);
  }
  if (sql.includes("SET lobby_opened_at = NOW()")) set("lobby_opened_at", STAMP);
  if (sql.includes("launched_at = NOW()")) set("launched_at", STAMP);
  if (sql.includes("SET caster_user_id = ?")) set("caster_user_id", params[0]);
  if (sql.includes("SET caster_user_id = NULL")) set("caster_user_id", null);
  if (sql.includes("SET host_team_id = ?")) set("host_team_id", params[0]);
  if (sql.includes("SET launch_pairing = ?")) {
    set("launch_pairing", params[0]);
    for (const column of ["lobby_opened_at", "launched_at", "team1_ready_at", "team2_ready_at", "caster_ready_at"] as const) {
      set(column, null);
    }
  }
}

function connectionFor(state: World): PoolConnection {
  const execute = async (rawSql: string, params: unknown[] = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
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
    if (sql.includes("FROM bg_matches m") && sql.includes("WHERE m.tournament_id = ?")) {
      const match = state.match;
      const stale = match && match.launch_pairing !== `${match.team1_id}:${match.team2_id}`;
      const candidate =
        match &&
        match.status === "READY" &&
        (match.launched_at === null || stale) &&
        match.team1_id &&
        match.team2_id;
      return [candidate ? [{ ...match }] : [], []];
    }
    if (sql.includes("FROM bg_matches m")) {
      return [state.match ? [{ ...state.match }] : [], []];
    }
    throw new Error(`requête inattendue : ${sql}`);
  };
  return fakeConnection({
    execute,
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
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("lance le match au dernier « Prêt » attendu", async () => {
    state.match = matchState({ team2_ready_at: STAMP });
    await expect(setMatchReady(42, 1, true)).resolves.toEqual({ launched: true });
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("attend le caster inscrit avant de lancer", async () => {
    state.match = matchState({ team2_ready_at: STAMP, caster_user_id: CASTER });
    await expect(setMatchReady(42, 1, true)).resolves.toEqual({ launched: false });
    await expect(setMatchReady(42, CASTER, true)).resolves.toEqual({ launched: true });
    expect(state.match?.caster_ready_at).toBe(STAMP);
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
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse un match introuvable", async () => {
    state.match = null;
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
    await maintainMatchLaunches(connectionFor(state), 7);
    expect(state.match?.caster_user_id).toBeNull();
  });

  it("garde un caster étranger aux deux équipes", async () => {
    state.match = matchState({ launch_pairing: null, caster_user_id: CASTER });
    await maintainMatchLaunches(connectionFor(state), 7);
    expect(state.match?.caster_user_id).toBe(CASTER);
  });

  it("fait agir en joueur celui qui est à la fois inscrit comme caster et joueur", async () => {
    state.match = matchState({ caster_user_id: 1 });
    await setMatchReady(42, 1, true);
    expect(state.match?.team1_ready_at).toBe(STAMP);
    expect(state.match?.caster_ready_at).toBeNull();
  });
});

describe("forceLaunchMatch", () => {
  it("lance un match en lancement sans attendre", async () => {
    await forceLaunchMatch(42);
    expect(state.match?.launched_at).toBe(STAMP);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
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
    expect(state.match?.caster_user_id).toBe(CASTER);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("refuse sans la permission `live`", async () => {
    state.users[CASTER] = verified;
    await expect(claimMatchCast(42, CASTER, false)).rejects.toThrow("NOT_CASTER");
    expect(state.match?.caster_user_id).toBeNull();
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

  it("refuse un match déjà casté par un autre, accepte de rejouer sa propre inscription", async () => {
    state.users[CASTER] = verified;
    state.match = matchState({ caster_user_id: 901 });
    await expect(claimMatchCast(42, CASTER, true)).rejects.toThrow("MATCH_ALREADY_CASTED");
    state.match = matchState({ caster_user_id: CASTER, caster_ready_at: STAMP });
    await claimMatchCast(42, CASTER, true);
    // Rejouée, l'inscription ne défait pas un « Prêt » déjà donné.
    expect(state.match?.caster_ready_at).toBe(STAMP);
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
    expect(state.match?.caster_user_id).toBeNull();
    expect(state.match?.caster_ready_at).toBeNull();
  });

  it("lance le match quand les deux équipes n'attendaient plus que le caster", async () => {
    state.match = matchState({ caster_user_id: CASTER, team1_ready_at: STAMP, team2_ready_at: STAMP });
    await releaseMatchCast(42, CASTER, false);
    expect(state.match?.launched_at).toBe(STAMP);
  });

  it("refuse de retirer le caster d'un autre sans être arbitre", async () => {
    state.match = matchState({ caster_user_id: CASTER });
    await expect(releaseMatchCast(42, 1, false)).rejects.toThrow("NOT_MATCH_CASTER");
    await releaseMatchCast(42, 1, true);
    expect(state.match?.caster_user_id).toBeNull();
  });

  it("ne fait rien sur un match sans caster", async () => {
    await releaseMatchCast(42, CASTER, false);
    expect(state.writes).toEqual([]);
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
