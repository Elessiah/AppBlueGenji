import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/registration");

import { getDatabase } from "@/lib/server/database";
import { countVoiceChannel, ensureVoiceChannel, releaseVoiceChannel } from "@/lib/server/bot-integration";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import { maintainMatchLaunches } from "@/lib/server/tournaments/match-launch";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import {
  dispatchMatchVoiceChannels,
  resetVoiceSweepForTests,
  loadMatchVoiceInfos,
  maintainVoiceLaunches,
  setTeamVoiceChannels,
  voiceGateBlocksLaunch,
} from "@/lib/server/tournaments/match-voice";
import { type SqlQuery, connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

type Row = Record<string, unknown>;

/** Base simulée : lignes rendues selon la requête, écritures notées. */
function database(script: { due?: Row[]; voiceRows?: Row[]; voiceRowsAfterWrite?: Row[]; releasable?: Row[] }) {
  const writes: { sql: string; params: unknown }[] = [];
  const execute = jest.fn<SqlQuery>(async (sql, params) => {
    if (sql.includes("FROM bg_matches m") && sql.includes("team_voice_channels = 1")) return [script.due ?? [], []];
    if (sql.includes("FROM bg_match_voice_channels v") && sql.includes("LEFT JOIN")) return [script.releasable ?? [], []];
    if (sql.startsWith("SELECT") && sql.includes("FROM bg_match_voice_channels")) {
      const afterWrite = writes.length > 0 && script.voiceRowsAfterWrite;
      return [afterWrite || script.voiceRows || [], []];
    }
    writes.push({ sql, params });
    return [{ affectedRows: 1 }, []];
  });
  const release = jest.fn<() => void>();
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ getConnection: async () => fakeConnection({ execute, release }) }),
  );
  return { execute, writes, release };
}

const dueMatch = { id: 42, tournament_id: 7, team1_id: 1, team2_id: 2, team1_name: "Alpha", team2_name: "Beta" };

beforeEach(() => {
  jest.clearAllMocks();
  resetVoiceSweepForTests();
  jest.mocked(inTransaction).mockResolvedValue(0);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("dispatchMatchVoiceChannels — création et comptage", () => {
  it("dispatchMatchVoiceChannels_dueMatch_createsBothChannelsWithKeyAndTeamName", async () => {
    database({ due: [dueMatch] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "900" });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "ok", value: 0 });

    await dispatchMatchVoiceChannels();

    expect(jest.mocked(ensureVoiceChannel).mock.calls).toEqual([
      ["match:42:team:1", "Alpha"],
      ["match:42:team:2", "Beta"],
    ]);
  });

  it("dispatchMatchVoiceChannels_noDueMatch_callsNoBot", async () => {
    database({ due: [] });
    await dispatchMatchVoiceChannels();
    expect(ensureVoiceChannel).not.toHaveBeenCalled();
    expect(countVoiceChannel).not.toHaveBeenCalled();
  });

  it("dispatchMatchVoiceChannels_existingChannel_countsWithoutRecreating", async () => {
    const db = database({
      due: [dueMatch],
      voiceRows: [
        { match_id: 42, team_id: 1, channel_id: "901", members: 2, failed_at: null, released_at: null },
        { match_id: 42, team_id: 2, channel_id: "902", members: 2, failed_at: null, released_at: null },
      ],
    });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "ok", value: 5 });

    await dispatchMatchVoiceChannels();

    expect(ensureVoiceChannel).not.toHaveBeenCalled();
    expect(db.writes.filter((w) => w.sql.includes("SET members = ?")).map((w) => w.params)).toEqual([
      [5, 42, 1],
      [5, 42, 2],
    ]);
  });

  it("dispatchMatchVoiceChannels_ensureFails_marksFailedAndLogsWithoutNames", async () => {
    const db = database({ due: [dueMatch] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "VOICE_MISSING_PERMISSIONS" });

    await dispatchMatchVoiceChannels();

    expect(db.writes.filter((w) => w.sql.includes("failed_at"))).toHaveLength(2);
    const logged = jest.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(logged[0]).toBe("[match-voice] match 42 : bot indisponible (VOICE_MISSING_PERMISSIONS) — verrou du lancement levé");
    expect(logged.join(" ")).not.toContain("Alpha");
  });

  it("dispatchMatchVoiceChannels_ensureFailsOnReleasedRow_reopensRowAsFailed", async () => {
    const db = database({
      due: [dueMatch],
      voiceRows: [
        { match_id: 42, team_id: 1, channel_id: "901", members: 5, counted_at: null, failed_at: null, released_at: "2026-11-05T19:00:00.000Z" },
      ],
    });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "DISCORD_NOT_READY" });

    await dispatchMatchVoiceChannels();

    const failure = db.writes.find((w) => w.sql.includes("failed_at = NOW()"))?.sql ?? "";
    expect(failure).toMatch(/channel_id = IF\(released_at IS NULL, channel_id, NULL\)[\s\S]*failed_at = NOW\(\), released_at = NULL/);
  });

  it("dispatchMatchVoiceChannels_countGone_recreatesByKey", async () => {
    database({
      due: [dueMatch],
      voiceRows: [{ match_id: 42, team_id: 1, channel_id: "901", members: 1, failed_at: null, released_at: null }],
    });
    jest.mocked(countVoiceChannel)
      .mockResolvedValueOnce({ kind: "gone", code: "VOICE_CHANNEL_NOT_FOUND" })
      .mockResolvedValue({ kind: "ok", value: 1 });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "903" });

    await dispatchMatchVoiceChannels();

    expect(ensureVoiceChannel).toHaveBeenCalledWith("match:42:team:1", "Alpha");
  });

  it("dispatchMatchVoiceChannels_countGoneTwice_marksFailedAndLogs", async () => {
    const db = database({
      due: [dueMatch],
      voiceRows: [
        { match_id: 42, team_id: 1, channel_id: "901", members: 1, failed_at: null, released_at: null },
        { match_id: 42, team_id: 2, channel_id: "902", members: 1, failed_at: null, released_at: null },
      ],
    });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "gone", code: "VOICE_CHANNEL_NOT_FOUND" });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "903" });

    await dispatchMatchVoiceChannels();

    expect(db.writes.filter((w) => w.sql.includes("failed_at = NOW()"))).toHaveLength(2);
    expect(String(jest.mocked(console.warn).mock.calls[0]?.[0])).toContain("(VOICE_CHANNEL_NOT_FOUND)");
  });

  it("dispatchMatchVoiceChannels_dueQuery_servesLeastRecentlyCountedFirst", async () => {
    const db = database({ due: [] });

    await dispatchMatchVoiceChannels();

    const dueSql = db.execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("team_voice_channels = 1")) ?? "";
    expect(dueSql).toMatch(/ORDER BY COALESCE\(\s*\(SELECT MIN\(COALESCE\(v\.counted_at, v\.failed_at\)\)/);
  });

  it("dispatchMatchVoiceChannels_stateChanged_maintainsAndPublishesTournament", async () => {
    database({
      due: [dueMatch],
      voiceRowsAfterWrite: [{ match_id: 42, team_id: 1, channel_id: "900", members: 3, counted_at: new Date().toISOString(), failed_at: null, released_at: null }],
    });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "900" });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "ok", value: 3 });

    await dispatchMatchVoiceChannels();

    expect(inTransaction).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("dispatchMatchVoiceChannels_staleCountRecountedSame_maintainsAndPublishes", async () => {
    const stale = new Date(Date.now() - 6 * 60_000).toISOString();
    const fresh = new Date().toISOString();
    database({
      due: [dueMatch],
      voiceRows: [
        { match_id: 42, team_id: 1, channel_id: "901", members: 5, counted_at: stale, failed_at: null, released_at: null },
        { match_id: 42, team_id: 2, channel_id: "902", members: 5, counted_at: stale, failed_at: null, released_at: null },
      ],
      voiceRowsAfterWrite: [
        { match_id: 42, team_id: 1, channel_id: "901", members: 5, counted_at: fresh, failed_at: null, released_at: null },
      ],
    });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "ok", value: 5 });

    await dispatchMatchVoiceChannels();

    expect(inTransaction).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("dispatchMatchVoiceChannels_freshCountUnchanged_publishesNothing", async () => {
    const fresh = new Date().toISOString();
    const row = (teamId: number) => ({
      match_id: 42, team_id: teamId, channel_id: "900", members: 3, counted_at: fresh, failed_at: null, released_at: null,
    });
    database({ due: [dueMatch], voiceRows: [row(1), row(2)] });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "ok", value: 3 });

    await dispatchMatchVoiceChannels();

    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  // Revue juridique #546, cycle 5 : le nombre n'est montré à personne — seul
  // « plein ou non » publie.
  it("dispatchMatchVoiceChannels_freshRecountStaysBelowFull_publishesNothing", async () => {
    const fresh = new Date().toISOString();
    database({
      due: [dueMatch],
      voiceRows: [
        { match_id: 42, team_id: 1, channel_id: "900", members: 3, counted_at: fresh, failed_at: null, released_at: null },
        { match_id: 42, team_id: 2, channel_id: "900", members: 3, counted_at: fresh, failed_at: null, released_at: null },
      ],
      voiceRowsAfterWrite: [
        { match_id: 42, team_id: 1, channel_id: "900", members: 4, counted_at: fresh, failed_at: null, released_at: null },
        { match_id: 42, team_id: 2, channel_id: "900", members: 3, counted_at: fresh, failed_at: null, released_at: null },
      ],
    });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "ok", value: 4 });

    await dispatchMatchVoiceChannels();

    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("dispatchMatchVoiceChannels_freshRecountReachesFull_publishesTournament", async () => {
    const fresh = new Date().toISOString();
    database({
      due: [dueMatch],
      voiceRows: [
        { match_id: 42, team_id: 1, channel_id: "900", members: 4, counted_at: fresh, failed_at: null, released_at: null },
        { match_id: 42, team_id: 2, channel_id: "900", members: 4, counted_at: fresh, failed_at: null, released_at: null },
      ],
      voiceRowsAfterWrite: [
        { match_id: 42, team_id: 1, channel_id: "900", members: 5, counted_at: fresh, failed_at: null, released_at: null },
        { match_id: 42, team_id: 2, channel_id: "900", members: 4, counted_at: fresh, failed_at: null, released_at: null },
      ],
    });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "ok", value: 5 });

    await dispatchMatchVoiceChannels();

    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("dispatchMatchVoiceChannels_teamNameWithInvisibles_sendsVisibleText", async () => {
    database({ due: [{ ...dueMatch, team1_name: "Al\u200Bpha\u202E" }] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "900" });
    jest.mocked(countVoiceChannel).mockResolvedValue({ kind: "ok", value: 0 });

    await dispatchMatchVoiceChannels();

    expect(jest.mocked(ensureVoiceChannel).mock.calls[0]).toEqual(["match:42:team:1", "Alpha"]);
  });

  it("dispatchMatchVoiceChannels_calledTwiceWithinThrottle_runsOnce", async () => {
    const db = database({ due: [] });
    await dispatchMatchVoiceChannels();
    await dispatchMatchVoiceChannels();
    expect(db.execute.mock.calls.filter(([sql]) => sql.includes("team_voice_channels = 1"))).toHaveLength(1);
  });
});

describe("dispatchMatchVoiceChannels — libération", () => {
  it("dispatchMatchVoiceChannels_releasableChannel_releasesAndMarksReleased", async () => {
    const db = database({ releasable: [{ match_id: 42, team_id: 1, channel_id: "901", tournament_id: 7 }] });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "ok", value: true });

    await dispatchMatchVoiceChannels();

    expect(releaseVoiceChannel).toHaveBeenCalledWith("901");
    expect(db.writes.some((w) => w.sql.includes("SET released_at = NOW()"))).toBe(true);
  });

  it("dispatchMatchVoiceChannels_releaseNotTracked_marksReleased", async () => {
    const db = database({ releasable: [{ match_id: 42, team_id: 1, channel_id: "901", tournament_id: 7 }] });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });

    await dispatchMatchVoiceChannels();

    expect(db.writes.some((w) => w.sql.includes("SET released_at = NOW()"))).toBe(true);
  });

  it("dispatchMatchVoiceChannels_releaseFailed_keepsRowOpen", async () => {
    const db = database({ releasable: [{ match_id: 42, team_id: 1, channel_id: "901", tournament_id: 7 }] });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "failed", code: "DISCORD_NOT_READY" });

    await dispatchMatchVoiceChannels();

    expect(db.writes.some((w) => w.sql.includes("SET released_at = NOW()"))).toBe(false);
  });

  it("dispatchMatchVoiceChannels_releaseFailed_movesRowToBackOfQueue", async () => {
    const db = database({ releasable: [{ match_id: 42, team_id: 1, channel_id: "901", tournament_id: 7 }] });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "failed", code: "DISCORD_NOT_READY" });

    await dispatchMatchVoiceChannels();

    expect(db.writes.find((w) => w.sql.includes("SET failed_at = NOW()"))?.params).toEqual([42, 1]);
    const releasableSql = db.execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("LEFT JOIN")) ?? "";
    expect(releasableSql).toContain("ORDER BY v.failed_at IS NOT NULL, v.failed_at");
  });

  it("dispatchMatchVoiceChannels_releasableQuery_includesUnscheduledMatch", async () => {
    const db = database({});

    await dispatchMatchVoiceChannels();

    const releasableSql = db.execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("LEFT JOIN")) ?? "";
    expect(releasableSql).toContain("OR m.start_at IS NULL");
  });

  it("dispatchMatchVoiceChannels_rowWithoutChannel_closesWithoutBotCall", async () => {
    const db = database({ releasable: [{ match_id: 42, team_id: 1, channel_id: null, tournament_id: 7 }] });

    await dispatchMatchVoiceChannels();

    expect(releaseVoiceChannel).not.toHaveBeenCalled();
    expect(db.writes.some((w) => w.sql.includes("SET released_at = NOW()"))).toBe(true);
  });

  it("dispatchMatchVoiceChannels_everyPass_purgesOldReleasedRows", async () => {
    const db = database({});
    await dispatchMatchVoiceChannels();
    expect(db.writes.some((w) => w.sql.includes("DELETE FROM bg_match_voice_channels"))).toBe(true);
  });
});

describe("maintainVoiceLaunches", () => {
  function tournamentIn(state: string) {
    const connection = connectionMock();
    connection.execute.mockResolvedValue([[{ state }], []]);
    jest.mocked(inTransaction).mockImplementation(async (run) => run(fakeConnection(connection)));
  }

  it("maintainVoiceLaunches_runningTournament_maintainsLaunches", async () => {
    tournamentIn("RUNNING");
    await maintainVoiceLaunches(7);
    expect(jest.mocked(maintainMatchLaunches).mock.calls[0][1]).toBe(7);
  });

  it("maintainVoiceLaunches_finishedTournament_launchesNothing", async () => {
    tournamentIn("FINISHED");
    await maintainVoiceLaunches(7);
    expect(maintainMatchLaunches).not.toHaveBeenCalled();
  });
});

describe("setTeamVoiceChannels", () => {
  function connectionWith(tournament: Row | undefined) {
    const connection = connectionMock();
    connection.execute.mockImplementation(async (sql) => {
      if (sql.includes("FROM bg_tournaments WHERE id = ? LIMIT 1")) return [tournament ? [tournament] : [], []];
      return [{ affectedRows: 1 }, []];
    });
    jest.mocked(inTransaction).mockImplementation(async (run) => run(fakeConnection(connection)));
    database({});
    return connection;
  }

  it("setTeamVoiceChannels_unknownTournament_throwsNotFound", async () => {
    connectionWith(undefined);
    await expect(setTeamVoiceChannels(7, true)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("setTeamVoiceChannels_firstStatement_locksTournamentRow", async () => {
    const connection = connectionWith({ name: "Coupe", state: "RUNNING", team_voice_channels: 0 });
    jest.mocked(lockTournamentRow).mockImplementation(async () => {
      expect(connection.execute).not.toHaveBeenCalled();
    });
    await setTeamVoiceChannels(7, true);
    expect(jest.mocked(lockTournamentRow).mock.calls[0][1]).toBe(7);
  });

  it("setTeamVoiceChannels_sameValue_returnsUnchangedWithoutWrite", async () => {
    const connection = connectionWith({ name: "Coupe", state: "RUNNING", team_voice_channels: 1 });
    await expect(setTeamVoiceChannels(7, true)).resolves.toEqual({
      tournamentId: 7,
      tournamentName: "Coupe",
      enabled: true,
      changed: false,
    });
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setTeamVoiceChannels_turnOnMidTournament_writesAndPublishes", async () => {
    const connection = connectionWith({ name: "Coupe", state: "RUNNING", team_voice_channels: 0 });
    await expect(setTeamVoiceChannels(7, true)).resolves.toMatchObject({ enabled: true, changed: true });
    expect(connection.execute).toHaveBeenCalledWith("UPDATE bg_tournaments SET team_voice_channels = ? WHERE id = ?", [1, 7]);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
    expect(maintainMatchLaunches).not.toHaveBeenCalled();
  });

  it("setTeamVoiceChannels_turnOffRunning_maintainsLaunchesAtOnce", async () => {
    connectionWith({ name: "Coupe", state: "RUNNING", team_voice_channels: 1 });
    await setTeamVoiceChannels(7, false);
    expect(jest.mocked(maintainMatchLaunches).mock.calls[0][1]).toBe(7);
  });

  it("setTeamVoiceChannels_turnOffUpcoming_doesNotMaintainLaunches", async () => {
    connectionWith({ name: "Coupe", state: "UPCOMING", team_voice_channels: 1 });
    await expect(setTeamVoiceChannels(7, false)).resolves.toMatchObject({ enabled: false, changed: true });
    expect(maintainMatchLaunches).not.toHaveBeenCalled();
  });

  it("setTeamVoiceChannels_finishedTournament_throwsFinishedWithoutWrite", async () => {
    // Même règle que le formulaire (verrouillé) et la planification par l'arbitrage.
    const connection = connectionWith({ name: "Coupe", state: "FINISHED", team_voice_channels: 1 });
    await expect(setTeamVoiceChannels(7, false)).rejects.toThrow("TOURNAMENT_FINISHED");
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});

describe("voiceGateBlocksLaunch", () => {
  const match = {
    id: 42,
    tournament_id: 7,
    team1_id: 1,
    team2_id: 2,
    team1_is_ghost: 0,
    team2_is_ghost: 0,
    start_at: "2026-11-05T20:00:00.000Z",
  };

  it("voiceGateBlocksLaunch_optionOff_returnsFalseWithoutReadingChannels", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValue([[{ enabled: 0, team1_solo: 0, team2_solo: 0 }], []]);
    await expect(voiceGateBlocksLaunch(fakeConnection(connection), match)).resolves.toBe(false);
    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  const enabledContext = [[{ enabled: 1, team1_solo: 0, team2_solo: 0 }], []] as const;
  const voiceRow = (teamId: number, members: number, countedAt: string | null, failedAt: string | null = null) => ({
    match_id: 42,
    team_id: teamId,
    channel_id: `90${teamId}`,
    members,
    counted_at: countedAt,
    failed_at: failedAt,
    released_at: null,
  });
  const sixMinutesAgo = () => new Date(Date.now() - 6 * 60_000).toISOString();

  it("voiceGateBlocksLaunch_bothFullFreshCount_returnsFalse", async () => {
    const connection = connectionMock();
    const now = new Date().toISOString();
    connection.execute
      .mockResolvedValueOnce([...enabledContext])
      .mockResolvedValueOnce([[voiceRow(1, 5, now), voiceRow(2, 5, now)], []]);
    await expect(voiceGateBlocksLaunch(fakeConnection(connection), match)).resolves.toBe(false);
  });

  it("voiceGateBlocksLaunch_bothFullStaleCount_returnsTrue", async () => {
    const connection = connectionMock();
    connection.execute
      .mockResolvedValueOnce([...enabledContext])
      .mockResolvedValueOnce([[voiceRow(1, 5, sixMinutesAgo()), voiceRow(2, 5, sixMinutesAgo())], []]);
    await expect(voiceGateBlocksLaunch(fakeConnection(connection), match)).resolves.toBe(true);
  });

  it("voiceGateBlocksLaunch_staleFailure_returnsTrue", async () => {
    const connection = connectionMock();
    connection.execute
      .mockResolvedValueOnce([...enabledContext])
      .mockResolvedValueOnce([[voiceRow(1, 0, null, sixMinutesAgo()), voiceRow(2, 0, null)], []]);
    await expect(voiceGateBlocksLaunch(fakeConnection(connection), match)).resolves.toBe(true);
  });

  it("voiceGateBlocksLaunch_unscheduledMatch_returnsFalseWithoutQuery", async () => {
    const connection = connectionMock();
    await expect(voiceGateBlocksLaunch(fakeConnection(connection), { ...match, start_at: null })).resolves.toBe(false);
    expect(connection.execute).not.toHaveBeenCalled();
  });
});

describe("loadMatchVoiceInfos (instantané, les deux portes)", () => {
  const ready = { id: 42, status: "READY", team1Id: 1, team2Id: 2, startAt: "2026-01-01T20:00:00.000Z", launchedAt: null };
  const teams = [
    { id: 1, solo: 0, ghost: 0 },
    { id: 2, solo: 0, ghost: 0 },
  ];

  it("loadMatchVoiceInfos_optionOff_returnsEmptyWithoutQuery", async () => {
    const connection = connectionMock();
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, false, [ready]);
    expect(infos.size).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadMatchVoiceInfos_unlaunchedMatchWithRows_returnsStatesWithoutCounts", async () => {
    const connection = connectionMock();
    connection.execute
      .mockResolvedValueOnce([
        [
          { match_id: 42, team_id: 1, channel_id: "901", members: 3, counted_at: new Date().toISOString(), failed_at: null, released_at: null },
          { match_id: 42, team_id: 2, channel_id: "902", members: 5, counted_at: new Date().toISOString(), failed_at: null, released_at: null },
        ],
        [],
      ])
      .mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, true, [ready]);
    expect(infos.get(42)).toEqual({ team1State: "OPEN", team2State: "OPEN", pending: true });
  });

  it("loadMatchVoiceInfos_staleCount_showsOpenButPending", async () => {
    const connection = connectionMock();
    const stale = new Date(Date.now() - 6 * 60_000).toISOString();
    connection.execute
      .mockResolvedValueOnce([
        [
          { match_id: 42, team_id: 1, channel_id: "901", members: 5, counted_at: stale, failed_at: null, released_at: null },
          { match_id: 42, team_id: 2, channel_id: "902", members: 5, counted_at: stale, failed_at: null, released_at: null },
        ],
        [],
      ])
      .mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, true, [ready]);
    expect(infos.get(42)).toEqual({ team1State: "OPEN", team2State: "OPEN", pending: true });
  });

  it("loadMatchVoiceInfos_freshFailure_showsFailedAndReleasesGate", async () => {
    const connection = connectionMock();
    const now = new Date().toISOString();
    connection.execute
      .mockResolvedValueOnce([
        [
          { match_id: 42, team_id: 1, channel_id: null, members: null, counted_at: null, failed_at: now, released_at: null },
          { match_id: 42, team_id: 2, channel_id: "902", members: 2, counted_at: now, failed_at: null, released_at: null },
        ],
        [],
      ])
      .mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, true, [ready]);
    expect(infos.get(42)).toEqual({ team1State: "FAILED", team2State: "OPEN", pending: false });
  });

  it("loadMatchVoiceInfos_staleFailure_notShownAsFailed", async () => {
    // Un échec ancien a pu être réessayé : la page ne le dit plus, comme la porte de lancement.
    const connection = connectionMock();
    const stale = new Date(Date.now() - 6 * 60_000).toISOString();
    connection.execute
      .mockResolvedValueOnce([
        [{ match_id: 42, team_id: 1, channel_id: "901", members: null, counted_at: null, failed_at: stale, released_at: null }],
        [],
      ])
      .mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, true, [ready]);
    expect(infos.get(42)?.team1State).toBe("OPEN");
  });

  it("loadMatchVoiceInfos_dueMatchWithoutRows_showsPendingLikeTheGate", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, true, [ready]);
    expect(infos.get(42)).toEqual({ team1State: "WAITING", team2State: "WAITING", pending: true });
  });

  it("loadMatchVoiceInfos_soloSide_isNotShown", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ id: 1, solo: 1, ghost: 0 }, teams[1]], []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, true, [ready]);
    expect(infos.has(42)).toBe(false);
  });

  it("loadMatchVoiceInfos_matchNotYetDue_returnsEmptyWithoutQuery", async () => {
    const connection = connectionMock();
    const later = { ...ready, startAt: new Date(Date.now() + 3_600_000).toISOString() };
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, true, [later]);
    expect(infos.size).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadMatchVoiceInfos_launchedMatch_isNotShown", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValue([
      [{ match_id: 42, team_id: 1, channel_id: "901", members: 5, failed_at: null, released_at: null, solo: 0, ghost: 0 }],
      [],
    ]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), 7, true, [{ ...ready, launchedAt: "2026-11-05T20:01:00.000Z" }]);
    expect(infos.has(42)).toBe(false);
  });
});
