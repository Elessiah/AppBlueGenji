import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/state");

import {
  canUserRegister,
  registerCurrentUserTeam,
  resolveUserEntrantTeamId,
} from "@/lib/server/tournaments/registration";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { ensureSoloEntry, findSoloEntry } from "@/lib/server/solo-entries-service";
import { loadTournamentRow } from "@/lib/server/tournaments/repository";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";

function tournament(overrides: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: 5,
    state: "REGISTRATION",
    max_teams: 8,
    participant_type: "TEAM",
    ...overrides,
  } as TournamentRow;
}

/**
 * `registerTeam` (interne) enchaîne : compte des inscriptions existantes pour
 * l'engagé, puis compte total, puis INSERT. Ce faux exécuteur répond dans cet
 * ordre et retient la requête d'insertion.
 */
function fakeConnection(counts: { already?: number; registered?: number } = {}) {
  const inserts: [string, unknown[]][] = [];
  const execute = jest.fn(async (sql: string, params: unknown[]) => {
    if (String(sql).includes("INSERT")) {
      inserts.push([sql, params]);
      return [{ insertId: 1 }] as never;
    }
    if (String(sql).includes("AND team_id = ?")) {
      return [[{ c: counts.already ?? 0 }], []] as never;
    }
    return [[{ c: counts.registered ?? 0 }], []] as never;
  });
  return { connection: { execute } as unknown as PoolConnection, execute, inserts };
}

describe("resolveUserEntrantTeamId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("prend l'équipe active en tournoi par équipes", async () => {
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 12 } as never);
    const { connection } = fakeConnection();

    await expect(resolveUserEntrantTeamId(connection, tournament(), 3)).resolves.toBe(12);
    expect(findSoloEntry).not.toHaveBeenCalled();
  });

  it("prend l'entrée solo en tournoi individuel, sans jamais la créer", async () => {
    (findSoloEntry as jest.Mock).mockResolvedValue(88 as never);
    const { connection } = fakeConnection();

    await expect(
      resolveUserEntrantTeamId(connection, tournament({ participant_type: "SOLO" }), 3),
    ).resolves.toBe(88);
    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(ensureSoloEntry).not.toHaveBeenCalled();
  });

  it("renvoie null quand le joueur n'a rien à engager", async () => {
    (getUserActiveTeam as jest.Mock).mockResolvedValue(null as never);
    const { connection } = fakeConnection();
    await expect(resolveUserEntrantTeamId(connection, tournament(), 3)).resolves.toBeNull();
  });
});

describe("registerCurrentUserTeam", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadTournamentRow as jest.Mock).mockResolvedValue(tournament() as never);
    (syncTournamentState as jest.Mock).mockImplementation(
      async () => ({ row: await (loadTournamentRow as jest.Mock)() }) as never,
    );
  });

  it("inscrit l'équipe active du joueur en tournoi par équipes", async () => {
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 12 } as never);
    const { connection, inserts } = fakeConnection({ registered: 3 });

    await registerCurrentUserTeam(connection, 5, 3);

    expect(ensureSoloEntry).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    // Le seed suit le rang d'arrivée : 4ᵉ inscrit.
    expect(inserts[0][1]).toEqual([5, 12, 4]);
  });

  it("inscrit le joueur lui-même en tournoi individuel", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      tournament({ participant_type: "SOLO" }) as never,
    );
    (ensureSoloEntry as jest.Mock).mockResolvedValue(88 as never);
    const { connection, inserts } = fakeConnection();

    await registerCurrentUserTeam(connection, 5, 3);

    // Aucune équipe requise : c'est tout l'intérêt du mode individuel.
    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(ensureSoloEntry).toHaveBeenCalledWith(connection, 3);
    expect(inserts[0][1]).toEqual([5, 88, 1]);
  });

  it("refuse un joueur sans équipe en tournoi par équipes", async () => {
    (getUserActiveTeam as jest.Mock).mockResolvedValue(null as never);
    const { connection, inserts } = fakeConnection();

    await expect(registerCurrentUserTeam(connection, 5, 3)).rejects.toThrow("NO_ACTIVE_TEAM");
    expect(inserts).toHaveLength(0);
  });

  it("refuse un tournoi inexistant sans créer d'entrée solo", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(null as never);
    const { connection } = fakeConnection();

    await expect(registerCurrentUserTeam(connection, 5, 3)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(ensureSoloEntry).not.toHaveBeenCalled();
  });

  it("refuse une seconde inscription du même joueur", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      tournament({ participant_type: "SOLO" }) as never,
    );
    (ensureSoloEntry as jest.Mock).mockResolvedValue(88 as never);
    const { connection, inserts } = fakeConnection({ already: 1 });

    await expect(registerCurrentUserTeam(connection, 5, 3)).rejects.toThrow("ALREADY_REGISTERED");
    expect(inserts).toHaveLength(0);
  });

  it("refuse une inscription au-delà de la capacité", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      tournament({ participant_type: "SOLO", max_teams: 4 }) as never,
    );
    (ensureSoloEntry as jest.Mock).mockResolvedValue(88 as never);
    const { connection, inserts } = fakeConnection({ registered: 4 });

    await expect(registerCurrentUserTeam(connection, 5, 3)).rejects.toThrow("TOURNAMENT_FULL");
    expect(inserts).toHaveLength(0);
  });

  it("refuse une inscription hors période", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      tournament({ participant_type: "SOLO", state: "RUNNING" }) as never,
    );
    (ensureSoloEntry as jest.Mock).mockResolvedValue(88 as never);
    const { connection } = fakeConnection();

    await expect(registerCurrentUserTeam(connection, 5, 3)).rejects.toThrow("REGISTRATION_CLOSED");
  });
});

describe("canUserRegister", () => {
  beforeEach(() => jest.clearAllMocks());

  it("autorise un joueur sans entrée solo sur un tournoi individuel", async () => {
    // L'entrée sera créée à l'inscription : ne pas en avoir n'est pas un refus.
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      tournament({ participant_type: "SOLO" }) as never,
    );
    (findSoloEntry as jest.Mock).mockResolvedValue(null as never);
    const { connection } = fakeConnection();

    await expect(canUserRegister(connection, 5, 3)).resolves.toBe(true);
  });

  it("refuse un joueur sans équipe sur un tournoi par équipes", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(tournament() as never);
    (getUserActiveTeam as jest.Mock).mockResolvedValue(null as never);
    const { connection } = fakeConnection();

    await expect(canUserRegister(connection, 5, 3)).resolves.toBe(false);
  });

  it("refuse un joueur déjà inscrit", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      tournament({ participant_type: "SOLO" }) as never,
    );
    (findSoloEntry as jest.Mock).mockResolvedValue(88 as never);
    const { connection } = fakeConnection({ already: 1 });

    await expect(canUserRegister(connection, 5, 3)).resolves.toBe(false);
  });

  it("refuse quand les inscriptions sont fermées", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      tournament({ participant_type: "SOLO", state: "RUNNING" }) as never,
    );
    const { connection } = fakeConnection();

    await expect(canUserRegister(connection, 5, 3)).resolves.toBe(false);
    expect(findSoloEntry).not.toHaveBeenCalled();
  });
});
