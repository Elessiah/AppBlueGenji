import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { loadPodiumTiers } from "@/lib/server/podium-tiers";
import { loadTeamRanking, type TeamRankingRow } from "@/lib/server/ranking-service";
import { clearCache } from "@/lib/server/cache";
import { invalidateTeamRanking } from "@/lib/server/ranking-cache";
import { EMPTY_PODIUM_TIERS } from "@/lib/shared/podium-tiers";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/ranking-service");

/**
 * Chargeur des marches du podium : le classement « Général » (même chargeur que
 * `/classement`), puis **une** requête — les membres actifs des trois premières —
 * le tout mutualisé dans le cache du classement.
 */

function rankingRow(teamId: number): TeamRankingRow {
  return { teamId, teamName: `Test - ${teamId}`, logoUrl: null, wins: 1, losses: 0, draws: 0, points: 1000 - teamId };
}

async function mockMembers(rows: { user_id: number; team_id: number }[]) {
  const execute = jest.fn<SqlQuery>(async () => [rows]);
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

beforeEach(() => {
  clearCache();
  jest.mocked(loadTeamRanking).mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("loadPodiumTiers", () => {
  it("lit le classement général (équipes non jouées comprises) et les membres actifs des trois premières en une requête", async () => {
    jest.mocked(loadTeamRanking).mockResolvedValue([rankingRow(7), rankingRow(8), rankingRow(9), rankingRow(10)]);
    const execute = await mockMembers([
      { user_id: 1, team_id: 7 },
      { user_id: 2, team_id: 9 },
      { user_id: 1, team_id: 9 },
    ]);

    const tiers = await loadPodiumTiers();

    expect(loadTeamRanking).toHaveBeenCalledWith({ includeUnplayed: true });
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/FROM bg_team_members/);
    expect(sql).toMatch(/left_at IS NULL/);
    expect(sql).toMatch(/u\.is_deleted = 0/);
    expect(sql).toMatch(/team_id IN \(\?, \?, \?\)/);
    expect(params).toEqual([7, 8, 9]);
    expect(tiers.teams).toEqual({ 7: 1, 8: 2, 9: 3 });
    expect(tiers.members).toEqual({ 1: 1, 2: 3 });
  });

  it("sert la même photo tant que le classement n'est pas invalidé, puis relit après un score", async () => {
    jest.mocked(loadTeamRanking).mockResolvedValue([rankingRow(1), rankingRow(2), rankingRow(3)]);
    const execute = await mockMembers([]);

    await loadPodiumTiers();
    await loadPodiumTiers();
    expect(loadTeamRanking).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);

    invalidateTeamRanking();
    await loadPodiumTiers();
    expect(loadTeamRanking).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("sous trois équipes, ne pose aucune marche et ne lit aucun membre", async () => {
    jest.mocked(loadTeamRanking).mockResolvedValue([rankingRow(1), rankingRow(2)]);
    const execute = await mockMembers([]);
    expect(await loadPodiumTiers()).toBe(EMPTY_PODIUM_TIERS);
    expect(execute).not.toHaveBeenCalled();
  });

  it("ne lève jamais : une panne rend un site sans marche plutôt qu'une page tombée", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadTeamRanking).mockRejectedValue(new Error("db down"));
    expect(await loadPodiumTiers()).toBe(EMPTY_PODIUM_TIERS);
  });
});
