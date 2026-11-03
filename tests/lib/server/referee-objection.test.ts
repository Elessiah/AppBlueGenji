import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/cast-eligibility");

import { getDatabase } from "@/lib/server/database";
import { loadRefereePermission } from "@/lib/server/tournaments/cast-eligibility";
import { queueDeferredNoRefereeAlerts, releaseObjectingReferee } from "@/lib/server/tournaments/match-launch";
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
  jest.mocked(loadRefereePermission).mockResolvedValue(true);
});

describe("setRefereeObjection", () => {
  it("setRefereeObjection_newObjection_releasesEachUnfinishedMatch_returnsCount", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }, { id: 12 }], []]);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: true, released: 2, failed: 0 });
    expect(execute.mock.calls[0][0]).toContain("SET referee_objection_at = NOW()");
    expect(execute.mock.calls[1][0]).toContain("status <> 'COMPLETED'");
    expect(releaseObjectingReferee).toHaveBeenNthCalledWith(1, 11, REFEREE, expect.any(Array));
    expect(releaseObjectingReferee).toHaveBeenNthCalledWith(2, 12, REFEREE, expect.any(Array));
  });

  it("setRefereeObjection_sweep_signalsMatchesLeftWithoutRefereeOnceTogether", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }, { id: 12 }], []]);
    const candidate = { matchId: 11, pairing: "10:20", scheduled: false, phaseId: 0, bracket: "UPPER", roundNumber: 1 };
    jest.mocked(releaseObjectingReferee).mockImplementation(async (matchId, _refereeId, undecided) => {
      undecided?.push({ ...candidate, matchId });
      return true;
    });

    await setRefereeObjection(REFEREE, true);

    expect(queueDeferredNoRefereeAlerts).toHaveBeenCalledTimes(1);
    expect(queueDeferredNoRefereeAlerts).toHaveBeenCalledWith([candidate, { ...candidate, matchId: 12 }]);
  });

  it("setRefereeObjection_unfinishedMatchesUnreadable_countsFailure_doesNotThrow", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockRejectedValueOnce(new Error("connection lost"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: true, released: 0, failed: 1 });
    expect(releaseObjectingReferee).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_matchAlreadyFreed_notCounted", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }], []]);
    jest.mocked(releaseObjectingReferee).mockResolvedValueOnce(false);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: true, released: 0, failed: 0 });
  });

  it("setRefereeObjection_alreadyUpheld_changedFalse_sweepsAgain", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
      .mockResolvedValueOnce([[{ id: REFEREE }], []])
      .mockResolvedValueOnce([[{ id: 11 }], []]);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: false, released: 1, failed: 0 });
    expect(releaseObjectingReferee).toHaveBeenCalledWith(11, REFEREE, expect.any(Array));
  });

  it("setRefereeObjection_lift_clearsWithoutSweep", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await setRefereeObjection(REFEREE, false);

    expect(result).toEqual({ changed: true, released: 0, failed: 0 });
    expect(execute.mock.calls[0][0]).toContain("SET referee_objection_at = NULL");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(releaseObjectingReferee).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_unknownAccount_throwsUserNotFound", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]).mockResolvedValueOnce([[], []]);

    await expect(setRefereeObjection(REFEREE, true)).rejects.toThrow("USER_NOT_FOUND");
    expect(releaseObjectingReferee).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_oneMatchFails_othersReleased_countsFailure", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }, { id: 12 }], []]);
    jest.mocked(releaseObjectingReferee).mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: true, released: 1, failed: 1 });
    expect(releaseObjectingReferee).toHaveBeenCalledWith(12, REFEREE, expect.any(Array));
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("setRefereeObjection_upheldOnNonReferee_throwsNotReferee", async () => {
    jest.mocked(loadRefereePermission).mockResolvedValueOnce(false);

    await expect(setRefereeObjection(REFEREE, true)).rejects.toThrow("NOT_REFEREE");
    expect(execute).not.toHaveBeenCalled();
    expect(releaseObjectingReferee).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_upheldOnRefereeWithoutIdentity_stillUpholds", async () => {
    // Seule la permission est jugée : un arbitre sans Discord ni Battle.net la porte.
    jest.mocked(loadRefereePermission).mockResolvedValueOnce(true);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }], []]);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result).toEqual({ changed: true, released: 1, failed: 0 });
    expect(execute.mock.calls[0][0]).toContain("SET referee_objection_at = NOW()");
  });

  it("setRefereeObjection_liftOnNonReferee_skipsGuard", async () => {
    jest.mocked(loadRefereePermission).mockResolvedValue(false);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await setRefereeObjection(REFEREE, false);

    expect(result).toEqual({ changed: true, released: 0, failed: 0 });
    expect(loadRefereePermission).not.toHaveBeenCalled();
  });
});
