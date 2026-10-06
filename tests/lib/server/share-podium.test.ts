import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { clearCache } from "@/lib/server/cache";
import { loadTeamRanking, type TeamRankingRow } from "@/lib/server/ranking-service";
import { loadSharePodium, teamLogoDataUrl } from "@/lib/server/share-podium";

jest.mock("@/lib/server/ranking-service");
jest.mock("node:fs/promises", () => ({ readFile: jest.fn() }));

/**
 * Données du podium de la carte de `/classement` : le classement général
 * (même chargeur que la page), trois lignes, logos lus sur le disque et
 * convertis en PNG — le tout mutualisé dans le cache du classement.
 */

function rankingRow(teamId: number, logoUrl: string | null = null): TeamRankingRow {
  return { teamId, teamName: `Test - ${teamId}`, logoUrl, wins: 1, losses: 0, draws: 0, points: 1000 - teamId };
}

let webp: Buffer;

beforeEach(async () => {
  clearCache();
  jest.mocked(loadTeamRanking).mockReset();
  jest.mocked(readFile).mockReset();
  webp = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 90, g: 200, b: 255, alpha: 1 } } })
    .webp()
    .toBuffer();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("teamLogoDataUrl", () => {
  it("convertit un logo stocké par le site (WebP) en PNG carré", async () => {
    jest.mocked(readFile).mockResolvedValue(webp);
    const url = await teamLogoDataUrl("/api/uploads/teams/7-abc.webp");
    expect(url).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from(url!.split(",")[1], "base64");
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 152, 152]);
    const [path] = jest.mocked(readFile).mock.calls[0];
    expect(String(path).replaceAll("\\", "/")).toMatch(/public\/uploads\/teams\/7-abc\.webp$/);
  });

  it.each([
    ["absent", null],
    ["hors du site", "https://example.com/logo.png"],
    ["d'un autre dossier", "/api/uploads/avatars/1.webp"],
    ["traversée", "/api/uploads/teams/../../.env"],
  ])("ignore un logo %s sans lire le disque", async (_label, url) => {
    expect(await teamLogoDataUrl(url)).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rend null pour un fichier manquant ou illisible", async () => {
    jest.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error("absent"), { code: "ENOENT" }));
    expect(await teamLogoDataUrl("/api/uploads/teams/missing.webp")).toBeNull();
    jest.mocked(readFile).mockResolvedValueOnce(Buffer.from("pas une image"));
    expect(await teamLogoDataUrl("/api/uploads/teams/broken.webp")).toBeNull();
  });
});

describe("loadSharePodium", () => {
  it("lit le classement général et garde les trois premières, logos compris", async () => {
    jest.mocked(readFile).mockResolvedValue(webp);
    jest.mocked(loadTeamRanking).mockResolvedValue([
      rankingRow(1, "/api/uploads/teams/1.webp"),
      rankingRow(2),
      rankingRow(3),
      rankingRow(4),
    ]);
    const podium = await loadSharePodium();
    expect(loadTeamRanking).toHaveBeenCalledWith({ includeUnplayed: true });
    expect(podium.map((row) => [row.teamName, row.points])).toEqual([
      ["Test - 1", 999],
      ["Test - 2", 998],
      ["Test - 3", 997],
    ]);
    expect(podium[0].logoSrc).toMatch(/^data:image\/png/);
    expect(podium[1].logoSrc).toBeNull();
  });

  it("mutualise les robots d'aperçu dans le cache du classement", async () => {
    jest.mocked(loadTeamRanking).mockResolvedValue([rankingRow(1), rankingRow(2), rankingRow(3)]);
    await Promise.all([loadSharePodium(), loadSharePodium(), loadSharePodium()]);
    await loadSharePodium();
    expect(loadTeamRanking).toHaveBeenCalledTimes(1);
  });

  it("rend une liste vide sous trois équipes", async () => {
    jest.mocked(loadTeamRanking).mockResolvedValue([rankingRow(1), rankingRow(2)]);
    expect(await loadSharePodium()).toEqual([]);
  });

  it("rend une liste vide si la base ne répond pas, sans lever", async () => {
    jest.mocked(loadTeamRanking).mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await loadSharePodium()).toEqual([]);
  });
});
