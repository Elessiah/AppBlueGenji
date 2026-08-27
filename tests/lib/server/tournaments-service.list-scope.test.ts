import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";

jest.mock("@/lib/server/database");

type ExecuteMock = jest.Mock;

/**
 * Pose une base factice. La requête de liste passe par le pool (`db.execute`),
 * la remise à niveau des états par une connexion : deux mocks distincts pour
 * pouvoir lire la première sans être noyé dans la seconde.
 */
async function mockDb(execute: ExecuteMock) {
  const { getDatabase } = await import("@/lib/server/database");
  const connectionExecute: ExecuteMock = jest.fn().mockResolvedValue([[], undefined]);
  const connection = {
    execute: connectionExecute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  (getDatabase as jest.Mock).mockResolvedValue({
    execute,
    getConnection: jest.fn(async () => connection),
  });
  return connectionExecute;
}

function listQuery(execute: ExecuteMock): [string, unknown[]] {
  const call = execute.mock.calls.find(([sql]) => String(sql).includes("FROM bg_tournaments"));
  if (!call) throw new Error("aucune requête de liste");
  return call as [string, unknown[]];
}

describe("listTournamentBuckets — portée", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("ne montre par défaut que les tournois déjà visibles", async () => {
    const execute: ExecuteMock = jest.fn().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets(null);

    const [sql, params] = listQuery(execute);
    expect(sql).toMatch(/WHERE t\.start_visibility_at <= \?/);
    expect(sql).not.toMatch(/organizer_user_id = \?/);
    expect(params).toHaveLength(1);
    expect(params[0]).toBeInstanceOf(Date);
  });

  it("restreint à l'organisateur et lève le filtre de visibilité", async () => {
    const execute: ExecuteMock = jest.fn().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets(null, { organizerUserId: 321 });

    const [sql, params] = listQuery(execute);
    expect(sql).toMatch(/WHERE t\.organizer_user_id = \?/);
    // C'est tout l'intérêt de l'onglet : voir ce que personne d'autre ne voit.
    expect(sql).not.toMatch(/start_visibility_at <= \?/);
    expect(params).toEqual([321]);
  });

  it("garde la recherche par nom dans la portée organisateur", async () => {
    const execute: ExecuteMock = jest.fn().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets("  Marvel  ", { organizerUserId: 7 });

    const [sql, params] = listQuery(execute);
    expect(sql).toMatch(/t\.organizer_user_id = \? AND LOWER\(t\.name\) LIKE \?/);
    expect(params).toEqual([7, "%marvel%"]);
  });

  it("accepte l'organisateur 0 sans retomber sur la vue publique", async () => {
    const execute: ExecuteMock = jest.fn().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets(null, { organizerUserId: 0 });

    const [sql, params] = listQuery(execute);
    expect(sql).toMatch(/WHERE t\.organizer_user_id = \?/);
    expect(params).toEqual([0]);
  });

  it("range les tournois de l'organisateur dans le panier de leur état", async () => {
    const row = (id: number, state: string) => ({
      id,
      name: `Tournoi ${id}`,
      description: null,
      format: "SINGLE",
      game: "OW2",
      max_teams: 8,
      state,
      start_visibility_at: "2030-01-01T00:00:00Z",
      registration_open_at: "2030-01-02T00:00:00Z",
      registration_close_at: "2030-01-03T00:00:00Z",
      start_at: "2030-01-04T00:00:00Z",
      bracket_size: null,
      created_at: "2026-01-01T00:00:00Z",
      organizer_user_id: 321,
      finished_at: null,
      has_third_place_match: 0,
      survival_rounds_before_first_cut: null,
      survival_rounds_per_cut: null,
      survival_current_round: null,
      participant_type: "TEAM",
      match_format_type: null,
      match_format_value: null,
      registered_teams: 0,
    });

    const execute: ExecuteMock = jest.fn(async (sql: unknown) =>
      String(sql).includes("FROM bg_tournaments")
        ? [[row(1, "UPCOMING"), row(2, "RUNNING")], undefined]
        : [[], undefined],
    );
    await mockDb(execute);

    const buckets = await listTournamentBuckets(null, { organizerUserId: 321 });

    expect(buckets.upcoming.map((t) => t.id)).toEqual([1]);
    expect(buckets.running.map((t) => t.id)).toEqual([2]);
    expect(buckets.registration).toEqual([]);
    expect(buckets.finished).toEqual([]);
    // Un tournoi encore masqué garde sa date de visibilité : c'est elle qui
    // permet à l'interface de le ranger dans « pas encore visibles ».
    expect(buckets.upcoming[0].startVisibilityAt).toContain("2030-01-01");
  });
});
