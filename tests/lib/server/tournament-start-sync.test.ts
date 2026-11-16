import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/state", () => ({ syncTournamentState: jest.fn(), computeTournamentState: jest.fn() }));
jest.mock("@/lib/server/tournaments/bot-logs", () => ({ flushBotLogs: jest.fn(), discardBotLogs: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { computeTournamentState, syncTournamentState } from "@/lib/server/tournaments/state";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { startDueTournaments } from "@/lib/server/users/tournament-start-sync";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/*
 * EF-62 (revue performance, cycle 1) : le coup d'envoi tardif d'un tournoi se
 * donne avant la transaction de suppression, sous le seul verrou du tournoi.
 */

function setup(rows: unknown[] = [{ state: "REGISTRATION" }]) {
  const execute = jest.fn<SqlQuery>(async () => [rows]);
  const connection = connectionMock();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection: jest.fn(async () => connection) }));
  return { execute, connection };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(computeTournamentState).mockReturnValue("RUNNING");
  jest.mocked(syncTournamentState).mockResolvedValue({
    row: null,
    stateChanged: true,
    contentChanged: false,
    launchesChanged: false,
  });
});

describe("startDueTournaments", () => {
  it("startDueTournaments_stateUpToDate_noTransactionNoLock", async () => {
    jest.mocked(computeTournamentState).mockReturnValue("REGISTRATION");
    const { execute, connection } = setup();

    expect(await startDueTournaments([4])).toEqual([]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(lockTournamentRow).not.toHaveBeenCalled();
  });

  it("startDueTournaments_stateStale_locksSyncsCommitsAndPublishes", async () => {
    const { connection } = setup();

    expect(await startDueTournaments([4])).toEqual([4]);

    expect(lockTournamentRow).toHaveBeenCalledWith(fakeConnection(connection), 4);
    expect(syncTournamentState).toHaveBeenCalledWith(fakeConnection(connection), 4);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(flushBotLogs).toHaveBeenCalledWith(fakeConnection(connection));
    expect(publishUpdatedEvent).toHaveBeenCalledWith(4);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("startDueTournaments_syncLeavesStateUnchanged_notPublishedNotReturned", async () => {
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: null,
      stateChanged: false,
      contentChanged: false,
      launchesChanged: false,
    });
    setup();

    expect(await startDueTournaments([4])).toEqual([]);

    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("startDueTournaments_sameIdWithSharedSet_readsOnce", async () => {
    const { execute } = setup();
    const done = new Set<number>();

    await startDueTournaments([4], done);
    await startDueTournaments([4, 4], done);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(syncTournamentState).toHaveBeenCalledTimes(1);
  });

  it("startDueTournaments_syncThrows_rollsBackReleasesAndGoesOn", async () => {
    const { connection } = setup();
    jest.mocked(syncTournamentState).mockRejectedValueOnce(new Error("DEADLOCK"));

    const started = await startDueTournaments([4, 5]);

    expect(started).toEqual([5]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(discardBotLogs).toHaveBeenCalledTimes(2);
    expect(connection.release).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("startDueTournaments_flushThrows_stillPublishesAndReturnsId", async () => {
    setup();
    jest.mocked(flushBotLogs).mockImplementationOnce(() => {
      throw new Error("BOT_DOWN");
    });

    expect(await startDueTournaments([4])).toEqual([4]);

    expect(publishUpdatedEvent).toHaveBeenCalledWith(4);
  });

  it("startDueTournaments_unknownTournament_returnsEmpty", async () => {
    const { connection } = setup([]);

    expect(await startDueTournaments([9])).toEqual([]);

    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });
});
