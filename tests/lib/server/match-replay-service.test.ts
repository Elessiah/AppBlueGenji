import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import { setMatchReplayUrl } from "@/lib/server/tournaments/match-replay";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { type SqlQuery, type SqlMock, connectionMock, fakeConnection } from "../../helpers/sql-double";

/** Staff `tournaments` : toute rediff, sans lecture des casters. */
const STAFF = { userId: 5, manages: true };
/** Porteur de la seule `live`. */
const LIVE_ONLY_12 = { userId: 12, manages: false };

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** La transaction de la rediff : `execute` partagé, et la connexion rendue pour ses vérifications. */
async function mockDb(execute: SqlMock) {
  const { withConnection } = await import("@/lib/server/database");
  const connection = { ...connectionMock(), execute };
  connection.rollback.mockResolvedValue();
  connection.commit.mockResolvedValue();
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection(connection)));
  return connection;
}

const playedRow = {
  id: 42,
  tournament_id: 7,
  status: "COMPLETED",
  team1_id: 1,
  team2_id: 2,
  forfeit_team_id: null,
  double_forfeit: 0,
  launched_at: "2026-01-01 20:00:00",
  launch_pairing: "1:2",
};

/** Le jeu du tournoi, relu pour juger la condition du cast d'un porteur de la seule `live`. */
const GAME = [[{ game: "OW" }]];

/** Colonnes d'un caster qui remplit la condition du cast (admin, identités certifiées). */
const ELIGIBLE = {
  user_id: 12,
  discord_verified_at: new Date("2026-01-01T00:00:00Z"),
  discord_pseudo: "voix",
  blizzard_sub: "bnet",
  overwatch_battletag: "Voix#1234",
  overwatch_battletag_typed: 0,
  is_deleted: 0,
  is_admin: 1,
  platform_roles_json: null,
};

/**
 * Lecture du match, puis `UPDATE` qui trouve `affectedRows` lignes et en
 * modifie `changedRows` (MySQL / MariaDB : une valeur identique ne compte pas).
 */
function found(row: Record<string, unknown> = playedRow, affectedRows = 1, changedRows = affectedRows) {
  return jest
    .fn<SqlQuery>()
    .mockResolvedValueOnce([[row]])
    .mockResolvedValue([{ affectedRows, changedRows }]);
}

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("setMatchReplayUrl", () => {
  it("setMatchReplayUrl_notCaster_rollsBackWithoutWriting", async () => {
    const connection = await mockDb(
      jest.fn<SqlQuery>().mockResolvedValueOnce([[playedRow]]).mockResolvedValueOnce(GAME).mockResolvedValueOnce([[]]),
    );

    await expect(setMatchReplayUrl(42, VIDEO, LIVE_ONLY_12)).rejects.toThrow("NOT_MATCH_CASTER");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).toHaveBeenCalledTimes(3);
  });

  it("setMatchReplayUrl_success_locksMatchAndCommits", async () => {
    const connection = await mockDb(found());

    await setMatchReplayUrl(42, VIDEO, STAFF);

    // Le retrait d'un caster prend le même verrou : il ne passe plus entre contrôle et écriture.
    expect(connection.execute.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(connection.commit).toHaveBeenCalled();
  });

  it("setMatchReplayUrl_liveOnlyCasterOfMatch_writesLink", async () => {
    // Décision du 2026-11-09 : la seule `live` règle la rediff de **son** cast.
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[playedRow]])
      .mockResolvedValueOnce(GAME)
      .mockResolvedValueOnce([[ELIGIBLE]])
      .mockResolvedValue([{ affectedRows: 1, changedRows: 1 }]);
    await mockDb(execute);

    expect(await setMatchReplayUrl(42, VIDEO, LIVE_ONLY_12)).toEqual({ replayUrl: VIDEO, changed: true });
    expect(execute.mock.calls[1]).toEqual([expect.stringContaining("FROM bg_tournaments"), [7]]);
    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("FROM bg_match_casters"), [42, 12]]);
  });

  it("setMatchReplayUrl_mutedCasterOnReopenedMatch_throwsNotMatchCaster", async () => {
    // Match rouvert (avant lancement) : le caster tu (condition perdue) n'efface plus la rediff.
    const reopened = { ...playedRow, status: "READY", launched_at: null, launch_pairing: null };
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[reopened]])
      .mockResolvedValueOnce(GAME)
      .mockResolvedValueOnce([[{ ...ELIGIBLE, is_admin: 0 }]]);
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, null, LIVE_ONLY_12)).rejects.toThrow("NOT_MATCH_CASTER");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("setMatchReplayUrl_shownCasterOnReopenedMatch_clearsLink", async () => {
    const reopened = { ...playedRow, status: "READY", launched_at: null, launch_pairing: null };
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[reopened]])
      .mockResolvedValueOnce(GAME)
      .mockResolvedValueOnce([[ELIGIBLE]])
      .mockResolvedValue([{ affectedRows: 1, changedRows: 1 }]);
    await mockDb(execute);

    expect(await setMatchReplayUrl(42, null, LIVE_ONLY_12)).toEqual({ replayUrl: null, changed: true });
  });

  it("setMatchReplayUrl_liveOnlyNotCasterOfMatch_throwsNotMatchCaster", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[playedRow]]).mockResolvedValueOnce(GAME).mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, VIDEO, LIVE_ONLY_12)).rejects.toThrow("NOT_MATCH_CASTER");
    expect(execute).toHaveBeenCalledTimes(3);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setMatchReplayUrl_staff_skipsCasterRead", async () => {
    const execute = found();
    await mockDb(execute);

    await setMatchReplayUrl(42, VIDEO, STAFF);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("bg_match_casters"))).toBe(false);
  });

  it("enregistre un lien normalisé, borné aux matchs terminés, et réveille les pages", async () => {
    const execute = found();
    await mockDb(execute);

    expect(await setMatchReplayUrl(42, "youtu.be/dQw4w9WgXcQ", STAFF)).toEqual({
      replayUrl: "https://youtu.be/dQw4w9WgXcQ",
      changed: true,
    });

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

      expect(await setMatchReplayUrl(42, raw, STAFF)).toEqual({ replayUrl: null, changed: true });
      const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
      expect(sql).toMatch(/SET replay_url = NULL WHERE id = \?$/);
      expect(params).toEqual([42]);
      expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
    },
  );

  it("refuse un lien qui n'est pas une vidéo YouTube, sans lire la base", async () => {
    const execute = found();
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, "https://www.twitch.tv/bluegenji", STAFF)).rejects.toThrow(
      "INVALID_REPLAY_URL",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("répond MATCH_NOT_FOUND sur un match inconnu", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, VIDEO, STAFF)).rejects.toThrow("MATCH_NOT_FOUND");
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

    await expect(setMatchReplayUrl(42, VIDEO, STAFF)).rejects.toThrow("MATCH_NOT_REPLAYABLE");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse si le match a été rouvert entre la lecture et l'écriture", async () => {
    const execute = found(playedRow, 0);
    await mockDb(execute);

    await expect(setMatchReplayUrl(42, VIDEO, STAFF)).rejects.toThrow("MATCH_NOT_REPLAYABLE");
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });
});

describe("setMatchReplayUrl — changement", () => {
  it("setMatchReplayUrl_clearNeverSet_changedFalse", async () => {
    await mockDb(found(playedRow, 1, 0));
    expect(await setMatchReplayUrl(42, null, STAFF)).toEqual({ replayUrl: null, changed: false });
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setMatchReplayUrl_concurrentClear_secondChangedFalse", async () => {
    // Deux effacements simultanés : la ligne est trouvée, mais déjà vide au second.
    await mockDb(found(playedRow, 1, 0));
    expect((await setMatchReplayUrl(42, "", STAFF)).changed).toBe(false);
  });

  it("setMatchReplayUrl_sameUrl_changedFalse", async () => {
    await mockDb(found(playedRow, 1, 0));
    expect(await setMatchReplayUrl(42, "youtu.be/dQw4w9WgXcQ", STAFF)).toEqual({
      replayUrl: "https://youtu.be/dQw4w9WgXcQ",
      changed: false,
    });
  });
});
