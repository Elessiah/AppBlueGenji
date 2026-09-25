import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import { clearCache } from "@/lib/server/cache";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { tournamentListRow } from "../../helpers/tournament-rows";

jest.mock("@/lib/server/database");

/**
 * La liste porte le résumé de chaque carte (vainqueur, déroulement), et ne
 * dépend jamais de lui : une panne de ces lectures décoratives laisse la liste
 * entière, cartes à `null`.
 */

const past = new Date(Date.now() - 86_400_000);
const LIST_ROWS = [
  tournamentListRow({
    id: 1,
    state: "FINISHED",
    start_visibility_at: past,
    finished_at: new Date("2026-09-01T20:00:00.000Z"),
  }),
  tournamentListRow({ id: 2, state: "RUNNING", format: "SINGLE", start_visibility_at: past }),
  tournamentListRow({ id: 3, state: "REGISTRATION", start_visibility_at: past }),
];

async function mockDb(execute: jest.Mock<SqlQuery>) {
  const { getDatabase } = await import("@/lib/server/database");
  const connection = {
    execute: jest.fn<SqlQuery>().mockResolvedValue([[], undefined]),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ execute, getConnection: jest.fn(async () => connection) }),
  );
}

/** Répond à la requête de liste, puis selon la table interrogée. */
function listing(summaryRows: (sql: string) => unknown[] | Error) {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (sql.includes("COUNT(r.id)")) return [LIST_ROWS, undefined];
    const rows = summaryRows(sql);
    if (rows instanceof Error) throw rows;
    return [rows, undefined];
  });
}

beforeEach(() => {
  clearCache();
  jest.clearAllMocks();
});
afterEach(() => {
  clearCache();
  jest.restoreAllMocks();
});

describe("listTournamentBuckets — résumé des cartes", () => {
  it("joint vainqueur, date de clôture et déroulement aux cartes", async () => {
    await mockDb(
      listing((sql) => {
        if (sql.includes("final_rank = 1")) {
          return [{ tournament_id: 1, team_id: 9, team_name: "Alpha", final_rank: 1 }];
        }
        if (sql.includes("swiss_total_rounds, swiss_current_round")) {
          return [{ id: 2, swiss_total_rounds: null, swiss_current_round: 0, current_phase_id: null }];
        }
        if (sql.includes("FROM bg_matches")) {
          return [{ tournament_id: 2, phase_id: 0, round_number: 1, total: 4, completed: "1" }];
        }
        return [];
      }),
    );

    const buckets = await listTournamentBuckets(null);

    expect(buckets.finished[0]).toMatchObject({
      id: 1,
      finishedAt: "2026-09-01T20:00:00.000Z",
      champion: { teamId: 9, name: "Alpha" },
      runningProgress: null,
    });
    expect(buckets.running[0]).toMatchObject({ id: 2, champion: null, runningProgress: 0.25 });
    expect(buckets.registration[0]).toMatchObject({
      id: 3,
      finishedAt: null,
      champion: null,
      runningProgress: null,
    });
  });

  it("sert la liste entière quand le résumé est en panne", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await mockDb(listing(() => new Error("table absente")));

    const buckets = await listTournamentBuckets(null);

    expect(buckets.finished.map((c) => c.id)).toEqual([1]);
    expect(buckets.running.map((c) => c.id)).toEqual([2]);
    expect(buckets.finished[0].champion).toBeNull();
    expect(buckets.running[0].runningProgress).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "[tournaments] résumé des cartes indisponible :",
      expect.any(Error),
    );
  });
});
