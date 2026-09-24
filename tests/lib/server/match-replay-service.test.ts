import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import { setMatchReplayUrl } from "@/lib/server/tournaments/match-replay";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

const playedRow = {
  id: 42,
  tournament_id: 7,
  status: "COMPLETED",
  team1_id: 1,
  team2_id: 2,
  forfeit_team_id: null,
  double_forfeit: 0,
};

/** Lecture du match, puis `UPDATE` touchant `affectedRows` lignes. */
function found(row: Record<string, unknown> = playedRow, affectedRows = 1) {
  return jest
    .fn<SqlQuery>()
    .mockResolvedValueOnce([[row]])
    .mockResolvedValue([{ affectedRows }]);
}

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("setMatchReplayUrl", () => {
  it("enregistre un lien normalisé, borné aux matchs terminés, et réveille les pages", async () => {
    const execute = found();
    await mockDb(execute);

    expect(await setMatchReplayUrl(42, "youtu.be/dQw4w9WgXcQ")).toBe(
      "https://youtu.be/dQw4w9WgXcQ",
    );

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/SET replay_url = \? WHERE id = \? AND status = 'COMPLETED'/);
    expect(params).toEqual(["https://youtu.be/dQw4w9WgXcQ", 42]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it.each<[string | null]>([[null], [""], ["   "]])(
    "efface le lien sur %p, sans condition d'état",
    async (raw) => {
      const execute = found({ ...playedRow, status: "READY" });
      await mockDb(execute);

      expect(await setMatchReplayUrl(42, raw)).toBeNull();
      const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
      expect(sql).toMatch(/SET replay_url = NULL WHERE id = \?$/);
      expect(params).toEqual([42]);
      expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
    },
  );

  it("refuse un lien qui n'est pas une vidéo YouTube, sans lire la base", async () => {
    const execute = found();
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, "https://www.twitch.tv/bluegenji")).rejects.toThrow(
      "INVALID_REPLAY_URL",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("répond MATCH_NOT_FOUND sur un match inconnu", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, VIDEO)).rejects.toThrow("MATCH_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Record<string, unknown>]>([
    ["un match non terminé", { status: "READY" }],
    ["une exemption", { team2_id: null }],
    ["un forfait", { forfeit_team_id: 2 }],
    ["un double forfait", { double_forfeit: 1 }],
  ])("refuse de poser un lien sur %s", async (_label, overrides) => {
    const execute = found({ ...playedRow, ...overrides });
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, VIDEO)).rejects.toThrow("MATCH_NOT_REPLAYABLE");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse si le match a été rouvert entre la lecture et l'écriture", async () => {
    const execute = found(playedRow, 0);
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, VIDEO)).rejects.toThrow("MATCH_NOT_REPLAYABLE");
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });
});
