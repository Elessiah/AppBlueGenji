import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { clearCache } from "@/lib/server/cache";
import { getDatabase } from "@/lib/server/database";
import { invalidateTeamRanking } from "@/lib/server/ranking-cache";
import { loadTeamRanking, type TeamRankingRow } from "@/lib/server/ranking-service";
import { teamLogoDataUrl } from "@/lib/server/share-podium";
import { TEAM_SHARE_LOGO_SIZE, findShareTeam, loadShareTeam } from "@/lib/server/share-team";
import { RANKING_MAX_SHOWN } from "@/lib/shared/ranking-page";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/ranking-service");
jest.mock("@/lib/server/share-podium");

/**
 * Données de la carte nominative d'une équipe (`/og/<langue>/team-<id>.png`) :
 * la ligne du classement public, rien d'autre — fantômes écartés, au-delà des
 * lignes affichables écartées, une seule lecture mutualisée pour toutes les
 * équipes.
 */

function row(teamId: number, overrides: Partial<TeamRankingRow> = {}): TeamRankingRow {
  return {
    teamId,
    teamName: `Test - ${teamId}`,
    logoUrl: null,
    wins: 3,
    losses: 1,
    draws: 0,
    points: 1000 - teamId,
    ...overrides,
  };
}

const execute = jest.fn<SqlQuery>();

beforeEach(() => {
  clearCache();
  execute.mockReset().mockResolvedValue([[{ id: 2 }]]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(loadTeamRanking).mockReset().mockResolvedValue([row(1, { logoUrl: "/api/uploads/teams/1.webp" }), row(2), row(3)]);
  jest.mocked(teamLogoDataUrl).mockReset().mockResolvedValue("data:image/png;base64,AAAA");
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("loadShareTeam", () => {
  it("rend la ligne du classement général : nom, cote, bilan, logo du site", async () => {
    const team = await loadShareTeam(1);
    expect(loadTeamRanking).toHaveBeenCalledWith({ includeUnplayed: true });
    expect(team).toEqual({
      teamName: "Test - 1",
      wins: 3,
      losses: 1,
      draws: 0,
      points: 999,
      logoSrc: "data:image/png;base64,AAAA",
    });
    expect(teamLogoDataUrl).toHaveBeenCalledWith("/api/uploads/teams/1.webp", TEAM_SHARE_LOGO_SIZE);
  });

  it("n'expose aucun champ hors du classement (ni identifiant, ni URL brute du logo)", async () => {
    const team = await loadShareTeam(1);
    expect(Object.keys(team!).sort((a, b) => a.localeCompare(b))).toEqual([
      "draws",
      "logoSrc",
      "losses",
      "points",
      "teamName",
      "wins",
    ]);
  });

  it("écarte une équipe fantôme", async () => {
    expect(await loadShareTeam(2)).toBeNull();
    expect(execute).toHaveBeenCalledWith("SELECT id FROM bg_teams WHERE is_ghost = 1");
  });

  it("rend null pour une équipe absente du classement (inconnue, solo, dissoute)", async () => {
    expect(await loadShareTeam(404)).toBeNull();
    expect(teamLogoDataUrl).not.toHaveBeenCalled();
  });

  it("s'arrête aux lignes que la page publique peut afficher", async () => {
    const ranking = Array.from({ length: RANKING_MAX_SHOWN + 1 }, (_, index) => row(index + 10));
    jest.mocked(loadTeamRanking).mockResolvedValue(ranking);
    expect(await loadShareTeam(10 + RANKING_MAX_SHOWN - 1)).not.toBeNull();
    expect(await loadShareTeam(10 + RANKING_MAX_SHOWN)).toBeNull();
  });

  it("lit le classement une fois pour toutes les équipes, jusqu'à son invalidation", async () => {
    await Promise.all([loadShareTeam(1), loadShareTeam(3), loadShareTeam(999)]);
    expect(loadTeamRanking).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    invalidateTeamRanking();
    await loadShareTeam(1);
    expect(loadTeamRanking).toHaveBeenCalledTimes(2);
  });

  it("retombe sur null (carte générique) si la base ne répond pas", async () => {
    jest.mocked(loadTeamRanking).mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await loadShareTeam(1)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("findShareTeam décide sans convertir le logo", async () => {
    expect(await findShareTeam(1)).toMatchObject({ teamName: "Test - 1", logoUrl: "/api/uploads/teams/1.webp" });
    expect(await findShareTeam(2)).toBeNull();
    expect(teamLogoDataUrl).not.toHaveBeenCalled();
  });

  it("garde l'initiale quand le logo est illisible", async () => {
    jest.mocked(teamLogoDataUrl).mockResolvedValue(null);
    expect(await loadShareTeam(1)).toMatchObject({ logoSrc: null });
  });
});
