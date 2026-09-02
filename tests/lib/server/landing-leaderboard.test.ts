import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getLandingLeaderboard } from "@/lib/server/landing-service";
import { clearCache } from "@/lib/server/cache";
import { rankingPoints } from "@/lib/shared/ranking";

jest.mock("@/lib/server/database");

/**
 * Le leaderboard de la landing affichait des points calculés par sa propre
 * requête : défaites lues sur `loser_team_id` (que le moteur ne renseigne pas
 * toujours) et byes comptés comme des victoires. Une équipe pouvait donc y
 * figurer avec un total que sa fiche démentait.
 *
 * Il lit désormais `loadTeamRanking`, comme l'annuaire et comme les fiches.
 */

type Row = { team_id: number; team_name: string; logo_url: string | null; wins: number; losses: number };

function row(teamId: number, name: string, wins: number, losses: number): Row {
  return { team_id: teamId, team_name: name, logo_url: null, wins, losses };
}

/**
 * Le classement courant et celui d'il y a une semaine passent par la **même**
 * requête ; on les distingue par la présence d'une borne de date.
 */
async function mockDb(current: Row[], previous: Row[] = current) {
  const execute = jest.fn(async (sql: unknown, params: unknown) => {
    const bounded = Array.isArray(params) && params.length > 0;
    void sql;
    return [bounded ? previous : current];
  });
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
  return execute;
}

describe("leaderboard de la landing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clearCache();
  });

  it("applique le barème partagé, sans le recalculer", async () => {
    await mockDb([row(1, "Alpha", 4, 1), row(2, "Bravo", 1, 0)]);

    const rows = await getLandingLeaderboard(8);

    expect(rows[0]).toMatchObject({
      rank: 1,
      teamId: 1,
      teamName: "Alpha",
      wins: 4,
      losses: 1,
      points: rankingPoints(4, 1),
    });
    expect(rows[1].points).toBe(rankingPoints(1, 0));
  });

  it("garde les équipes sans match, à zéro point", async () => {
    await mockDb([row(1, "Alpha", 1, 0), row(2, "Bravo", 0, 0)]);

    const rows = await getLandingLeaderboard(8);

    expect(rows.map((r) => [r.teamName, r.points])).toEqual([
      ["Alpha", rankingPoints(1, 0)],
      ["Bravo", 0],
    ]);
  });

  it("borne le classement de référence à une semaine, sur l'horloge de la base", async () => {
    const execute = await mockDb([row(1, "Alpha", 2, 0)]);

    await getLandingLeaderboard(8);

    const bounded = execute.mock.calls.find(
      (call) => Array.isArray(call[1]) && (call[1] as unknown[]).length > 0,
    );
    expect(bounded).toBeDefined();
    expect(String(bounded![0])).toContain("DATE_SUB(NOW(), INTERVAL ? DAY)");
    expect(bounded![1]).toEqual([7]);
  });

  it("compare la tendance à deux photos du même calcul", async () => {
    // Il y a une semaine, Bravo menait ; Alpha est passée devant depuis.
    await mockDb([row(1, "Alpha", 5, 0), row(2, "Bravo", 3, 0)], [row(2, "Bravo", 3, 0), row(1, "Alpha", 1, 0)]);

    const rows = await getLandingLeaderboard(8);

    expect(rows[0]).toMatchObject({ teamName: "Alpha", trend: "up", trendValue: 1 });
    expect(rows[1]).toMatchObject({ teamName: "Bravo", trend: "down", trendValue: 1 });
  });

  it("borne le nombre de lignes rendues", async () => {
    await mockDb([row(1, "Alpha", 5, 0), row(2, "Bravo", 3, 0), row(3, "Charlie", 1, 0)]);

    expect(await getLandingLeaderboard(2)).toHaveLength(2);
  });

  it("rend une liste vide plutôt que de casser la page si la base tombe", async () => {
    const { getDatabase } = await import("@/lib/server/database");
    (getDatabase as jest.Mock).mockRejectedValue(new Error("db down"));

    expect(await getLandingLeaderboard(8)).toEqual([]);
  });
});
