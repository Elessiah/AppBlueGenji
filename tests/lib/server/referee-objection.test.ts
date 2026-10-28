import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/match-launch");

import { getDatabase } from "@/lib/server/database";
import { releaseObjectingReferee } from "@/lib/server/tournaments/match-launch";
import { setRefereeObjection } from "@/lib/server/tournaments/referee-objection";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Opposition d'un arbitre retenue ou levée (`docs/features/MATCH_REFEREE.md`) :
 * l'écriture sur le compte, puis le retrait de chacun de ses matchs non terminés.
 */

const REFEREE = 960;

let execute: jest.Mock<SqlQuery>;

beforeEach(() => {
  jest.clearAllMocks();
  execute = jest.fn<SqlQuery>();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(releaseObjectingReferee).mockResolvedValue(true);
});

describe("setRefereeObjection", () => {
  it("setRefereeObjection_newObjection_releasesEachUnfinishedMatch_returnsCount", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }, { id: 12 }], []]);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: true, released: 2 });
    expect(execute.mock.calls[0][0]).toContain("SET referee_objection_at = NOW()");
    expect(execute.mock.calls[1][0]).toContain("status <> 'COMPLETED'");
    expect(releaseObjectingReferee).toHaveBeenNthCalledWith(1, 11, REFEREE);
    expect(releaseObjectingReferee).toHaveBeenNthCalledWith(2, 12, REFEREE);
  });

  it("setRefereeObjection_matchAlreadyFreed_notCounted", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }], []]);
    jest.mocked(releaseObjectingReferee).mockResolvedValueOnce(false);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: true, released: 0 });
  });

  it("setRefereeObjection_alreadyUpheld_changedFalse_sweepsAgain", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
      .mockResolvedValueOnce([[{ id: REFEREE }], []])
      .mockResolvedValueOnce([[{ id: 11 }], []]);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: false, released: 1 });
    expect(releaseObjectingReferee).toHaveBeenCalledWith(11, REFEREE);
  });

  it("setRefereeObjection_lift_clearsWithoutSweep", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await setRefereeObjection(REFEREE, false);

    expect(result).toEqual({ changed: true, released: 0 });
    expect(execute.mock.calls[0][0]).toContain("SET referee_objection_at = NULL");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(releaseObjectingReferee).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_unknownAccount_throwsUserNotFound", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]).mockResolvedValueOnce([[], []]);

    await expect(setRefereeObjection(REFEREE, true)).rejects.toThrow("USER_NOT_FOUND");
    expect(releaseObjectingReferee).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_oneMatchFails_othersReleasedThenThrows", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }, { id: 12 }], []]);
    jest.mocked(releaseObjectingReferee).mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));

    await expect(setRefereeObjection(REFEREE, true)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(releaseObjectingReferee).toHaveBeenCalledWith(12, REFEREE);
  });
});
