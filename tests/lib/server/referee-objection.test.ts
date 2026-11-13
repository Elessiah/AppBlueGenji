import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/cast-eligibility");
jest.mock("@/lib/server/tournaments/referee-notices");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/referee-names", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/referee-names")>("@/lib/server/tournaments/referee-names"),
  forgetRefereeNames: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { loadRefereePermission } from "@/lib/server/tournaments/cast-eligibility";
import { queueDeferredNoRefereeAlerts, releaseObjectingReferee } from "@/lib/server/tournaments/match-launch";
import { setRefereeObjection } from "@/lib/server/tournaments/referee-objection";
import { forgetRefereeNames } from "@/lib/server/tournaments/referee-names";
import { announceObjectionReleases } from "@/lib/server/tournaments/referee-notices";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
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
    expect(releaseObjectingReferee).toHaveBeenNthCalledWith(1, 11, REFEREE, expect.any(Array), expect.anything());
    expect(releaseObjectingReferee).toHaveBeenNthCalledWith(2, 12, REFEREE, expect.any(Array), expect.anything());
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
    expect(releaseObjectingReferee).toHaveBeenCalledWith(11, REFEREE, expect.any(Array), expect.anything());
  });

  it("setRefereeObjection_lift_clearsWithoutSweep", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await setRefereeObjection(REFEREE, false);

    expect(result).toEqual({ changed: true, released: 0, failed: 0 });
    expect(execute.mock.calls[0][0]).toContain("SET referee_objection_at = NULL");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(releaseObjectingReferee).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_newObjection_forgetsCachedRefereeNames", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[], []]);

    await setRefereeObjection(REFEREE, true);

    expect(forgetRefereeNames).toHaveBeenCalledTimes(1);
  });

  it("setRefereeObjection_alreadyUpheld_doesNotForgetNames", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, []])
      .mockResolvedValueOnce([[{ id: REFEREE }], []])
      .mockResolvedValueOnce([[], []]);

    await setRefereeObjection(REFEREE, true);

    expect(forgetRefereeNames).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_lift_doesNotForgetNames", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await setRefereeObjection(REFEREE, false);

    expect(forgetRefereeNames).not.toHaveBeenCalled();
  });

  it("setRefereeObjection_sweepUnreadable_namesStillForgotten", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockRejectedValueOnce(new Error("connection lost"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await setRefereeObjection(REFEREE, true);

    expect(result.failed).toBe(1);
    expect(forgetRefereeNames).toHaveBeenCalledTimes(1);
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
    expect(releaseObjectingReferee).toHaveBeenCalledWith(12, REFEREE, expect.any(Array), expect.anything());
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
  it("setRefereeObjection_liftOnUnknownAccount_returnsUnchanged", async () => {
    // Même réponse qu'un compte sans opposition : la levée ne sonde pas les identifiants.
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    const result = await setRefereeObjection(REFEREE, false);

    expect(result).toEqual({ changed: false, released: 0, failed: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("setRefereeObjection_oneMatchFails_logsWithoutMatchNumber", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 4711 }], []]);
    jest.mocked(releaseObjectingReferee).mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await setRefereeObjection(REFEREE, true);

    expect(String(consoleError.mock.calls[0][0])).not.toContain("4711");
    consoleError.mockRestore();
  });
});

describe("setRefereeObjection — annonces regroupées", () => {
  const tournamentOf: Record<number, number> = { 11: 7, 12: 7, 13: 8 };

  function releaseInto() {
    jest.mocked(releaseObjectingReferee).mockImplementation(async (matchId, _refereeId, _undecided, batch) => {
      batch?.tournamentIds.add(tournamentOf[matchId]);
      return true;
    });
  }

  it("setRefereeObjection_matchesAcrossTwoTournaments_publishesEachTournamentOnce", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }, { id: 12 }, { id: 13 }], []]);
    releaseInto();

    await setRefereeObjection(REFEREE, true);

    expect(publishMatchUpdatedEvent).toHaveBeenCalledTimes(2);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(8);
  });

  it("setRefereeObjection_releasedMatches_sendsOneRecapNotice", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }, { id: 12 }], []]);
    releaseInto();

    await setRefereeObjection(REFEREE, true);

    expect(announceObjectionReleases).toHaveBeenCalledTimes(1);
    expect(announceObjectionReleases).toHaveBeenCalledWith(REFEREE, 2, [7]);
  });

  it("setRefereeObjection_slowRecapPush_answersWithoutWaitingForIt", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }], []]);
    releaseInto();
    jest.mocked(announceObjectionReleases).mockReturnValueOnce(new Promise<void>(() => undefined));

    await expect(setRefereeObjection(REFEREE, true)).resolves.toBeDefined();

    expect(queueDeferredNoRefereeAlerts).toHaveBeenCalledTimes(1);
  });

  it("setRefereeObjection_nothingReleased_noPublish", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([[{ id: 11 }], []]);
    jest.mocked(releaseObjectingReferee).mockResolvedValueOnce(false);

    await setRefereeObjection(REFEREE, true);

    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(announceObjectionReleases).toHaveBeenCalledWith(REFEREE, 0, []);
  });
});
