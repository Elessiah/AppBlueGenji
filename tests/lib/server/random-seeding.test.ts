import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { drawRandomSeedingIfDue } from "@/lib/server/tournaments/random-seeding";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

const CLOSE = new Date("2026-05-10T10:00:00.000Z");
const AFTER_CLOSE = new Date(CLOSE.getTime() + 60_000);

type TournamentState = { state: string; random_seeding: number; random_seeding_drawn_at: Date | null };

function setup(tournament: TournamentState | null, options: { matches?: number; teams?: number[] } = {}) {
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM bg_tournaments WHERE id = ?")) {
      return [tournament ? [{ ...tournament, registration_close_at: CLOSE }] : []];
    }
    if (sql.includes("FROM bg_matches")) {
      return [Array.from({ length: options.matches ?? 0 }, (_, index) => ({ id: index + 1 }))];
    }
    if (sql.includes("FROM bg_tournament_registrations")) {
      return [(options.teams ?? [11, 12, 13]).map((teamId) => ({ team_id: teamId }))];
    }
    return [{ affectedRows: 1 }];
  });
  return connection;
}

const pending: TournamentState = { state: "UPCOMING", random_seeding: 1, random_seeding_drawn_at: null };

function seedWrites(connection: ReturnType<typeof connectionMock>) {
  return connection.execute.mock.calls
    .filter(([sql]) => sql.includes("SET seed = ?"))
    .map(([, params]) => params);
}

describe("drawRandomSeedingIfDue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("tire l'ordre, l'écrit de 1 à N et passe le tournoi en ordre manuel daté", async () => {
    const connection = setup(pending);
    // Toujours 0 : [11,12,13] → [12,13,11] (Fisher–Yates).
    const drawn = await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE, () => 0);

    expect(drawn).toBe(true);
    expect(seedWrites(connection)).toEqual([
      [1, 5, 12],
      [2, 5, 13],
      [3, 5, 11],
    ]);
    const flag = connection.execute.mock.calls.find(([sql]) => sql.includes("manual_seeding = 1"));
    expect(flag?.[1]).toEqual([AFTER_CLOSE, 5]);
  });

  it("verrouille le tournoi puis les inscriptions, en lecture verrouillante", async () => {
    const connection = setup(pending);
    await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE, () => 0);

    const sqls = connection.execute.mock.calls.map(([sql]) => sql);
    expect(sqls[0]).toMatch(/FROM bg_tournaments WHERE id = \? LIMIT 1 FOR UPDATE/);
    const registrations = sqls.find((sql) => sql.includes("FROM bg_tournament_registrations"));
    expect(registrations).toMatch(/FOR UPDATE/);
    // MariaDB : verrou d'une table seule, sans `FOR UPDATE OF` (CLAUDE.md).
    expect(sqls.join("\n")).not.toMatch(/FOR UPDATE OF/);
  });

  it("utilise par défaut un vrai aléa (crypto) et rend une permutation", async () => {
    const connection = setup(pending, { teams: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE)).toBe(true);
    const order = seedWrites(connection).map((params) => (params as number[])[2]);
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("ne tire rien avant la clôture", async () => {
    const connection = setup({ ...pending, state: "REGISTRATION" });
    expect(await drawRandomSeedingIfDue(fakeConnection(connection), 5, new Date(CLOSE.getTime() - 1), () => 0)).toBe(false);
    expect(seedWrites(connection)).toEqual([]);
  });

  it("ne tire pas deux fois", async () => {
    const connection = setup({ ...pending, random_seeding_drawn_at: new Date(CLOSE.getTime() + 1) });
    expect(await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE, () => 0)).toBe(false);
    expect(seedWrites(connection)).toEqual([]);
  });

  it("ne refait pas un tirage de la seconde de clôture, relu tronqué", async () => {
    const connection = setup({ ...pending, random_seeding_drawn_at: CLOSE });
    expect(await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE, () => 0)).toBe(false);
    expect(seedWrites(connection)).toEqual([]);
  });

  it("retire après une clôture repoussée au-delà du tirage", async () => {
    const connection = setup({ ...pending, random_seeding_drawn_at: new Date(CLOSE.getTime() - 86_400_000) });
    expect(await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE, () => 0)).toBe(true);
  });

  it("ne tire rien option éteinte, tournoi lancé ou inconnu", async () => {
    for (const row of [{ ...pending, random_seeding: 0 }, { ...pending, state: "RUNNING" }, null]) {
      const connection = setup(row);
      expect(await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE, () => 0)).toBe(false);
      expect(seedWrites(connection)).toEqual([]);
    }
  });

  it("ne réécrit jamais l'ordre d'un plateau déjà posé", async () => {
    const connection = setup(pending, { matches: 1 });
    expect(await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE, () => 0)).toBe(false);
    expect(seedWrites(connection)).toEqual([]);
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("manual_seeding = 1"))).toBe(false);
  });

  it("tire sur un tournoi sans inscrite sans écrire de seed, mais date le tirage", async () => {
    const connection = setup(pending, { teams: [] });
    expect(await drawRandomSeedingIfDue(fakeConnection(connection), 5, AFTER_CLOSE, () => 0)).toBe(true);
    expect(seedWrites(connection)).toEqual([]);
  });
});
