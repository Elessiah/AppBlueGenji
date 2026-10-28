import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { listViewerMatchLaunches, loadViewerMatchContacts } from "@/lib/server/tournaments/match-launch-info";
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
    match_launch_phase: 1,
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
    tournament_game: "OW",
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
  /** Un tournoi en cours a-t-il la phase de lancement ? (défaut : `running`) */
  runningWithLaunchPhase?: boolean;
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

/**
 * Contexte du candidat relu hors verrou (tournoi, option de planification,
 * statut fantôme) : le tournoi est passé deux fois.
 */
function candidateContextRows(world: World, params: unknown[]) {
  const [tournamentId, , , team1Id] = params.map(Number);
  const c = world.candidates.find((x) => x.tournament_id === tournamentId && x.team1_id === team1Id);
  if (!c) return [];
  return [
    {
      tournament_state: c.tournament_state,
      referee_scheduling: c.referee_scheduling ?? 0,
      match_launch_phase: c.match_launch_phase ?? 1,
      team1_is_ghost: c.team1_is_ghost,
      team2_is_ghost: c.team2_is_ghost,
    },
  ];
}

/** Drapeau « un tournoi est en cours » ; la modale ne compte que la phase de lancement. */
function runningFlag(world: World, sql: string): boolean {
  if (!sql.includes("match_launch_phase = 1")) return world.running;
  return world.runningWithLaunchPhase ?? world.running;
}

/**
 * Casters d'un candidat (`bg_match_casters`) : `caster_user_id` /
 * `caster_ready_at` du candidat décrivent le premier, `co_casters` les
 * suivants — un raccourci de ce double, pas des colonnes lues.
 */
function castersOf(c: Candidate) {
  const first =
    c.caster_user_id === null || c.caster_user_id === undefined
      ? []
      : [{ user_id: c.caster_user_id, ready_at: c.caster_ready_at ?? null, stream_id: 1 }];
  const others = (c.co_casters as { user_id: number; ready_at?: string | null; stream_id?: number }[] | undefined) ?? [];
  return [...first, ...others].map((caster) => ({
    match_id: c.id,
    user_id: caster.user_id,
    stream_id: caster.stream_id ?? 1,
    ready_at: caster.ready_at ?? null,
  }));
}

/** Lectures des streams (aucun ici) et des casters des candidats. */
function readCastRows(world: World, sql: string, params: unknown[]): unknown[] | null {
  if (sql.includes("FROM bg_match_streams")) return [[], []];
  if (!sql.startsWith("SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters")) return null;
  const ids = new Set(params.map(Number));
  return [world.candidates.filter((c) => ids.has(Number(c.id))).flatMap(castersOf), []];
}

function connectionFor(world: World): PoolConnection {
  const execute = async (rawSql: string, params: unknown[] = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    world.reads.push(sql);
    if (sql.includes("AS running")) return [[{ running: Number(runningFlag(world, sql)) }], []];
    if (sql.startsWith("UPDATE") || sql.startsWith("DELETE")) {
      world.writes.push(sql);
      return [{ affectedRows: 1 }, []];
    }
    const castRows = readCastRows(world, sql, params);
    if (castRows) return castRows;
    if (sql.startsWith("SELECT team_id, roles_json FROM bg_team_members")) {
      return [world.viewerMemberships, []];
    }
    if (sql.startsWith("SELECT id FROM bg_teams WHERE solo_user_id")) return [world.viewerSolo, []];
    if (sql.includes("FOR UPDATE")) {
      // Relecture sous verrou d'un candidat par l'entretien.
      return [world.candidates.filter((c) => c.id === Number(params[0])), []];
    }
    if (sql.includes("AS tournament_state") && !sql.includes("FROM bg_matches")) {
      return [candidateContextRows(world, params), []];
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
      viewer: { role: "TEAM1", canDeclareReady: true, ready: false, isCaster: false, earlyContacts: true },
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
    expect(info.viewer).toEqual({ role: "TEAM1", canDeclareReady: false, ready: false, isReferee: false, isCaster: false, earlyContacts: true });
  });

  it("reconnaît le caster et son « Prêt »", async () => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: VIEWER, caster_ready_at: OPENED })];
    state.users = [casterUser(VIEWER)];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer).toEqual({ role: "CASTER", canDeclareReady: true, ready: true, isReferee: false, isCaster: true, earlyContacts: false });
    expect(info.casters[0]).toMatchObject({
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
    expect(info.viewer).toEqual({ role: "TEAM2", canDeclareReady: true, ready: false, isReferee: false, isCaster: false, earlyContacts: true });
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
      expect.stringContaining("SELECT EXISTS (SELECT 1 FROM bg_tournaments WHERE state = 'RUNNING'"),
    ]);
  });

  // Option désactivée par défaut : un tournoi en cours sans phase de lancement
  // n'a rien à présenter dans la modale, la lecture complète serait vaine.
  it("ne lit que le drapeau quand aucun tournoi en cours n'a la phase de lancement", async () => {
    state.runningWithLaunchPhase = false;

    await expect(listViewerMatchLaunches(viewer)).resolves.toEqual([]);

    expect(state.reads).toEqual([expect.stringContaining("WHERE state = 'RUNNING' AND match_launch_phase = 1")]);
  });

  it("garde le bouton « Contacts » sur un tournoi en cours sans phase de lancement", async () => {
    state.runningWithLaunchPhase = false;
    state.candidates = [candidate({ match_launch_phase: 0 })];

    await expect(loadViewerMatchContacts(viewer, 42)).resolves.not.toBeNull();

    const flag = state.reads.find((sql) => sql.includes("AS running"));
    expect(flag).not.toContain("match_launch_phase");
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
    // La fiche lit la décision du serveur : une note, pas « Aucun contact ».
    expect([info.team1.contactsShown, info.team2.contactsShown]).toEqual([false, false]);
    expect(info.casters[0]).toMatchObject({ pseudo: "Caster", discordTag: null, battletag: null, contactsShown: false });
    expect(info.autoLaunchAt).toBeNull();
  });

  it("n'expose aucun contact pour une équipe fantôme", async () => {
    state.candidates = [candidate({ team2_is_ghost: 1 })];
    state.members = [member(TEAM2, 5, { discord_pseudo: "own", discord_verified_at: OPENED })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.team2).toMatchObject({ isGhost: true, ready: true, contacts: [], contactsShown: false });
    // L'autre engagée, elle, a ses contacts ouverts : le drapeau est par fiche.
    expect(info.team1.contactsShown).toBe(true);
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
    expect(info.casters[0]).toMatchObject({ pseudo: "Caster", discordTag: "caster", battletag: "Caster#1", contactsShown: true });
  });

  it("listViewerMatchLaunches_marvelRivalsCaster_omitsBattletagFields", async () => {
    state.candidates = [candidate({ tournament_game: "MR", caster_user_id: CASTER })];
    state.users = [casterUser(CASTER)];

    const [info] = await listViewerMatchLaunches(viewer);

    expect(info.casters[0]).toEqual({
      userId: CASTER,
      pseudo: "Caster",
      discordTag: "caster",
      ready: false,
      contactsShown: true,
      isViewer: false,
    });
    expect(JSON.stringify(info)).not.toContain("Caster#1");
  });

  it("tait le caster d'un compte supprimé", async () => {
    state.candidates = [candidate({ caster_user_id: CASTER })];
    state.users = [{ id: CASTER, pseudo: "compte_supprime_1", discord_pseudo: null, discord_verified_at: null, overwatch_battletag: null, blizzard_sub: null, visible_overwatch: 0, is_deleted: 1, is_admin: 0, platform_roles_json: null }];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.casters).toEqual([]);
  });
});

// Co-casters (`docs/features/MATCH_LAUNCH.md` § Casters et streams) : chaque
// caster est une partie du match, rejouée pour lui seul.
describe("listViewerMatchLaunches — co-casters", () => {
  const COCASTER = 901;

  it("montre aux joueurs chaque caster, avec ses contacts et son « Prêt »", async () => {
    state.candidates = [candidate({ caster_user_id: CASTER, co_casters: [{ user_id: COCASTER, ready_at: OPENED, stream_id: 2 }] })];
    state.users = [casterUser(CASTER), casterUser(COCASTER, { pseudo: "Écho", discord_pseudo: "echo" })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.casters).toEqual([
      expect.objectContaining({ userId: CASTER, discordTag: "caster", ready: false, contactsShown: true, isViewer: false }),
      expect.objectContaining({ userId: COCASTER, discordTag: "echo", ready: true, contactsShown: true, isViewer: false }),
    ]);
  });

  it("à un co-caster : les contacts de l'autre caster le temps du match, sa fiche marquée, son seul « Prêt »", async () => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ caster_user_id: CASTER, caster_ready_at: OPENED, co_casters: [{ user_id: VIEWER }] })];
    state.users = [casterUser(CASTER), casterUser(VIEWER, { pseudo: "Moi" })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer).toMatchObject({ role: "CASTER", isCaster: true, ready: false });
    expect(info.casters).toEqual([
      expect.objectContaining({ userId: CASTER, discordTag: "caster", contactsShown: true, isViewer: false, ready: true }),
      expect.objectContaining({ userId: VIEWER, isViewer: true, ready: false }),
    ]);
  });

  it("avant le départ, un co-caster ne lit pas les contacts de l'autre caster", async () => {
    state.viewerMemberships = [];
    state.candidates = [
      candidate({
        match_launch_phase: 0,
        start_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        lobby_opened_at: null,
        caster_user_id: CASTER,
        co_casters: [{ user_id: VIEWER }],
      }),
    ];
    state.users = [casterUser(CASTER), casterUser(VIEWER)];
    const info = await loadViewerMatchContacts(viewer, 42);
    // La carte d'un match pas encore parti ne rend rien au caster (règle inchangée).
    expect(info).toBeNull();
  });

  it("un co-caster devenu inéligible est retiré seul : l'autre reste", async () => {
    state.candidates = [candidate({ caster_user_id: CASTER, co_casters: [{ user_id: COCASTER, stream_id: 2 }] })];
    state.users = [casterUser(CASTER), casterUser(COCASTER, { platform_roles_json: null })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.casters.map((caster) => caster.userId)).toEqual([CASTER]);
    const releases = state.writes.filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"));
    expect(releases).toHaveLength(1);
  });
});

describe("listViewerMatchLaunches — caster qui ne remplit plus la condition", () => {
  const castRelease = (world: World) =>
    world.writes.filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"));

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
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
  });

  it("tait aux joueurs un caster devenu inéligible et libère le match", async () => {
    state.candidates = [candidate({ caster_user_id: CASTER })];
    state.users = [casterUser(CASTER, { platform_roles_json: null })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.viewer.role).toBe("TEAM1");
    expect(info.casters).toEqual([]);
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
    expect(info.casters).toEqual([]);
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

describe("listViewerMatchLaunches — option « phase de lancement »", () => {
  it("ne présente à la modale que les tournois qui ont la phase de lancement", async () => {
    await listViewerMatchLaunches(viewer);
    const read = state.reads.find((sql) => sql.includes("t.name AS tournament_name"));
    expect(read).toContain("AND t.match_launch_phase = 1");
    expect(read).toContain(`INTERVAL ${60} MINUTE`);
  });
});

describe("loadViewerMatchContacts — bouton « Contacts » d'une carte", () => {
  const scheduled = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
  const verifiedCaptain = () =>
    member(TEAM2, 5, { roles_json: JSON.stringify(["CAPITAINE"]), discord_pseudo: "cap2", discord_verified_at: OPENED });

  it("expose les contacts d'un match programmé, même hors de la fenêtre de la modale", async () => {
    state.candidates = [candidate({ match_launch_phase: 0, start_at: scheduled(), caster_user_id: CASTER })];
    state.members = [verifiedCaptain()];
    state.users = [casterUser(CASTER)];
    const info = await loadViewerMatchContacts(viewer, 42);
    expect(info?.phase).toBe("SCHEDULED");
    expect(info?.team2.contacts).toEqual([expect.objectContaining({ userId: 5, discordTag: "cap2" })]);
    // Avant l'heure, les contacts du caster sont tus aux équipes : symétrique
    // de ce qu'il reçoit d'elles (décision de l'utilisateur, 2026-10-19).
    expect(info?.casters[0]).toMatchObject({ pseudo: "Caster", discordTag: null, battletag: null });
  });

  it("lit un seul match, sans le filtre de l'option ni la fenêtre de la modale", async () => {
    await loadViewerMatchContacts(viewer, 42);
    const read = state.reads.find((sql) => sql.includes("t.name AS tournament_name"));
    expect(read).toContain("AND m.id = ?");
    expect(read).not.toContain("t.match_launch_phase = 1");
    expect(read).not.toContain("INTERVAL 60 MINUTE");
    // « À planifier » n'est écarté que de la modale.
    expect(read).not.toContain("m.start_at IS NOT NULL OR t.referee_scheduling = 0");
  });

  it("expose les contacts d'un match lancé d'emblée sur un tournoi sans phase de lancement", async () => {
    state.candidates = [candidate({ match_launch_phase: 0 })];
    state.members = [verifiedCaptain()];
    const info = await loadViewerMatchContacts(viewer, 42);
    expect(info?.phase).toBe("LAUNCHED");
    expect(info?.team2.contacts).toHaveLength(1);
  });

  it("sans phase de lancement, heure passée mais lancement pas encore écrit : retire le caster devenu inéligible", async () => {
    state.candidates = [candidate({ match_launch_phase: 0, caster_user_id: CASTER })];
    state.members = [verifiedCaptain()];
    state.users = [casterUser(CASTER, { platform_roles_json: null })];
    const info = await loadViewerMatchContacts(viewer, 42);
    expect(info?.phase).toBe("LAUNCHED");
    expect(info?.casters).toEqual([]);
    expect(state.writes.filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"))).toHaveLength(1);
  });

  it("ne met pas en file le retrait du caster d'un match au report en attente", async () => {
    state.candidates = [candidate({ status: "AWAITING_CONFIRMATION", caster_user_id: CASTER })];
    state.members = [verifiedCaptain()];
    state.users = [casterUser(CASTER, { platform_roles_json: null })];
    const info = await loadViewerMatchContacts(viewer, 42);
    expect(info?.casters).toEqual([]);
    expect(state.writes.filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"))).toEqual([]);
    expect(state.reads.filter((sql) => sql.includes("FOR UPDATE"))).toEqual([]);
  });

  it("garde la phase de lancement d'un tournoi qui l'a allumée", async () => {
    state.members = [verifiedCaptain()];
    const info = await loadViewerMatchContacts(viewer, 42);
    expect(info?.phase).toBe("LOBBY");
    expect(info?.team2.contacts).toHaveLength(1);
  });

  it("ne rend rien à qui n'est ni joueur ni caster du match", async () => {
    state.viewerMemberships = [];
    state.members = [verifiedCaptain()];
    await expect(loadViewerMatchContacts(viewer, 42)).resolves.toBeNull();
  });

  it("ne rend rien d'un match terminé", async () => {
    state.candidates = [candidate({ status: "COMPLETED" })];
    await expect(loadViewerMatchContacts(viewer, 42)).resolves.toBeNull();
  });

  it("expose les contacts d'un match à planifier, dès que ses deux adversaires sont connus (option allumée ou non)", async () => {
    for (const launchPhase of [0, 1]) {
      state.candidates = [candidate({ referee_scheduling: 1, start_at: null, match_launch_phase: launchPhase })];
      state.members = [verifiedCaptain()];
      const info = await loadViewerMatchContacts(viewer, 42);
      expect(info?.phase).toBe("TO_PLAN");
      expect(info?.team2.contacts).toEqual([expect.objectContaining({ userId: 5, discordTag: "cap2" })]);
    }
    // Sans adversaire connu, rien.
    state.candidates = [candidate({ referee_scheduling: 1, start_at: null, team2_id: null })];
    await expect(loadViewerMatchContacts(viewer, 42)).resolves.toBeNull();
  });

  it("ne rend rien au caster inscrit tant que le match n'est pas parti (programmé ou à planifier)", async () => {
    state.viewerMemberships = [];
    state.members = [verifiedCaptain()];
    state.users = [casterUser(VIEWER)];
    for (const row of [
      candidate({ match_launch_phase: 0, start_at: scheduled(), caster_user_id: VIEWER }),
      candidate({ referee_scheduling: 1, start_at: null, caster_user_id: VIEWER }),
    ]) {
      state.candidates = [row];
      await expect(loadViewerMatchContacts(viewer, 42)).resolves.toBeNull();
    }
  });

  it("retire, par sa propre lecture de la carte avant l'heure, le caster devenu inéligible", async () => {
    state.viewerMemberships = [];
    state.users = [casterUser(VIEWER, { platform_roles_json: null })];
    for (const row of [
      candidate({ match_launch_phase: 0, start_at: scheduled(), caster_user_id: VIEWER }),
      candidate({ referee_scheduling: 1, start_at: null, caster_user_id: VIEWER }),
    ]) {
      state.candidates = [row];
      state.writes = [];
      await expect(loadViewerMatchContacts(viewer, 42)).resolves.toBeNull();
      expect(state.writes.filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"))).toHaveLength(1);
    }
  });

  it("la modale, elle, ne relit pas le caster d'un match encore à planifier", async () => {
    state.viewerMemberships = [];
    state.users = [casterUser(VIEWER, { platform_roles_json: null })];
    state.candidates = [candidate({ referee_scheduling: 1, start_at: null, caster_user_id: VIEWER })];
    expect(await listViewerMatchLaunches(viewer)).toEqual([]);
    expect(state.reads.some((sql) => sql.includes("FROM bg_users WHERE id IN"))).toBe(false);
    expect(state.writes).toEqual([]);
  });

  it("un arbitre ne lit, par la modale, aucun match dont il n'est pas partie", async () => {
    state.viewerMemberships = [];
    const referee = { id: VIEWER, roles: ["ARBITRE" as const] };
    expect(await listViewerMatchLaunches(referee)).toEqual([]);
    expect(state.reads.find((sql) => sql.includes("t.name AS tournament_name"))).not.toContain("1 = 1 OR");
  });

  it("ne retire rien au caster éligible qui ouvre la carte avant l'heure", async () => {
    state.viewerMemberships = [];
    state.users = [casterUser(VIEWER)];
    state.candidates = [candidate({ referee_scheduling: 1, start_at: null, caster_user_id: VIEWER })];
    await expect(loadViewerMatchContacts(viewer, 42)).resolves.toBeNull();
    expect(state.writes.filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"))).toEqual([]);
  });

  it("rend au caster inscrit les contacts le temps du match (lancement ouvert, puis lancé)", async () => {
    state.viewerMemberships = [];
    state.members = [verifiedCaptain()];
    state.users = [casterUser(VIEWER)];
    const cases: [ReturnType<typeof candidate>, string][] = [
      [candidate({ caster_user_id: VIEWER }), "LOBBY"],
      [candidate({ match_launch_phase: 0, caster_user_id: VIEWER }), "LAUNCHED"],
    ];
    for (const [row, phase] of cases) {
      state.candidates = [row];
      const info = await loadViewerMatchContacts(viewer, 42);
      expect(info?.viewer.role).toBe("CASTER");
      expect(info?.phase).toBe(phase);
      expect(info?.team2.contacts).toEqual([expect.objectContaining({ userId: 5, discordTag: "cap2" })]);
    }
  });

  // Décision du 2026-10-19 : l'arbitre (permission `tournaments`) lit, par la
  // carte, les mêmes contacts que les joueurs du match, aux mêmes moments.
  describe("arbitre", () => {
    const referee = { id: VIEWER, roles: ["ARBITRE" as const] };
    const hiddenCaptain = () =>
      member(TEAM2, 5, {
        roles_json: JSON.stringify(["CAPITAINE"]),
        discord_pseudo: "cap2",
        discord_verified_at: OPENED,
        overwatch_battletag: "Cap#2",
        visible_overwatch: 0,
      });

    beforeEach(() => {
      state.viewerMemberships = [];
      state.members = [hiddenCaptain()];
    });

    it("rend dès « À planifier » les contacts, BattleTag masqué compris, sans « Prêt » à donner", async () => {
      state.candidates = [candidate({ referee_scheduling: 1, start_at: null, caster_user_id: CASTER })];
      state.users = [casterUser(CASTER)];
      const info = await loadViewerMatchContacts(referee, 42);
      expect(info?.phase).toBe("TO_PLAN");
      expect(info?.viewer).toEqual({ role: "REFEREE", canDeclareReady: false, ready: false, isReferee: false, isCaster: false, earlyContacts: true });
      expect(info?.team2.contacts).toEqual([expect.objectContaining({ userId: 5, discordTag: "cap2", battletag: "Cap#2" })]);
      expect(info?.team2.contactsShown).toBe(true);
      // Décision du 2026-10-21 : ceux du caster aussi, dès « À planifier ».
      expect(info?.casters[0]).toMatchObject({ discordTag: "caster", battletag: "Caster#1" });
    });

    // Décision 35 (2026-10-28) : hors Overwatch, seuls casters et arbitre perdent le BattleTag.
    it("loadViewerMatchContacts_marvelRivalsStaffReferee_keepsTeamContactsWithoutCasterBattletag", async () => {
      state.candidates = [candidate({ tournament_game: "MR", referee_scheduling: 1, start_at: null, caster_user_id: CASTER })];
      state.users = [casterUser(CASTER)];

      const info = await loadViewerMatchContacts(referee, 42);

      expect(info?.team2.contacts).toEqual([expect.objectContaining({ userId: 5, battletag: "Cap#2" })]);
      expect(info?.casters[0]).toEqual(expect.objectContaining({ discordTag: "caster", contactsShown: true }));
      expect(info?.casters[0]).not.toHaveProperty("battletag");
    });

    it("rend les contacts du caster d'un match programmé", async () => {
      const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
      state.candidates = [candidate({ match_launch_phase: 0, start_at: later, lobby_opened_at: null, caster_user_id: CASTER })];
      state.users = [casterUser(CASTER)];
      const info = await loadViewerMatchContacts(referee, 42);
      expect(info?.phase).toBe("SCHEDULED");
      expect(info?.casters[0]).toMatchObject({ discordTag: "caster", battletag: "Caster#1", contactsShown: true });
    });

    it("un arbitre qui joue le match lit en joueur : contacts du caster le temps du match seulement", async () => {
      state.viewerMemberships = [{ team_id: TEAM1, roles_json: JSON.stringify(["DPS"]) }];
      state.candidates = [candidate({ referee_scheduling: 1, start_at: null, caster_user_id: CASTER })];
      state.users = [casterUser(CASTER)];
      const info = await loadViewerMatchContacts(referee, 42);
      expect(info?.viewer).toMatchObject({ role: "TEAM1" });
      expect(info?.casters[0]).toMatchObject({ discordTag: null, battletag: null, contactsShown: false });
    });

    it("rend aussi les contacts du caster une fois le match parti", async () => {
      state.candidates = [candidate({ caster_user_id: CASTER })];
      state.users = [casterUser(CASTER)];
      const info = await loadViewerMatchContacts(referee, 42);
      expect(info?.phase).toBe("LOBBY");
      expect(info?.casters[0]).toMatchObject({ discordTag: "caster", battletag: "Caster#1" });
    });

    it("lit le match sans exiger d'en être partie", async () => {
      await loadViewerMatchContacts(referee, 42);
      expect(state.reads.find((sql) => sql.includes("t.name AS tournament_name"))).toContain("AND (1 = 1 OR EXISTS ( SELECT 1 FROM bg_match_casters mc");
      await loadViewerMatchContacts(viewer, 42);
      const last = state.reads.filter((sql) => sql.includes("t.name AS tournament_name")).at(-1);
      expect(last).not.toContain("1 = 1");
    });

    it("vaut pour un administrateur, pas pour un caster sans arbitrage", async () => {
      await expect(loadViewerMatchContacts({ id: VIEWER, isAdmin: true }, 42)).resolves.toMatchObject({
        viewer: { role: "REFEREE" },
      });
      await expect(loadViewerMatchContacts({ id: VIEWER, roles: ["CASTER"] }, 42)).resolves.toBeNull();
    });

    it("ne présente rien à l'arbitre dans la modale de lancement", async () => {
      await expect(listViewerMatchLaunches(referee)).resolves.toEqual([]);
      expect(state.reads.find((sql) => sql.includes("t.name AS tournament_name"))).not.toContain("1 = 1");
    });

    it("ne rend rien d'un match terminé", async () => {
      state.candidates = [candidate({ status: "COMPLETED" })];
      await expect(loadViewerMatchContacts(referee, 42)).resolves.toBeNull();
    });

    it("tait et retire le caster devenu joueur du match", async () => {
      state.viewerMemberships = [{ team_id: TEAM1, roles_json: JSON.stringify(["DPS"]) }];
      state.candidates = [candidate({ caster_user_id: VIEWER })];
      state.users = [casterUser(VIEWER)];
      const info = await loadViewerMatchContacts(viewer, 42);
      expect(info?.viewer).toMatchObject({ role: "TEAM1", isCaster: false });
      expect(info?.casters).toEqual([]);
      expect(state.writes.filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"))).toHaveLength(1);
      // Vu d'un autre lecteur (arbitre), par le roster lu pour les contacts.
      state.writes = [];
      state.viewerMemberships = [];
      state.members = [member(TEAM1, VIEWER)];
      const seen = await loadViewerMatchContacts({ id: 1234, roles: ["ARBITRE"] }, 42);
      expect(seen?.casters).toEqual([]);
    });

    it("retire dès « programmé » le caster devenu joueur ; lancé, le garde", async () => {
      state.viewerMemberships = [{ team_id: TEAM1, roles_json: JSON.stringify(["DPS"]) }];
      state.users = [casterUser(VIEWER)];
      const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
      state.candidates = [candidate({ match_launch_phase: 0, start_at: later, lobby_opened_at: null, caster_user_id: VIEWER })];
      const scheduled = await loadViewerMatchContacts(viewer, 42);
      expect(scheduled?.casters).toEqual([]);
      expect(state.writes.filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"))).toHaveLength(1);
      state.writes = [];
      state.candidates = [candidate({ match_launch_phase: 0, caster_user_id: VIEWER, launched_at: OPENED })];
      const launched = await loadViewerMatchContacts(viewer, 42);
      expect(launched?.viewer).toMatchObject({ role: "TEAM1", isCaster: true });
      expect(launched?.casters[0]).toMatchObject({ userId: VIEWER });
      expect(state.writes).toEqual([]);
    });

    it("dit au lecteur qu'il est le caster", async () => {
      state.candidates = [candidate({ referee_scheduling: 1, start_at: null, caster_user_id: VIEWER })];
      state.users = [casterUser(VIEWER)];
      const info = await loadViewerMatchContacts(referee, 42);
      expect(info?.viewer).toMatchObject({ role: "CASTER", isCaster: true });
      state.candidates = [candidate({ referee_scheduling: 1, start_at: null, caster_user_id: CASTER })];
      state.users = [casterUser(CASTER)];
      await expect(loadViewerMatchContacts(referee, 42)).resolves.toMatchObject({ viewer: { role: "REFEREE", isCaster: false } });
    });

    // Un arbitre qui caste : la modale de lancement le lit en caster, mais la
    // carte lui ouvre déjà les contacts — sa note y renvoie (`earlyContacts`).
    it("dit à la modale de lancement que la carte lui ouvre déjà les contacts", async () => {
      state.candidates = [candidate({ caster_user_id: VIEWER })];
      state.users = [casterUser(VIEWER)];
      const [asReferee] = await listViewerMatchLaunches(referee);
      expect(asReferee?.viewer).toMatchObject({ role: "CASTER", isReferee: false, isCaster: true, earlyContacts: true });
      const [asCaster] = await listViewerMatchLaunches({ id: VIEWER });
      expect(asCaster?.viewer).toMatchObject({ role: "CASTER", isReferee: false, isCaster: true, earlyContacts: false });
    });
  });

  it("ne rend rien quand aucun tournoi n'est en cours", async () => {
    state.running = false;
    await expect(loadViewerMatchContacts(viewer, 42)).resolves.toBeNull();
  });
});

describe("listViewerMatchLaunches — arbitre désigné (`docs/features/MATCH_REFEREE.md`)", () => {
  const REFEREE = 950;
  const refereeUser = (overrides: Record<string, unknown> = {}) =>
    casterUser(REFEREE, {
      pseudo: "Arbitre",
      overwatch_battletag: "Arbitre#1",
      platform_roles_json: JSON.stringify(["ARBITRE"]),
      ...overrides,
    });

  it("les équipes lisent son pseudo et son BattleTag, masqué compris, et attendent son « Prêt »", async () => {
    state.candidates = [candidate({ referee_user_id: REFEREE, referee_ready_at: null, self_managed: 0 })];
    state.users = [refereeUser({ visible_overwatch: 0 })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.referee).toEqual({
      userId: REFEREE,
      pseudo: "Arbitre",
      battletag: "Arbitre#1",
      battletagVerified: true,
      ready: false,
      isViewer: false,
    });
    expect(info.selfManaged).toBe(false);
    expect(info.viewer.isReferee).toBe(false);
  });

  it("listViewerMatchLaunches_marvelRivalsReferee_omitsBattletagFields", async () => {
    state.candidates = [candidate({ tournament_game: "MR", referee_user_id: REFEREE, self_managed: 0 })];
    state.users = [refereeUser()];

    const [info] = await listViewerMatchLaunches(viewer);

    expect(info.referee).toEqual({ userId: REFEREE, pseudo: "Arbitre", ready: false, isViewer: false });
    expect(JSON.stringify(info)).not.toContain("Arbitre#1");
  });

  it("son BattleTag attend la fenêtre des contacts : rien avant l'heure de début", async () => {
    state.candidates = [
      candidate({ referee_user_id: REFEREE, start_at: new Date(Date.now() + 30 * 60_000).toISOString() }),
    ];
    state.users = [refereeUser()];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.referee).toMatchObject({ pseudo: "Arbitre", battletag: null });
  });

  it("l'arbitre lui-même lit le match en `MATCH_REFEREE`, avec son « Prêt » à donner", async () => {
    state.viewerMemberships = [];
    state.candidates = [candidate({ referee_user_id: VIEWER, referee_ready_at: OPENED })];
    state.users = [casterUser(VIEWER, { pseudo: "Moi", platform_roles_json: JSON.stringify(["ARBITRE"]) })];
    const [info] = await listViewerMatchLaunches({ id: VIEWER, roles: ["ARBITRE"] });
    expect(info.viewer).toMatchObject({ role: "MATCH_REFEREE", canDeclareReady: true, isReferee: true, ready: true });
    expect(info.referee).toMatchObject({ isViewer: true, ready: true });
  });

  it("un arbitre devenu inéligible n'est plus montré, et il est retiré avant le lancement", async () => {
    state.candidates = [candidate({ referee_user_id: REFEREE })];
    state.users = [refereeUser({ platform_roles_json: JSON.stringify(["CASTER"]) })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.referee).toBeNull();
    expect(JSON.stringify(info)).not.toContain("Arbitre#1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(state.writes.some((sql) => sql.includes("referee_user_id = NULL"))).toBe(true);
  });

  it("autogestion : aucun arbitre, la note suit", async () => {
    state.candidates = [candidate({ self_managed: 1 })];
    const [info] = await listViewerMatchLaunches(viewer);
    expect(info.referee).toBeNull();
    expect(info.selfManaged).toBe(true);
  });
});
