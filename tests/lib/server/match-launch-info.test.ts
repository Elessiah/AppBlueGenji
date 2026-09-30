import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { listViewerMatchLaunches } from "@/lib/server/tournaments/match-launch-info";
import { invalidateTournamentLists } from "@/lib/server/tournaments/list-cache";
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

/** Compte d'un caster **éligible** : permission `live` et identité exigée. */
function casterUser(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    pseudo: "Caster",
    discord_pseudo: "caster",
    discord_verified_at: OPENED,
    overwatch_battletag: "Caster#1",
    blizzard_sub: "sub",
    visible_overwatch: 0,
    is_deleted: 0,
    is_admin: 0,
    platform_roles_json: JSON.stringify(["CASTER"]),
    ...overrides,
  };
}

type World = {
  /** Un tournoi est-il en cours sur le site ? */
  running: boolean;
  /** Requêtes reçues, dans l'ordre. */
  reads: string[];
  viewerMemberships: { team_id: number; roles_json: string }[];
  viewerSolo: { id: number }[];
  candidates: Candidate[];
  members: ReturnType<typeof member>[];
  users: Record<string, unknown>[];
  writes: string[];
  /** La relecture sous verrou du retrait d'un caster échoue. */
  failRelease?: boolean;
};

let state: World;

function connectionFor(world: World): PoolConnection {
  const execute = async (rawSql: string, params: unknown[] = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    world.reads.push(sql);
    if (sql.includes("AS running")) return [[{ running: world.running ? 1 : 0 }], []];
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
      // Contexte du candidat relu hors verrou (tournoi, option de
      // planification, statut fantôme) : le tournoi est passé deux fois.
      const [tournamentId, , team1Id] = params.map(Number);
      const c = world.candidates.find((x) => x.tournament_id === tournamentId && x.team1_id === team1Id);
      return [
        c
          ? [
              {
                tournament_state: c.tournament_state,
                referee_scheduling: c.referee_scheduling ?? 0,
                team1_is_ghost: c.team1_is_ghost,
                team2_is_ghost: c.team2_is_ghost,
              },
            ]
          : [],
        [],
      ];
    }
    if (sql.includes("WHERE m.tournament_id = ?")) {
      // Entretien : candidats au lancement du tournoi.
      return [world.candidates.filter((c) => c.launched_at === null), []];
    }
    if (sql.includes("t.name AS tournament_name")) return [world.candidates, []];
    if (sql.includes("FROM bg_team_members tm")) return [world.members, []];
    if (sql.includes("FROM bg_users WHERE id IN")) return [world.users, []];
    if (sql.includes("FROM bg_users WHERE id = ?")) {
      // Relecture sous verrou par le retrait d'un caster non éligible.
      if (world.failRelease) throw new Error("base injoignable");
      return [world.users.filter((u) => u.id === Number(params[0])), []];
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

beforeEach(() => {
  jest.clearAllMocks();
  // Le drapeau « un tournoi est en cours » est mutualisé : chaque test repart
  // d'un cache vide.
  invalidateTournamentLists();
  state = {
    running: true,
    reads: [],
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
    state.users = [casterUser(VIEWER)];
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

describe("listViewerMatchLaunches — coût de l'interrogation", () => {
  // La modale interroge toutes les minutes sur chaque onglet d'un compte
  // connecté : quand rien ne se joue sur le site, la réponse ne doit rien lire.
  it("ne lit rien d'autre que le drapeau quand aucun tournoi n'est en cours", async () => {
    state.running = false;

    await expect(listViewerMatchLaunches(viewer)).resolves.toEqual([]);

    expect(state.reads).toEqual([
      expect.stringContaining("SELECT EXISTS (SELECT 1 FROM bg_tournaments WHERE state = 'RUNNING')"),
    ]);
  });

  it("mutualise le drapeau entre les lecteurs", async () => {
    state.running = false;

    await listViewerMatchLaunches(viewer);
    await listViewerMatchLaunches({ id: 2, roles: [] });

    expect(state.reads.filter((sql) => sql.includes("AS running"))).toHaveLength(1);
  });

  it("relit le drapeau une fois les listes de tournois invalidées", async () => {
    state.running = false;
    await expect(listViewerMatchLaunches(viewer)).resolves.toEqual([]);

    state.running = true;
    invalidateTournamentLists();

    await expect(listViewerMatchLaunches(viewer)).resolves.toHaveLength(1);
  });

  // Le cas courant — des tournois en cours, aucun match pour ce lecteur — ne
  // coûte qu'une lecture : ses équipes sont lues dans la requête des matchs.
  it("s'arrête à la requête des matchs quand le lecteur n'en a aucun", async () => {
    state.candidates = [];

    await expect(listViewerMatchLaunches(viewer)).resolves.toEqual([]);

    const afterFlag = state.reads.filter((sql) => !sql.includes("AS running"));
    expect(afterFlag).toHaveLength(1);
    expect(afterFlag[0]).toContain("t.name AS tournament_name");
    expect(afterFlag[0]).toContain("FROM bg_team_members tm WHERE tm.user_id = ? AND tm.left_at IS NULL");
    expect(afterFlag[0]).toContain("SELECT st.id FROM bg_teams st WHERE st.solo_user_id = ?");
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
    state.users = [casterUser(CASTER)];
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

  // AUTHORIZATION_RULES §2.3 : le caster inscrit est une partie du match —
  // exposition déclarée (`PRIVACY_CHANGES`, `2026-09-lancement-des-matchs`).
  it("montre au caster inscrit le BattleTag masqué des contacts", async () => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: VIEWER })];
    state.members = [
      member(TEAM1, 2, {
        roles_json: JSON.stringify(["CAPITAINE"]),
        discord_pseudo: "cap",
        discord_verified_at: OPENED,
        overwatch_battletag: "Masque#1",
        blizzard_sub: "s2",
      }),
    ];
    state.users = [casterUser(VIEWER)];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer.role).toBe("CASTER");
    expect(info.team1.contacts).toEqual([
      expect.objectContaining({ userId: 2, discordTag: "cap", battletag: "Masque#1" }),
    ]);
  });

  it("montre aux joueurs le BattleTag masqué du caster inscrit", async () => {
    state.candidates = [candidate({ caster_user_id: CASTER })];
    state.users = [casterUser(CASTER)];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer.role).toBe("TEAM1");
    expect(info.caster).toMatchObject({ pseudo: "Caster", discordTag: "caster", battletag: "Caster#1" });
  });

  it("tait le caster d'un compte supprimé", async () => {
    state.candidates = [candidate({ caster_user_id: CASTER })];
    state.users = [{ id: CASTER, pseudo: "compte_supprime_1", discord_pseudo: null, discord_verified_at: null, overwatch_battletag: null, blizzard_sub: null, visible_overwatch: 0, is_deleted: 1, is_admin: 0, platform_roles_json: null }];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.caster).toBeNull();
  });
});

describe("listViewerMatchLaunches — caster qui ne remplit plus la condition", () => {
  const castRelease = (world: World) =>
    world.writes.filter((sql) => sql.includes("SET caster_user_id = NULL"));

  beforeEach(() => {
    state.members = [
      member(TEAM1, 2, {
        roles_json: JSON.stringify(["CAPITAINE"]),
        discord_pseudo: "cap",
        discord_verified_at: OPENED,
        overwatch_battletag: "Masque#1",
        blizzard_sub: "s2",
      }),
    ];
  });

  it.each<[string, Record<string, unknown>]>([
    ["permission `live` retirée", { platform_roles_json: JSON.stringify(["RECRUTEUR"]) }],
    ["tag Discord décertifié", { discord_verified_at: null }],
    ["Battle.net détaché", { blizzard_sub: null }],
    ["compte supprimé", { is_deleted: 1 }],
  ])("%s : plus aucun contact, et l'inscription est retirée", async (_label, overrides) => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: VIEWER })];
    state.users = [casterUser(VIEWER, overrides)];
    expect(await listViewerMatchLaunches(viewer)).toEqual([]);
    expect(castRelease(state)).toHaveLength(1);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("tait aux joueurs un caster devenu inéligible et libère le match", async () => {
    state.candidates = [candidate({ caster_user_id: CASTER })];
    state.users = [casterUser(CASTER, { platform_roles_json: null })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer.role).toBe("TEAM1");
    expect(info.caster).toBeNull();
    expect(castRelease(state)).toHaveLength(1);
  });

  it("garde un administrateur, qui détient `live` sans rôle stocké", async () => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: VIEWER })];
    state.users = [casterUser(VIEWER, { is_admin: 1, platform_roles_json: null })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer.role).toBe("CASTER");
    expect(castRelease(state)).toEqual([]);
  });

  it("ne retire rien si le compte est redevenu éligible avant l'écriture", async () => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: VIEWER })];
    let lookups = 0;
    const eligible = casterUser(VIEWER);
    const revoked = casterUser(VIEWER, { platform_roles_json: null });
    Object.defineProperty(state, "users", {
      configurable: true,
      get: () => (lookups++ === 0 ? [revoked] : [eligible]),
    });
    expect(await listViewerMatchLaunches(viewer)).toEqual([]);
    expect(castRelease(state)).toEqual([]);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("tait sans le retirer le caster d'un match déjà lancé", async () => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: VIEWER, launched_at: OPENED })];
    state.users = [casterUser(VIEWER, { discord_verified_at: null })];
    expect(await listViewerMatchLaunches(viewer)).toEqual([]);
    expect(castRelease(state)).toEqual([]);

    state.viewerMemberships = [{ team_id: TEAM1, roles_json: JSON.stringify(["CAPITAINE"]) }];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.caster).toBeNull();
    expect(castRelease(state)).toEqual([]);
  });

  it("n'échoue pas quand le retrait est impossible", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: VIEWER })];
    state.users = [casterUser(VIEWER, { blizzard_sub: null })];
    state.failRelease = true;
    expect(await listViewerMatchLaunches(viewer)).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("listViewerMatchLaunches — lancement d'office", () => {
  it("ouvre le délai d'un lancement jamais observé, puis relit", async () => {
    state.candidates = [candidate({ lobby_opened_at: null })];
    await listViewerMatchLaunches(viewer);
    expect(state.writes.some((w) => w.includes("SET lobby_opened_at = NOW()"))).toBe(true);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("lance d'office un match dont le délai est échu", async () => {
    state.candidates = [candidate({ lobby_opened_at: new Date(Date.now() - 20 * 60_000).toISOString() })];
    await listViewerMatchLaunches(viewer);
    expect(state.writes.some((w) => w.includes("SET launched_at = NOW()"))).toBe(true);
  });

  it("n'écrit rien quand rien n'est dû", async () => {
    await listViewerMatchLaunches(viewer);
    expect(state.writes).toEqual([]);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });
});

describe("listViewerMatchLaunches — planification par l'arbitrage", () => {
  it("ne présente jamais un match à planifier, et ne l'entretient pas", async () => {
    state.candidates = [
      candidate({ referee_scheduling: 1, start_at: null, lobby_opened_at: null }),
    ];
    const launches = await listViewerMatchLaunches(viewer);
    expect(launches).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it("filtre les matchs à planifier dès la requête", async () => {
    await listViewerMatchLaunches(viewer);
    const read = state.reads.find((sql) => sql.includes("t.name AS tournament_name"));
    expect(read).toContain("(m.start_at IS NOT NULL OR t.referee_scheduling = 0)");
  });
});
