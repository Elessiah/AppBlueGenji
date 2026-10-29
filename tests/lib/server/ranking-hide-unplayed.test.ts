import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/stored-upload-cleanup");
jest.mock("@/lib/server/ranking-cache", () => ({
  cachedRanking: jest.fn(),
  invalidateRankingLists: jest.fn(),
  invalidateTeamRanking: jest.fn(),
}));
jest.mock("@/lib/server/landing-cache", () => ({
  invalidateLandingAggregates: jest.fn(),
  invalidateLandingTeamViews: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { invalidateRankingLists, invalidateTeamRanking } from "@/lib/server/ranking-cache";
import { invalidateLandingAggregates, invalidateLandingTeamViews } from "@/lib/server/landing-cache";
import { softDeleteTeam } from "@/lib/server/teams/dissolution";
import { compareDirectoryRank, isRankedTeam } from "@/lib/shared/ranking";

/**
 * Lot RANKING-HIDE-UNPLAYED (demande du 2026-10-13) : une équipe sans match
 * compté disparaît du classement et de tout ce qui en descend, par **un seul
 * filtre** (`isRankedTeam`, posé dans `loadTeamRanking`). Ce fichier tient le
 * filtre, l'ordre de l'annuaire, le câblage de chaque consommateur sur le
 * chargeur unique et l'invalidation du cache des marches.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("isRankedTeam — le filtre unique", () => {
  it("écarte une équipe sans match", () => {
    expect(isRankedTeam({ wins: 0, losses: 0, draws: 0 })).toBe(false);
    expect(isRankedTeam({ wins: 0, losses: 0 })).toBe(false);
  });

  it("garde une équipe dès un match compté : victoire, défaite (forfait compris) ou nul", () => {
    expect(isRankedTeam({ wins: 1, losses: 0 })).toBe(true);
    expect(isRankedTeam({ wins: 0, losses: 1 })).toBe(true);
    expect(isRankedTeam({ wins: 0, losses: 0, draws: 1 })).toBe(true);
  });
});

describe("compareDirectoryRank — ordre par rang de l'annuaire", () => {
  it("range par rang croissant", () => {
    expect([{ rank: 3 }, { rank: 1 }, { rank: 2 }].sort(compareDirectoryRank)).toEqual([
      { rank: 1 },
      { rank: 2 },
      { rank: 3 },
    ]);
  });

  it("met les équipes sans rang à la fin, à égalité entre elles", () => {
    const sorted = [{ rank: null }, { rank: 2 }, { rank: null }, { rank: 1 }].sort(compareDirectoryRank);
    expect(sorted.map((team) => team.rank)).toEqual([1, 2, null, null]);
    expect(compareDirectoryRank({ rank: null }, { rank: null })).toBe(0);
  });
});

describe("chaque consommateur lit la liste filtrée", () => {
  // Plus aucune porte pour réintroduire les équipes sans match : l'option a
  // disparu, et chaque vue passe par `loadTeamRanking`.
  it("n'expose plus d'option pour inclure les équipes non jouées", () => {
    for (const path of [
      "lib/server/ranking-service.ts",
      "lib/server/landing-service.ts",
      "lib/server/podium-tiers.ts",
      "lib/server/share-podium.ts",
      "lib/server/share-team.ts",
      "lib/server/teams/directory.ts",
    ]) {
      expect(source(path)).not.toContain("includeUnplayed");
    }
  });

  it.each([
    ["le classement et l'API du leaderboard", "lib/server/landing-service.ts"],
    ["les marches du podium", "lib/server/podium-tiers.ts"],
    ["la carte d'aperçu du podium", "lib/server/share-podium.ts"],
    ["la carte nominative", "lib/server/share-team.ts"],
    ["les rangs de l'annuaire", "lib/server/teams/directory.ts"],
  ])("%s descend de loadTeamRanking", (_label, path) => {
    expect(source(path)).toMatch(/loadTeamRanking\(/);
  });

  it("la page /classement et l'API passent par la même entrée mutualisée (getLeaderboardRows)", () => {
    expect(source("app/classement/page.tsx")).toContain("getLeaderboardRows(game)");
    expect(source("app/api/landing/leaderboard/route.ts")).toContain("getLandingLeaderboard");
    expect(source("lib/server/landing-service.ts")).toMatch(/await getLeaderboardRows\(game\)/);
    expect(source("lib/server/landing-service.ts")).toMatch(/\(\) =>\s+loadLeaderboardRows\(game\)/);
  });

  it("le filtre est posé une fois, dans loadTeamRanking", () => {
    expect(source("lib/server/ranking-service.ts")).toContain("if (!isRankedTeam(state)) continue;");
  });
});

describe("softDeleteTeam — cache du classement et des marches", () => {
  let failing = false;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(deleteUnreferencedUpload).mockResolvedValue(true);
  });

  function mockDb() {
    const poolExecute = jest.fn<SqlQuery>()
      .mockResolvedValueOnce([[{ deleted_at: null }], []])
      .mockResolvedValueOnce([[{ roles_json: JSON.stringify(["OWNER"]) }], []]);
    const connectionExecute = jest.fn<SqlQuery>(async (sql: string) => {
      if (/SELECT logo_url, deleted_at, is_ghost FROM bg_teams/.test(sql)) {
        return [[{ logo_url: null, deleted_at: null, is_ghost: 0 }], []];
      }
      if (/SELECT roles_json/.test(sql)) return [[{ roles_json: JSON.stringify(["OWNER"]) }], []];
      if (/SELECT user_id FROM bg_team_members/.test(sql)) return [[{ user_id: 12 }, { user_id: 30 }], []];
      if (failing && /SET deleted_at/.test(sql)) throw new Error("ER_LOCK_DEADLOCK");
      return [{ affectedRows: 1 }, []];
    });
    const connection = {
      execute: connectionExecute,
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    jest.mocked(getDatabase).mockResolvedValue(
      fakePool({ execute: poolExecute, getConnection: jest.fn(async () => connection) }),
    );
    return connection;
  }

  it("oublie les marches, l'aperçu et le leaderboard après le commit, sans relancer le rejeu", async () => {
    failing = false;
    const connection = mockDb();

    await softDeleteTeam(1, 12);

    expect(invalidateRankingLists).toHaveBeenCalledTimes(1);
    expect(invalidateLandingTeamViews).toHaveBeenCalledTimes(1);
    expect(jest.mocked(invalidateRankingLists).mock.invocationCallOrder[0])
      .toBeGreaterThan(connection.commit.mock.invocationCallOrder[0]);
    // La dissolution ne change aucun match : le rejeu et le reste de l'accueil
    // (direct, ticker, compteurs) restent en cache.
    expect(invalidateTeamRanking).not.toHaveBeenCalled();
    expect(invalidateLandingAggregates).not.toHaveBeenCalled();
  });

  it("n'invalide rien quand la dissolution échoue", async () => {
    failing = true;
    mockDb();

    await expect(softDeleteTeam(1, 12)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(invalidateRankingLists).not.toHaveBeenCalled();
    expect(invalidateLandingTeamViews).not.toHaveBeenCalled();
  });
});
