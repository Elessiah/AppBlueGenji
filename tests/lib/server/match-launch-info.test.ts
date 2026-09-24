import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { listViewerMatchLaunches } from "@/lib/server/tournaments/match-launch-info";
import { fakeConnection } from "../../helpers/sql-double";

/**
 * Lecture de la modale de lancement : ce qu'elle rend, et surtout ce qu'elle
 * **ne** rend **pas** — un tag Discord non certifié, les contacts d'un match
 * encore programmé, ceux d'une fantôme.
 */

const VIEWER = 1;
const TEAM1 = 10;
const TEAM2 = 20;
const CASTER = 900;
const OPENED = new Date(Date.now() - 60_000).toISOString();

type Candidate = Record<string, unknown>;

function candidate(overrides: Candidate = {}): Candidate {
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
    lobby_opened_at: OPENED,
    launch_pairing: `${TEAM1}:${TEAM2}`,
    launched_at: null,
    team1_ready_at: null,
    team2_ready_at: null,
    caster_user_id: null,
    caster_ready_at: null,
    host_team_id: null,
    tournament_name: "Coupe",
    team1_name: "Alpha",
    team2_name: "Bravo",
    team1_logo_url: "/api/uploads/logos/a.webp",
    team2_logo_url: "https://exemple.invalid/b.png",
    team1_solo_user_id: null,
    team2_solo_user_id: null,
    ...overrides,
  };
}

function member(teamId: number, userId: number, overrides: Record<string, unknown> = {}) {
  return {
    team_id: teamId,
    user_id: userId,
    pseudo: `Joueur${userId}`,
    roles_json: JSON.stringify(["DPS"]),
    discord_pseudo: null,
    discord_verified_at: null,
    overwatch_battletag: null,
    blizzard_sub: null,
    visible_overwatch: 0,
    ...overrides,
  };
}

type World = {
  viewerMemberships: { team_id: number; roles_json: string }[];
  viewerSolo: { id: number }[];
  candidates: Candidate[];
  members: ReturnType<typeof member>[];
  users: Record<string, unknown>[];
  writes: string[];
};

let state: World;

function connectionFor(world: World): PoolConnection {
  const execute = async (rawSql: string, params: unknown[] = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    if (sql.startsWith("UPDATE")) {
      world.writes.push(sql);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("SELECT team_id, roles_json FROM bg_team_members")) {
      return [world.viewerMemberships, []];
    }
    if (sql.startsWith("SELECT id FROM bg_teams WHERE solo_user_id")) return [world.viewerSolo, []];
    if (sql.includes("FOR UPDATE")) {
      // Relecture sous verrou d'un candidat par l'entretien.
      return [world.candidates.filter((c) => c.id === Number(params[0])), []];
    }
    if (sql.includes("AS tournament_state") && !sql.includes("FROM bg_matches")) {
      // Contexte du candidat relu hors verrou (tournoi, statut fantôme).
      const [tournamentId, team1Id] = params.map(Number);
      const c = world.candidates.find((x) => x.tournament_id === tournamentId && x.team1_id === team1Id);
      return [c ? [{ tournament_state: c.tournament_state, team1_is_ghost: c.team1_is_ghost, team2_is_ghost: c.team2_is_ghost }] : [], []];
    }
    if (sql.includes("WHERE m.tournament_id = ?")) {
      // Entretien : candidats au lancement du tournoi.
      return [world.candidates.filter((c) => c.launched_at === null), []];
    }
    if (sql.includes("t.name AS tournament_name")) return [world.candidates, []];
    if (sql.includes("FROM bg_team_members tm")) return [world.members, []];
    if (sql.includes("FROM bg_users WHERE id IN")) return [world.users, []];
    throw new Error(`requête inattendue : ${sql}`);
  };
  return fakeConnection({
    execute,
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  state = {
    viewerMemberships: [{ team_id: TEAM1, roles_json: JSON.stringify(["CAPITAINE"]) }],
    viewerSolo: [],
    candidates: [candidate()],
    members: [],
    users: [],
    writes: [],
  };
  jest.mocked(withConnection).mockImplementation((run) => run(connectionFor(state)));
});

const viewer = { id: VIEWER, roles: [] };

describe("listViewerMatchLaunches — le match et la place du lecteur", () => {
  it("rend un match en lancement avec son tournoi, ses équipes et l'hôte par défaut", async () => {
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info).toMatchObject({
      matchId: 42,
      tournamentId: 7,
      tournamentName: "Coupe",
      phase: "LOBBY",
      hostTeamId: TEAM1,
      team1: { teamId: TEAM1, name: "Alpha", ready: false, isGhost: false, isSolo: false },
      team2: { teamId: TEAM2, name: "Bravo" },
      viewer: { role: "TEAM1", canDeclareReady: true, ready: false },
    });
    expect(info.autoLaunchAt).toBe(new Date(Date.parse(OPENED) + 15 * 60_000).toISOString());
  });

  it("ne sert qu'un logo du site : une origine étrangère est écartée", async () => {
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.team1.logoUrl).toBe("/api/uploads/logos/a.webp");
    expect(info.team2.logoUrl).toBeNull();
  });

  it("respecte l'hôte désigné par l'arbitrage", async () => {
    state.candidates = [candidate({ host_team_id: TEAM2 })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.hostTeamId).toBe(TEAM2);
  });

  it("refuse le bouton « Prêt » à un joueur sans rôle d'engagement", async () => {
    state.viewerMemberships = [{ team_id: TEAM1, roles_json: JSON.stringify(["DPS"]) }];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer).toEqual({ role: "TEAM1", canDeclareReady: false, ready: false });
  });

  it("reconnaît le caster et son « Prêt »", async () => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: VIEWER, caster_ready_at: OPENED })];
    state.users = [
      {
        id: VIEWER,
        pseudo: "Caster",
        discord_pseudo: "caster",
        discord_verified_at: OPENED,
        overwatch_battletag: "Caster#1",
        blizzard_sub: "sub",
        visible_overwatch: 0,
        is_deleted: 0,
      },
    ];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer).toEqual({ role: "CASTER", canDeclareReady: true, ready: true });
    expect(info.caster).toMatchObject({
      userId: VIEWER,
      discordTag: "caster",
      battletag: "Caster#1",
      battletagVerified: true,
      ready: true,
    });
  });

  it("fait primer le rôle de joueur sur une inscription de caster", async () => {
    state.candidates = [candidate({ caster_user_id: VIEWER })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer.role).toBe("TEAM1");
  });

  it("donne le « Prêt » au joueur d'une entrée solo", async () => {
    state.viewerMemberships = [];
    state.viewerSolo = [{ id: TEAM2 }];
    state.candidates = [candidate({ team2_solo_user_id: VIEWER })];
    state.users = [
      {
        id: VIEWER,
        pseudo: "Solo",
        discord_pseudo: "solo",
        discord_verified_at: OPENED,
        overwatch_battletag: null,
        blizzard_sub: null,
        visible_overwatch: 0,
        is_deleted: 0,
      },
    ];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer).toEqual({ role: "TEAM2", canDeclareReady: true, ready: false });
    expect(info.team2.isSolo).toBe(true);
    expect(info.team2.contacts).toEqual([
      expect.objectContaining({ userId: VIEWER, discordTag: "solo" }),
    ]);
  });

  it("ne rend rien d'un match terminé, ou sans ses deux engagées", async () => {
    state.candidates = [candidate({ status: "COMPLETED" }), candidate({ id: 43, team2_id: null })];
    await expect(listViewerMatchLaunches(viewer)).resolves.toEqual([]);
  });

  it("ne rend rien sans aucune appartenance ni entrée solo", async () => {
    state.viewerMemberships = [];
    state.candidates = [];
    await expect(listViewerMatchLaunches(viewer)).resolves.toEqual([]);
  });
});

describe("listViewerMatchLaunches — exposition des contacts", () => {
  it("présente le capitaine vérifié de chaque équipe", async () => {
    state.members = [
      member(TEAM1, 1, {
        roles_json: JSON.stringify(["CAPITAINE"]),
        discord_pseudo: "cap",
        discord_verified_at: OPENED,
        overwatch_battletag: "Cap#1",
        blizzard_sub: "s1",
      }),
      member(TEAM2, 5, { roles_json: JSON.stringify(["OWNER"]), discord_pseudo: "own", discord_verified_at: OPENED }),
      member(TEAM2, 6, { overwatch_battletag: "Six#6", blizzard_sub: "s6" }),
    ];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.team1.contacts).toEqual([
      { userId: 1, pseudo: "Joueur1", roles: ["CAPITAINE"], discordTag: "cap", battletag: "Cap#1", battletagVerified: true },
    ]);
    // Le propriétaire n'a que Discord : un porteur du BattleTag le complète,
    // et son BattleTag masqué reste lisible des parties du match.
    expect(info.team2.contacts.map((c) => [c.userId, c.discordTag, c.battletag])).toEqual([
      [5, "own", null],
      [6, null, "Six#6"],
    ]);
  });

  it("ne sort jamais un tag Discord non certifié", async () => {
    state.members = [
      member(TEAM2, 5, { roles_json: JSON.stringify(["CAPITAINE"]), discord_pseudo: "secret", overwatch_battletag: "Cap#2" }),
    ];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.team2.contacts).toEqual([
      expect.objectContaining({ userId: 5, discordTag: null, battletag: "Cap#2", battletagVerified: false }),
    ]);
    expect(JSON.stringify(info)).not.toContain("secret");
  });

  it("n'expose aucun contact avant l'heure de début", async () => {
    state.candidates = [candidate({ start_at: new Date(Date.now() + 30 * 60_000).toISOString(), caster_user_id: CASTER })];
    state.members = [member(TEAM2, 5, { discord_pseudo: "own", discord_verified_at: OPENED })];
    state.users = [
      {
        id: CASTER,
        pseudo: "Caster",
        discord_pseudo: "caster",
        discord_verified_at: OPENED,
        overwatch_battletag: "Caster#1",
        blizzard_sub: "sub",
        visible_overwatch: 0,
        is_deleted: 0,
      },
    ];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.phase).toBe("SCHEDULED");
    expect(info.team1.contacts).toEqual([]);
    expect(info.team2.contacts).toEqual([]);
    expect(info.caster).toMatchObject({ pseudo: "Caster", discordTag: null, battletag: null });
    expect(info.autoLaunchAt).toBeNull();
  });

  it("n'expose aucun contact pour une équipe fantôme", async () => {
    state.candidates = [candidate({ team2_is_ghost: 1 })];
    state.members = [member(TEAM2, 5, { discord_pseudo: "own", discord_verified_at: OPENED })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.team2).toMatchObject({ isGhost: true, ready: true, contacts: [] });
  });

  it("tait le caster d'un compte supprimé", async () => {
    state.candidates = [candidate({ caster_user_id: CASTER })];
    state.users = [{ id: CASTER, pseudo: "compte_supprime_1", discord_pseudo: null, discord_verified_at: null, overwatch_battletag: null, blizzard_sub: null, visible_overwatch: 0, is_deleted: 1 }];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.caster).toBeNull();
  });
});

describe("listViewerMatchLaunches — lancement d'office", () => {
  it("ouvre le délai d'un lancement jamais observé, puis relit", async () => {
    state.candidates = [candidate({ lobby_opened_at: null })];
    await listViewerMatchLaunches(viewer);
    expect(state.writes.some((w) => w.includes("SET lobby_opened_at = NOW()"))).toBe(true);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("lance d'office un match dont le délai est échu", async () => {
    state.candidates = [candidate({ lobby_opened_at: new Date(Date.now() - 20 * 60_000).toISOString() })];
    await listViewerMatchLaunches(viewer);
    expect(state.writes.some((w) => w.includes("SET launched_at = NOW()"))).toBe(true);
  });

  it("n'écrit rien quand rien n'est dû", async () => {
    await listViewerMatchLaunches(viewer);
    expect(state.writes).toEqual([]);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});
