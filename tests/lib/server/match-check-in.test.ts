import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/registration");

import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { setMatchCheckIn } from "@/lib/server/tournaments/match-check-in";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

type Row = Record<string, unknown>;
const now = new Date("2026-11-13T21:00:00Z");

function connectionWith(tournament: Row | undefined) {
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql) => {
    if (sql.startsWith("SELECT state, match_check_in")) return [tournament ? [tournament] : [], []];
    return [{ affectedRows: 1 }, []];
  });
  jest.mocked(inTransaction).mockImplementation(async (run) => run(fakeConnection(connection)));
  return connection;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("setMatchCheckIn", () => {
  it("setMatchCheckIn_unknownTournament_throwsNotFound", async () => {
    connectionWith(undefined);
    await expect(setMatchCheckIn(7, false, now)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("setMatchCheckIn_finishedTournament_throwsFinished", async () => {
    connectionWith({ state: "FINISHED", match_check_in: 1 });
    await expect(setMatchCheckIn(7, false, now)).rejects.toThrow("TOURNAMENT_FINISHED");
  });

  it("setMatchCheckIn_firstStatement_locksTournamentRow", async () => {
    const connection = connectionWith({ state: "RUNNING", match_check_in: 1 });
    jest.mocked(lockTournamentRow).mockImplementation(async () => {
      expect(connection.execute).not.toHaveBeenCalled();
    });
    await setMatchCheckIn(7, false, now);
    expect(jest.mocked(lockTournamentRow).mock.calls[0][1]).toBe(7);
  });

  it("setMatchCheckIn_turnOffRunning_writesFlagOnlyAndPublishes", async () => {
    const connection = connectionWith({ state: "RUNNING", match_check_in: 1 });
    await expect(setMatchCheckIn(7, false, now)).resolves.toEqual({ tournamentId: 7, enabled: false, changed: true });
    expect(connection.execute).toHaveBeenCalledWith("UPDATE bg_tournaments SET match_check_in = 0 WHERE id = ?", [7]);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("setMatchCheckIn_turnOn_writesResumeInstant", async () => {
    const connection = connectionWith({ state: "RUNNING", match_check_in: 0 });
    await expect(setMatchCheckIn(7, true, now)).resolves.toMatchObject({ enabled: true, changed: true });
    expect(connection.execute).toHaveBeenCalledWith(
      "UPDATE bg_tournaments SET match_check_in = 1, match_check_in_resumed_at = ? WHERE id = ?",
      [now, 7],
    );
  });

  it("setMatchCheckIn_turnOn_silencesOpenedTenHourRemindersOfAnnouncedMatches", async () => {
    const connection = connectionWith({ state: "RUNNING", match_check_in: 0 });
    await setMatchCheckIn(7, true, now);
    const insert = connection.execute.mock.calls.find(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_match_reminders"));
    expect(insert).toBeDefined();
    const [sql, params] = insert as [string, unknown[]];
    // Seules les manches déjà annoncées (marque d'observation), à venir dans les 10 h, non jouées.
    expect(sql).toContain("JOIN bg_match_reminders seen ON seen.match_id = m.id AND seen.offset_key = ?");
    expect(sql).toContain("m.start_at > ? AND m.start_at <= ?");
    expect(sql).toContain("m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL");
    expect(sql).toContain("m.status NOT IN ('COMPLETED', 'AWAITING_CONFIRMATION')");
    expect(params).toEqual(["PT10H", "SEEN", 7, now, new Date("2026-11-14T07:00:00Z")]);
  });

  it("setMatchCheckIn_turnOff_reservesNoReminder", async () => {
    const connection = connectionWith({ state: "RUNNING", match_check_in: 1 });
    await setMatchCheckIn(7, false, now);
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("setMatchCheckIn_sameValue_unchangedWithoutWriteNorEvent", async () => {
    const connection = connectionWith({ state: "REGISTRATION", match_check_in: 1 });
    await expect(setMatchCheckIn(7, true, now)).resolves.toEqual({ tournamentId: 7, enabled: true, changed: false });
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE") || sql.startsWith("INSERT"))).toBe(false);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});
