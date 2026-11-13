import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/lobby-brief", () => ({ silencePausedLobbyBriefs: jest.fn(async () => undefined) }));
jest.mock("@/lib/server/tournaments/match-reminders", () => ({ forgetCheckInReads: jest.fn() }));

import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { setMatchCheckIn } from "@/lib/server/tournaments/match-check-in";
import { silencePausedLobbyBriefs } from "@/lib/server/tournaments/lobby-brief";
import { forgetCheckInReads } from "@/lib/server/tournaments/match-reminders";
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

  it("setMatchCheckIn_turnOffRunning_stampsPauseInstantAndPublishes", async () => {
    const connection = connectionWith({ state: "RUNNING", match_check_in: 1, match_check_in_paused_at: null });
    await expect(setMatchCheckIn(7, false, now)).resolves.toEqual({ tournamentId: 7, enabled: false, changed: true });
    expect(connection.execute).toHaveBeenCalledWith(
      "UPDATE bg_tournaments SET match_check_in = 0, match_check_in_paused_at = ? WHERE id = ?",
      [now, 7],
    );
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("setMatchCheckIn_turnOn_setsFlagOnly", async () => {
    const connection = connectionWith({ state: "RUNNING", match_check_in: 0, match_check_in_paused_at: null });
    await expect(setMatchCheckIn(7, true, now)).resolves.toMatchObject({ enabled: true, changed: true });
    expect(connection.execute).toHaveBeenCalledWith("UPDATE bg_tournaments SET match_check_in = 1 WHERE id = ?", [7]);
  });

  it("setMatchCheckIn_turnOn_silencesBriefsDueSincePause", async () => {
    const pausedAt = new Date("2026-11-13T20:40:00Z");
    connectionWith({ state: "RUNNING", match_check_in: 0, match_check_in_paused_at: pausedAt });
    await setMatchCheckIn(7, true, now);
    const [, tournamentId, pause, at] = jest.mocked(silencePausedLobbyBriefs).mock.calls[0];
    expect([tournamentId, pause, at]).toEqual([7, pausedAt, now]);
  });

  it("setMatchCheckIn_turnOff_noBriefSilence", async () => {
    connectionWith({ state: "RUNNING", match_check_in: 1, match_check_in_paused_at: null });
    await setMatchCheckIn(7, false, now);
    expect(silencePausedLobbyBriefs).not.toHaveBeenCalled();
  });

  it("setMatchCheckIn_changed_forgetsCheckInReads", async () => {
    connectionWith({ state: "RUNNING", match_check_in: 1, match_check_in_paused_at: null });
    await setMatchCheckIn(7, false, now);
    expect(forgetCheckInReads).toHaveBeenCalledTimes(1);
  });

  it("setMatchCheckIn_unchanged_keepsCheckInReads", async () => {
    connectionWith({ state: "RUNNING", match_check_in: 1, match_check_in_paused_at: null });
    await setMatchCheckIn(7, true, now);
    expect(forgetCheckInReads).not.toHaveBeenCalled();
  });

  it("setMatchCheckIn_turnOnAfterPause_silencesOnlyWindowsOpenedSincePause", async () => {
    const pausedAt = new Date("2026-11-13T19:00:00Z");
    const connection = connectionWith({ state: "RUNNING", match_check_in: 0, match_check_in_paused_at: pausedAt });
    await setMatchCheckIn(7, true, now);
    const insert = connection.execute.mock.calls.find(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_match_reminders"));
    const [sql, params] = insert as [string, unknown[]];
    // Manches déjà annoncées, coup d'envoi dans les 10 h et au moins 10 h après l'arrêt.
    expect(sql).toContain("JOIN bg_match_reminders seen ON seen.match_id = m.id AND seen.offset_key = ?");
    expect(sql).toContain("m.start_at > ? AND m.start_at <= ? AND m.start_at >= ?");
    // Ni statut ni engagées : une manche rendue jouable ensuite reste tue.
    expect(sql).not.toContain("m.status");
    expect(sql).not.toContain("team1_id");
    expect(params).toEqual(["PT10H", "SEEN", 7, now, new Date("2026-11-14T07:00:00Z"), new Date("2026-11-14T05:00:00Z")]);
  });

  it("setMatchCheckIn_turnOnNeverPaused_silencesEveryOpenedWindow", async () => {
    const connection = connectionWith({ state: "RUNNING", match_check_in: 0, match_check_in_paused_at: null });
    await setMatchCheckIn(7, true, now);
    const insert = connection.execute.mock.calls.find(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_match_reminders"));
    // Créé sans check-in : tout l'avant compte pour l'arrêt, la borne basse est maintenant.
    expect((insert as [string, unknown[]])[1][5]).toEqual(now);
  });

  it("setMatchCheckIn_deadlockOnce_replaysAndSucceeds", async () => {
    connectionWith({ state: "RUNNING", match_check_in: 0, match_check_in_paused_at: null });
    const deadlock = Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    const runOnce = jest.mocked(inTransaction).getMockImplementation()!;
    jest.mocked(inTransaction).mockRejectedValueOnce(deadlock).mockImplementation(runOnce);
    await expect(setMatchCheckIn(7, true, now)).resolves.toMatchObject({ enabled: true, changed: true });
    expect(inTransaction).toHaveBeenCalledTimes(2);
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
