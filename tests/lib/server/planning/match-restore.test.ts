import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { readMatchReferee, restoreMatchReferee, type MatchRefereeSnapshot } from "@/lib/server/planning/match-restore";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/** Remise en l'état de l'arbitrage d'un match après un geste du planning en échec (`CAST_PLANNING.md`). */

const connection = connectionMock();
const { execute } = connection;
const readyAt = new Date("2026-11-16T19:00:00Z");

function snapshot(overrides: Partial<MatchRefereeSnapshot> = {}): MatchRefereeSnapshot {
  return { matchId: 1, tournamentId: 10, refereeId: 7, refereeReadyAt: readyAt, selfManaged: false, status: "READY", ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(withConnection).mockImplementation(<T>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection(connection)));
});

describe("readMatchReferee", () => {
  it("readMatchReferee_existingMatch_returnsFullState", async () => {
    execute.mockResolvedValueOnce([
      [{ tournament_id: 10, referee_user_id: null, referee_ready_at: null, self_managed: 1, status: "PENDING" }],
      [],
    ]);

    const actual = await readMatchReferee(fakeConnection(connection), 1);

    expect(actual).toEqual({ matchId: 1, tournamentId: 10, refereeId: null, refereeReadyAt: null, selfManaged: true, status: "PENDING" });
  });

  it("readMatchReferee_missingMatch_returnsNull", async () => {
    execute.mockResolvedValueOnce([[], []]);

    await expect(readMatchReferee(fakeConnection(connection), 1)).resolves.toBeNull();
  });
});

describe("restoreMatchReferee", () => {
  it("restoreMatchReferee_sameRefereeAsWritten_noQueryReturnsTrue", async () => {
    await expect(restoreMatchReferee(snapshot({ refereeId: 3 }), 3)).resolves.toBe(true);

    expect(execute).not.toHaveBeenCalled();
  });

  it("restoreMatchReferee_casMatches_restoresFullStateAndPublishes", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const actual = await restoreMatchReferee(snapshot({ refereeId: null, refereeReadyAt: null, selfManaged: true }), 3);

    expect(actual).toBe(true);
    expect(execute.mock.calls[0][0]).toContain("referee_user_id <=> ?");
    expect(execute.mock.calls[0][1]).toEqual([null, null, 1, 1, 3, "READY"]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(10);
  });

  it("restoreMatchReferee_previousReadyAtKept_restoredAsIs", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await restoreMatchReferee(snapshot(), 3);

    expect(execute.mock.calls[0][1]).toEqual([7, readyAt, 0, 1, 3, "READY"]);
  });

  it("restoreMatchReferee_designationNeverCommitted_noLogReturnsTrue", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[{ tournament_id: 10, referee_user_id: 7, referee_ready_at: readyAt, self_managed: 0, status: "READY" }], []]);

    await expect(restoreMatchReferee(snapshot(), 3)).resolves.toBe(true);

    expect(console.error).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("restoreMatchReferee_matchMovedMeanwhile_loggedReturnsFalse", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[{ tournament_id: 10, referee_user_id: 8, referee_ready_at: null, self_managed: 0, status: "READY" }], []]);

    await expect(restoreMatchReferee(snapshot(), 3)).resolves.toBe(false);

    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("restoreMatchReferee_dbError_loggedNeverThrows", async () => {
    execute.mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));

    await expect(restoreMatchReferee(snapshot(), 3)).resolves.toBe(false);

    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
