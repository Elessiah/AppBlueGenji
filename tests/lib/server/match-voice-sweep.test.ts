import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/registration");

import { getDatabase, withConnection } from "@/lib/server/database";
import { ensureVoiceChannel, releaseVoiceChannel } from "@/lib/server/bot-integration";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import { maintainMatchLaunches } from "@/lib/server/tournaments/match-launch";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import {
  DUE_CHANNELS_SQL,
  OPEN_DUE_CHANNELS_SQL,
  RELEASABLE_SQL,
  VOICE_FALLBACK_CHANNEL_NAME,
  dispatchMatchVoiceChannels,
  loadMatchVoiceInfos,
  readMatchVoice,
  resetVoiceSweepForTests,
  setTeamVoiceChannels,
} from "@/lib/server/tournaments/match-voice";
import { VOICE_CHANNEL_LATE_HOURS, VOICE_RETRY_SECONDS } from "@/lib/shared/match-voice";
import { type SqlQuery, connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

type Row = Record<string, unknown>;

/**
 * Base simulée **sur le pool** (le balayage ne prend jamais de connexion) :
 * lignes rendues selon la requête, écritures notées.
 */
function database(script: {
  needed?: Row;
  due?: Row[];
  voiceRows?: Row[];
  releasable?: Row[];
  openDue?: Row[];
  /** Lignes changées par le remplacement d'un salon revérifié (1 par défaut). */
  replaced?: number;
  /** Réponse au contrôle « ligne encore ouverte ? » qui suit un remplacement sans effet. */
  stillOpen?: Row[];
}) {
  const writes: { sql: string; params: unknown }[] = [];
  const execute = jest.fn<SqlQuery>(async (sql, params) => {
    if (sql.includes("AS open_rows")) return [[script.needed ?? { due: 1, open_rows: 1 }], []];
    if (sql === DUE_CHANNELS_SQL) return [script.due ?? [], []];
    if (sql === RELEASABLE_SQL) return [script.releasable ?? [], []];
    if (sql === OPEN_DUE_CHANNELS_SQL) return [script.openDue ?? [], []];
    if (sql.startsWith("SELECT 1 FROM bg_match_voice_channels")) return [script.stillOpen ?? [], []];
    if (sql.startsWith("SELECT") && sql.includes("FROM bg_match_voice_channels")) return [script.voiceRows ?? [], []];
    writes.push({ sql, params });
    if (sql.includes("SET channel_id = ?, failed_at = NULL")) return [{ affectedRows: script.replaced ?? 1 }, []];
    return [{ affectedRows: 1 }, []];
  });
  const getConnection = jest.fn<() => Promise<never>>();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection }));
  return { execute, writes, getConnection };
}

const dueMatch = { id: 42, tournament_id: 7, team1_id: 1, team2_id: 2, team1_name: "Alpha", team2_name: "Beta" };
const openRow = (teamId: number, channelId: string) => ({
  match_id: 42,
  team_id: teamId,
  channel_id: channelId,
  failed_at: null,
  released_at: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetVoiceSweepForTests();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("dispatchMatchVoiceChannels — création", () => {
  it("dispatchMatchVoiceChannels_nothingDueNorOpen_stopsAfterExistenceCheck", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 0 } });
    await dispatchMatchVoiceChannels();
    expect(execute.mock.calls.some(([sql]) => sql === DUE_CHANNELS_SQL || sql === RELEASABLE_SQL)).toBe(false);
    expect(ensureVoiceChannel).not.toHaveBeenCalled();
  });

  it("dispatchMatchVoiceChannels_dueMatch_createsBothChannelsAndPublishes", async () => {
    const { writes } = database({ due: [dueMatch] });
    jest.mocked(ensureVoiceChannel).mockResolvedValueOnce({ kind: "ok", value: "901" }).mockResolvedValueOnce({ kind: "ok", value: "902" });
    await dispatchMatchVoiceChannels();
    expect(jest.mocked(ensureVoiceChannel).mock.calls).toEqual([
      ["match:42:team:1", "Alpha"],
      ["match:42:team:2", "Beta"],
    ]);
    expect(writes.filter((w) => w.sql.startsWith("INSERT")).map((w) => w.params)).toEqual([
      [42, 1, "901"],
      [42, 2, "902"],
    ]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("dispatchMatchVoiceChannels_channelAlreadyOpen_asksBotOnlyForMissingSide", async () => {
    database({ due: [dueMatch], voiceRows: [openRow(1, "901")] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "902" });
    await dispatchMatchVoiceChannels();
    expect(jest.mocked(ensureVoiceChannel).mock.calls).toEqual([["match:42:team:2", "Beta"]]);
  });

  it("dispatchMatchVoiceChannels_invalidName_retriesWithFallbackName", async () => {
    database({ due: [dueMatch] });
    jest
      .mocked(ensureVoiceChannel)
      .mockResolvedValueOnce({ kind: "ok", value: "901" })
      .mockResolvedValueOnce({ kind: "failed", code: "INVALID_VOICE_CHANNEL_NAME" })
      .mockResolvedValueOnce({ kind: "ok", value: "902" });
    await dispatchMatchVoiceChannels();
    expect(jest.mocked(ensureVoiceChannel).mock.calls[2]).toEqual(["match:42:team:2", VOICE_FALLBACK_CHANNEL_NAME]);
  });

  it("dispatchMatchVoiceChannels_ensureFails_marksFailedLogsWithoutNamesAndPublishes", async () => {
    const { writes } = database({ due: [dueMatch] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" });
    await dispatchMatchVoiceChannels();
    expect(writes.filter((w) => w.sql.includes("failed_at = NOW(), released_at = NULL"))).toHaveLength(1);
    const logged = jest.mocked(console.warn).mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain("BOT_INTERNAL_UNREACHABLE");
    expect(logged).not.toMatch(/Alpha|Beta/);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("dispatchMatchVoiceChannels_botTransportDownOnCreate_stopsRemainingCalls", async () => {
    database({ due: [dueMatch, { ...dueMatch, id: 43 }] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_VOICE_TIMEOUT" });
    await dispatchMatchVoiceChannels();
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it("dispatchMatchVoiceChannels_botDownOnCreate_skipsRecheckButStillReleases", async () => {
    const { execute } = database({ due: [dueMatch], openDue: [{ match_id: 9, team_id: 1, channel_id: "5", tournament_id: 7, team_name: "Gamma" }] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_VOICE_TIMEOUT" });
    await dispatchMatchVoiceChannels();
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.some(([sql]) => sql === OPEN_DUE_CHANNELS_SQL)).toBe(false);
    expect(execute.mock.calls.some(([sql]) => sql === RELEASABLE_SQL)).toBe(true);
  });

  it("dispatchMatchVoiceChannels_botDownOnRecheck_stillReleases", async () => {
    const { execute } = database({ openDue: [{ match_id: 9, team_id: 1, channel_id: "5", tournament_id: 7, team_name: "Gamma" }] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" });
    await dispatchMatchVoiceChannels();
    expect(execute.mock.calls.some(([sql]) => sql === RELEASABLE_SQL)).toBe(true);
  });

  it("dispatchMatchVoiceChannels_botRefusesOneChannel_triesTheOtherSideAndMatches", async () => {
    const { writes } = database({ due: [dueMatch, { ...dueMatch, id: 43 }] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "VOICE_PERMISSION_DENIED" });
    await dispatchMatchVoiceChannels();
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(4);
    expect(writes.filter((w) => w.sql.includes("failed_at = NOW(), released_at = NULL"))).toHaveLength(4);
  });

  it("dispatchMatchVoiceChannels_dueQuery_asksMatchesWithAFailedSideAfterTheOthers", () => {
    expect(DUE_CHANNELS_SQL).toMatch(/ORDER BY EXISTS \(SELECT 1 FROM bg_match_voice_channels f[\s\S]*f\.failed_at IS NOT NULL\), m\.start_at, m\.id/);
  });

  it("dispatchMatchVoiceChannels_ensureFailsAgain_neitherLogsNorPublishes", async () => {
    const failed = (teamId: number) => ({ ...openRow(teamId, "x"), channel_id: null, failed_at: new Date() });
    database({ due: [dueMatch], voiceRows: [failed(1), failed(2)] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" });
    await dispatchMatchVoiceChannels();
    expect(console.warn).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("dispatchMatchVoiceChannels_ensureFailsOnReleasedRow_reopensRowWithoutChannel", async () => {
    const released = { ...openRow(1, "901"), released_at: new Date() };
    const { writes } = database({ due: [dueMatch], voiceRows: [released] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "VOICE_PERMISSION_DENIED" });
    await dispatchMatchVoiceChannels();
    const reopen = writes.find((w) => w.sql.includes("ON DUPLICATE KEY") && w.sql.includes("failed_at = NOW()"));
    expect(reopen?.sql).toContain("channel_id = IF(released_at IS NULL, channel_id, NULL)");
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("dispatchMatchVoiceChannels_dueQuery_boundsLatenessRetriesAndSkipsOpenChannels", () => {
    expect(DUE_CHANNELS_SQL).toContain(`m.start_at >= NOW() - INTERVAL ${VOICE_CHANNEL_LATE_HOURS} HOUR`);
    expect(DUE_CHANNELS_SQL).toContain(`v.failed_at > NOW() - INTERVAL ${VOICE_RETRY_SECONDS} SECOND`);
    expect(DUE_CHANNELS_SQL).toContain("v.channel_id IS NOT NULL");
    expect(DUE_CHANNELS_SQL).not.toContain("counted_at");
  });

  it("dispatchMatchVoiceChannels_anyPass_neverHoldsAPoolConnection", async () => {
    const { getConnection } = database({
      due: [dueMatch],
      releasable: [{ match_id: 9, team_id: 3, channel_id: "903", tournament_id: 7 }],
    });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "901" });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "ok", value: true });
    await dispatchMatchVoiceChannels();
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("dispatchMatchVoiceChannels_teamNameWithInvisibles_sendsVisibleText", async () => {
    database({ due: [{ ...dueMatch, team1_name: "Al​pha" }] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "901" });
    await dispatchMatchVoiceChannels();
    expect(jest.mocked(ensureVoiceChannel).mock.calls[0][1]).toBe("Alpha");
  });
});

describe("dispatchMatchVoiceChannels — libération et purge", () => {
  const releasable = { match_id: 42, team_id: 1, channel_id: "901", tournament_id: 7 };

  it("dispatchMatchVoiceChannels_releasableChannel_releasesAndMarksReleased", async () => {
    const { writes } = database({ releasable: [releasable] });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "ok", value: true });
    await dispatchMatchVoiceChannels();
    expect(releaseVoiceChannel).toHaveBeenCalledWith("901");
    expect(writes.some((w) => w.sql.includes("SET released_at = NOW()"))).toBe(true);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("dispatchMatchVoiceChannels_firstReleaseFailed_stopsLoopAndMarksOnlyThatRow", async () => {
    const { writes } = database({
      releasable: [
        { match_id: 42, team_id: 1, channel_id: "901", tournament_id: 7 },
        { match_id: 43, team_id: 1, channel_id: "902", tournament_id: 7 },
      ],
    });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_VOICE_TIMEOUT" });
    await dispatchMatchVoiceChannels();
    expect(releaseVoiceChannel).toHaveBeenCalledTimes(1);
    expect(writes.filter((w) => w.sql.includes("SET failed_at = NOW()"))).toHaveLength(1);
  });

  it("dispatchMatchVoiceChannels_releaseRefusedByBot_continuesWithNextRow", async () => {
    const { writes } = database({
      releasable: [
        { match_id: 42, team_id: 1, channel_id: "901", tournament_id: 7 },
        { match_id: 43, team_id: 1, channel_id: "902", tournament_id: 7 },
      ],
    });
    jest
      .mocked(releaseVoiceChannel)
      .mockResolvedValueOnce({ kind: "failed", code: "VOICE_DISCORD_REFUSED" })
      .mockResolvedValue({ kind: "ok", value: true });
    await dispatchMatchVoiceChannels();
    expect(releaseVoiceChannel).toHaveBeenCalledTimes(2);
    expect(writes.filter((w) => w.sql.includes("SET failed_at = NOW()"))).toHaveLength(1);
    expect(writes.filter((w) => w.sql.includes("SET released_at = NOW()")).map((w) => w.params)).toEqual([[43, 1]]);
  });

  it("dispatchMatchVoiceChannels_releaseNotTracked_marksReleased", async () => {
    const { writes } = database({ releasable: [releasable] });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });
    await dispatchMatchVoiceChannels();
    expect(writes.some((w) => w.sql.includes("SET released_at = NOW()"))).toBe(true);
  });

  it("dispatchMatchVoiceChannels_releaseFailed_keepsRowOpenWithFailedAt", async () => {
    const { writes } = database({ releasable: [releasable] });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_VOICE_TIMEOUT" });
    await dispatchMatchVoiceChannels();
    expect(writes.some((w) => w.sql.includes("SET released_at = NOW()"))).toBe(false);
    expect(writes.some((w) => w.sql.includes("SET failed_at = NOW()"))).toBe(true);
  });

  it("dispatchMatchVoiceChannels_rowWithoutChannel_closesWithoutBotCall", async () => {
    const { writes } = database({ releasable: [{ ...releasable, channel_id: null }] });
    await dispatchMatchVoiceChannels();
    expect(releaseVoiceChannel).not.toHaveBeenCalled();
    expect(writes.some((w) => w.sql.includes("SET released_at = NOW()"))).toBe(true);
  });

  it("dispatchMatchVoiceChannels_releasableQuery_backsOffFailuresAndReleasesSoloOrGhostMatches", () => {
    expect(RELEASABLE_SQL).toContain(`v.failed_at <= NOW() - INTERVAL ${VOICE_RETRY_SECONDS} SECOND`);
    expect(RELEASABLE_SQL).toContain("x.solo_user_id IS NOT NULL OR COALESCE(x.is_ghost, 0) = 1");
    expect(RELEASABLE_SQL).toContain("m.start_at IS NULL");
  });

  it("dispatchMatchVoiceChannels_releasableQuery_releasesMatchesPastTheLateWindow", () => {
    expect(RELEASABLE_SQL).toContain(`m.start_at < NOW() - INTERVAL ${VOICE_CHANNEL_LATE_HOURS} HOUR`);
  });

  it("dispatchMatchVoiceChannels_purgeFails_retriedAtNextPass", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 0 } });
    const deletes = () => execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE")).length;
    execute.mockImplementationOnce(async () => [[{ due: 0, open_rows: 0 }], []]).mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));
    await dispatchMatchVoiceChannels();
    await dispatchMatchVoiceChannels(true);
    expect(deletes()).toBe(2);
  });

  it("dispatchMatchVoiceChannels_purgeBacklogLargerThanABatch_deletesUntilCaughtUp", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 0 } });
    const deletes = () => execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE")).length;
    execute
      .mockImplementationOnce(async () => [[{ due: 0, open_rows: 0 }], []])
      .mockImplementationOnce(async () => [{ affectedRows: 200 }, []])
      .mockImplementationOnce(async () => [{ affectedRows: 200 }, []])
      .mockImplementationOnce(async () => [{ affectedRows: 3 }, []]);
    await dispatchMatchVoiceChannels();
    expect(deletes()).toBe(3);
  });

  it("dispatchMatchVoiceChannels_purgeBacklogBeyondTheCap_continuesAfterShortPause", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 0 } });
    const deletes = () => execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE")).length;
    execute.mockImplementation(async (sql) =>
      sql.includes("AS open_rows") ? [[{ due: 0, open_rows: 0 }], []] : [{ affectedRows: 200 }, []],
    );
    const start = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(start);
    await dispatchMatchVoiceChannels();
    expect(deletes()).toBe(10);
    clock.mockReturnValue(start + 10_000);
    await dispatchMatchVoiceChannels(true);
    expect(deletes()).toBe(10);
    clock.mockReturnValue(start + 61_000);
    await dispatchMatchVoiceChannels(true);
    expect(deletes()).toBe(20);
  });

  it("dispatchMatchVoiceChannels_touchedAndPurge_publishesBeforePurging", async () => {
    const { execute } = database({ due: [dueMatch] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "901" });
    await dispatchMatchVoiceChannels();
    const publishedAt = jest.mocked(publishMatchUpdatedEvent).mock.invocationCallOrder[0]!;
    const purgeAt = execute.mock.invocationCallOrder[execute.mock.calls.findIndex(([sql]) => sql.startsWith("DELETE"))]!;
    expect(publishedAt).toBeLessThan(purgeAt);
  });

  it("dispatchMatchVoiceChannels_releaseStepThrows_stillPurges", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 1 } });
    execute.mockImplementation(async (sql) => {
      if (sql.includes("AS open_rows")) return [[{ due: 0, open_rows: 1 }], []];
      if (sql === RELEASABLE_SQL) throw new Error("ER_BAD");
      return [{ affectedRows: 0 }, []];
    });
    await dispatchMatchVoiceChannels();
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(true);
  });

  it("dispatchMatchVoiceChannels_twoPassesWithinAnHour_purgesOnce", async () => {
    const { writes } = database({ needed: { due: 0, open_rows: 0 } });
    await dispatchMatchVoiceChannels();
    await dispatchMatchVoiceChannels(true);
    expect(writes.filter((w) => w.sql.includes("DELETE FROM bg_match_voice_channels"))).toHaveLength(1);
  });
});

describe("dispatchMatchVoiceChannels — étranglement et repasse", () => {
  const passes = (execute: jest.Mock<SqlQuery>) => execute.mock.calls.filter(([sql]) => sql.includes("AS open_rows")).length;

  it("dispatchMatchVoiceChannels_calledTwiceWithinThrottle_runsOnce", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 0 } });
    await dispatchMatchVoiceChannels();
    await dispatchMatchVoiceChannels();
    expect(passes(execute)).toBe(1);
  });

  it("dispatchMatchVoiceChannels_rerunWhenIdle_ignoresThrottle", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 0 } });
    await dispatchMatchVoiceChannels();
    await dispatchMatchVoiceChannels(true);
    expect(passes(execute)).toBe(2);
  });

  it("dispatchMatchVoiceChannels_rerunDuringPass_runsOneMorePassAfterIt", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 0 } });
    const first = dispatchMatchVoiceChannels();
    const second = dispatchMatchVoiceChannels(true);
    await Promise.all([first, second]);
    expect(passes(execute)).toBe(2);
  });

  it("dispatchMatchVoiceChannels_rerunDuringFailingPass_stillRunsOneMorePass", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 0 } });
    execute.mockRejectedValueOnce(new Error("down"));
    const first = dispatchMatchVoiceChannels();
    const second = dispatchMatchVoiceChannels(true);
    await Promise.all([first, second]);
    expect(passes(execute)).toBe(2);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("dispatchMatchVoiceChannels_failingPass_logsAndResolves", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
    await expect(dispatchMatchVoiceChannels()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
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
    const pool = database({ needed: { due: 0, open_rows: 0 } });
    return { connection, pool };
  }

  it("setTeamVoiceChannels_unknownTournament_throwsNotFound", async () => {
    connectionWith(undefined);
    await expect(setTeamVoiceChannels(7, true)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("setTeamVoiceChannels_firstStatement_locksTournamentRow", async () => {
    const { connection } = connectionWith({ name: "Coupe", state: "RUNNING", team_voice_channels: 0 });
    jest.mocked(lockTournamentRow).mockImplementation(async () => {
      expect(connection.execute).not.toHaveBeenCalled();
    });
    await setTeamVoiceChannels(7, true);
    await dispatchMatchVoiceChannels();
    expect(jest.mocked(lockTournamentRow).mock.calls[0][1]).toBe(7);
  });

  it("setTeamVoiceChannels_sameValue_returnsUnchangedWithoutWrite", async () => {
    const { connection } = connectionWith({ name: "Coupe", state: "RUNNING", team_voice_channels: 1 });
    await expect(setTeamVoiceChannels(7, true)).resolves.toEqual({
      tournamentId: 7,
      tournamentName: "Coupe",
      enabled: true,
      changed: false,
    });
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setTeamVoiceChannels_turnOnMidTournament_writesPublishesAndSweeps", async () => {
    const { connection, pool } = connectionWith({ name: "Coupe", state: "RUNNING", team_voice_channels: 0 });
    await expect(setTeamVoiceChannels(7, true)).resolves.toMatchObject({ enabled: true, changed: true });
    await dispatchMatchVoiceChannels();
    expect(connection.execute).toHaveBeenCalledWith("UPDATE bg_tournaments SET team_voice_channels = ? WHERE id = ?", [1, 7]);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
    expect(pool.execute.mock.calls.some(([sql]) => sql.includes("AS open_rows"))).toBe(true);
  });

  it("setTeamVoiceChannels_turnOffRunning_neverMaintainsLaunches", async () => {
    connectionWith({ name: "Coupe", state: "RUNNING", team_voice_channels: 1 });
    await setTeamVoiceChannels(7, false);
    await dispatchMatchVoiceChannels();
    expect(maintainMatchLaunches).not.toHaveBeenCalled();
  });

  it("setTeamVoiceChannels_finishedTournament_throwsFinishedWithoutWrite", async () => {
    const { connection } = connectionWith({ name: "Coupe", state: "FINISHED", team_voice_channels: 1 });
    await expect(setTeamVoiceChannels(7, false)).rejects.toThrow("TOURNAMENT_FINISHED");
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});

describe("loadMatchVoiceInfos (instantané, les deux portes)", () => {
  const ready = () => ({
    id: 42,
    status: "READY",
    team1Id: 1,
    team2Id: 2,
    startAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    launchedAt: null,
  });
  const teams = [
    { id: 1, solo: 0, ghost: 0 },
    { id: 2, solo: 0, ghost: 0 },
  ];

  it("loadMatchVoiceInfos_disabled_returnsEmptyWithoutQuery", async () => {
    const connection = connectionMock();
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), false, [ready()]);
    expect(infos.size).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadMatchVoiceInfos_dueMatch_readsOnlyCandidateRowsAndReturnsStates", async () => {
    const connection = connectionMock();
    connection.execute
      .mockResolvedValueOnce([[openRow(1, "901"), { ...openRow(2, "x"), channel_id: null, failed_at: new Date() }], []])
      .mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), true, [ready()]);
    expect(infos.get(42)).toEqual({ team1State: "OPEN", team2State: "FAILED" });
    const [sql, params] = connection.execute.mock.calls[0];
    expect(sql).toContain("WHERE match_id IN (?)");
    expect(params).toEqual([42]);
  });

  it("loadMatchVoiceInfos_dueMatchWithoutRows_showsWaiting", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), true, [ready()]);
    expect(infos.get(42)).toEqual({ team1State: "WAITING", team2State: "WAITING" });
  });

  it("loadMatchVoiceInfos_soloSide_isNotShown", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[teams[0], { id: 2, solo: 1, ghost: 0 }], []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), true, [ready()]);
    expect(infos.size).toBe(0);
  });

  it("loadMatchVoiceInfos_matchNotYetDue_returnsEmptyWithoutQuery", async () => {
    const connection = connectionMock();
    const later = { ...ready(), startAt: new Date(Date.now() + 60 * 60_000).toISOString() };
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), true, [later]);
    expect(infos.size).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadMatchVoiceInfos_launchedMatch_stillShownUntilScore", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValueOnce([[openRow(1, "901"), openRow(2, "902")], []]).mockResolvedValueOnce([teams, []]);
    const launched = { ...ready(), launchedAt: new Date().toISOString() };
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), true, [launched]);
    expect(infos.get(42)).toEqual({ team1State: "OPEN", team2State: "OPEN" });
  });

  it("loadMatchVoiceInfos_scoreAwaitingConfirmation_stillShown", async () => {
    const connection = connectionMock();
    connection.execute.mockResolvedValueOnce([[openRow(1, "901")], []]).mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), true, [{ ...ready(), status: "AWAITING_CONFIRMATION" }]);
    expect(infos.get(42)).toEqual({ team1State: "OPEN", team2State: "WAITING" });
  });

  it("loadMatchVoiceInfos_completedMatch_isNotShown", async () => {
    const connection = connectionMock();
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), true, [{ ...ready(), status: "COMPLETED" }]);
    expect(infos.size).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("loadMatchVoiceInfos_releaseRefusedOnOpenChannel_showsOpenNotFailed", async () => {
    const connection = connectionMock();
    connection.execute
      .mockResolvedValueOnce([[{ ...openRow(1, "901"), failed_at: new Date() }], []])
      .mockResolvedValueOnce([teams, []]);
    const infos = await loadMatchVoiceInfos(fakeConnection(connection), true, [ready()]);
    expect(infos.get(42)?.team1State).toBe("OPEN");
  });
});

describe("readMatchVoice (porte REST)", () => {
  function matchRow(overrides: Row) {
    const connection = connectionMock();
    connection.execute.mockImplementation(async (sql) => {
      if (sql.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        const row = {
          id: 42,
          tournament_id: 7,
          status: "READY",
          team1_id: 1,
          team2_id: 2,
          start_at: new Date(Date.now() + 5 * 60_000),
          launched_at: null,
          launch_pairing: null,
          team_voice_channels: 1,
          tournament_state: "RUNNING",
          start_visibility_at: new Date(Date.now() - 60_000),
          ...overrides,
        };
        return [[row], []];
      }
      if (sql.includes("FROM bg_teams")) {
        return [
          [
            { id: 1, solo: 0, ghost: 0 },
            { id: 2, solo: 0, ghost: 0 },
          ],
          [],
        ];
      }
      return [[], []];
    });
    jest.mocked(withConnection).mockImplementation(async (run) => run(fakeConnection(connection)));
    database({ needed: { due: 0, open_rows: 0 } });
  }

  it("readMatchVoice_unpublishedTournamentForNonStaff_returnsUndefined", async () => {
    matchRow({ start_visibility_at: new Date(Date.now() + 60 * 60_000) });
    await expect(readMatchVoice(42, false)).resolves.toBeUndefined();
    await dispatchMatchVoiceChannels();
  });

  it("readMatchVoice_unpublishedTournamentForStaff_returnsStates", async () => {
    matchRow({ start_visibility_at: new Date(Date.now() + 60 * 60_000) });
    await expect(readMatchVoice(42, true)).resolves.toEqual({ team1State: "WAITING", team2State: "WAITING" });
    await dispatchMatchVoiceChannels();
  });

  it("readMatchVoice_tournamentNotRunning_returnsNull", async () => {
    matchRow({ tournament_state: "FINISHED" });
    await expect(readMatchVoice(42, true)).resolves.toBeNull();
    await dispatchMatchVoiceChannels();
  });
});

describe("dispatchMatchVoiceChannels — salons ouverts revérifiés", () => {
  const open = { match_id: 42, team_id: 1, channel_id: "901", tournament_id: 7, team_name: "Alpha" };

  it("dispatchMatchVoiceChannels_openChannelDeletedByHand_recordsNewChannelAndPublishes", async () => {
    const { writes } = database({ openDue: [open] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "905" });
    await dispatchMatchVoiceChannels();
    expect(jest.mocked(ensureVoiceChannel).mock.calls).toEqual([["match:42:team:1", "Alpha"]]);
    expect(writes.filter((w) => w.sql.startsWith("INSERT"))).toEqual([]);
    const replace = writes.filter((w) => w.sql.includes("SET channel_id = ?, failed_at = NULL"));
    expect(replace.map((w) => w.params)).toEqual([["905", 42, 1]]);
    expect(replace[0]!.sql).toContain("released_at IS NULL");
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("dispatchMatchVoiceChannels_rowReleasedDuringRecheck_releasesNewChannelWithoutReopening", async () => {
    const { writes } = database({ openDue: [open], replaced: 0, stillOpen: [] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "905" });
    jest.mocked(releaseVoiceChannel).mockResolvedValue({ kind: "ok", value: true });
    await dispatchMatchVoiceChannels();
    expect(releaseVoiceChannel).toHaveBeenCalledWith("905");
    expect(writes.filter((w) => w.sql.startsWith("INSERT"))).toEqual([]);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("dispatchMatchVoiceChannels_rowAlreadyOnNewChannel_keepsChannelOpen", async () => {
    database({ openDue: [open], replaced: 0, stillOpen: [{ 1: 1 }] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "905" });
    await dispatchMatchVoiceChannels();
    expect(releaseVoiceChannel).not.toHaveBeenCalled();
  });

  it("dispatchMatchVoiceChannels_recheckQuery_skipsSoloAndGhostMatches", () => {
    expect(OPEN_DUE_CHANNELS_SQL).toContain("t1.solo_user_id IS NULL AND t2.solo_user_id IS NULL");
    expect(OPEN_DUE_CHANNELS_SQL).toContain("COALESCE(t1.is_ghost, 0) = 0 AND COALESCE(t2.is_ghost, 0) = 0");
  });

  it("dispatchMatchVoiceChannels_openChannelStillThere_writesNothing", async () => {
    const { writes } = database({ openDue: [open] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "901" });
    await dispatchMatchVoiceChannels();
    expect(writes.filter((w) => w.sql.startsWith("INSERT"))).toEqual([]);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("dispatchMatchVoiceChannels_openChannelRecheckedWithinAMinute_asksBotOnce", async () => {
    database({ openDue: [open] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "901" });
    await dispatchMatchVoiceChannels();
    await dispatchMatchVoiceChannels(true);
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it("dispatchMatchVoiceChannels_recheckFails_leavesChannelAsIs", async () => {
    const { writes } = database({ openDue: [open] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" });
    await dispatchMatchVoiceChannels();
    expect(writes.filter((w) => w.sql.includes("bg_match_voice_channels") && !w.sql.startsWith("DELETE"))).toEqual([]);
  });

  it("dispatchMatchVoiceChannels_recheckFailsThenBotBack_retriesAfterShortBackoff", async () => {
    database({ openDue: [open] });
    const start = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(start);
    jest.mocked(ensureVoiceChannel)
      .mockResolvedValueOnce({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" })
      .mockResolvedValue({ kind: "ok", value: "901" });
    await dispatchMatchVoiceChannels();
    clock.mockReturnValue(start + 11_000);
    await dispatchMatchVoiceChannels(true);
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(2);
  });

  it("dispatchMatchVoiceChannels_recheckFailsOnTransport_notAskedAgainBeforeBackoff", async () => {
    database({ openDue: [open] });
    const start = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(start);
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_VOICE_TIMEOUT" });
    await dispatchMatchVoiceChannels();
    clock.mockReturnValue(start + 5_000);
    await dispatchMatchVoiceChannels(true);
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it("dispatchMatchVoiceChannels_failedChannelRetried_comesAfterOverdueChannels", async () => {
    const [first, second] = openRows(2);
    const start = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(start);
    database({ openDue: [first!] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: first!.channel_id });
    await dispatchMatchVoiceChannels();
    clock.mockReturnValue(start + 55_000);
    database({ openDue: [first!, second!] });
    jest.mocked(ensureVoiceChannel).mockResolvedValueOnce({ kind: "failed", code: "BOT_VOICE_TIMEOUT" });
    await dispatchMatchVoiceChannels(true);
    const failedKey = jest.mocked(ensureVoiceChannel).mock.calls.at(-1)![0];
    jest.mocked(ensureVoiceChannel).mockReset().mockResolvedValue({ kind: "ok", value: "90" });
    clock.mockReturnValue(start + 66_000);
    await dispatchMatchVoiceChannels(true);
    const keys = jest.mocked(ensureVoiceChannel).mock.calls.map(([key]) => key);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(failedKey);
  });

  it("dispatchMatchVoiceChannels_recheckRefusedForOneChannel_checksTheOthersAndKeepsStamp", async () => {
    database({ openDue: openRows(2) });
    jest
      .mocked(ensureVoiceChannel)
      .mockResolvedValueOnce({ kind: "failed", code: "VOICE_PERMISSION_DENIED" })
      .mockResolvedValue({ kind: "ok", value: "90" });
    await dispatchMatchVoiceChannels();
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(2);
    await dispatchMatchVoiceChannels(true);
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(2);
  });

  it("dispatchMatchVoiceChannels_recheckQuery_dueOpenChannelsOfCurrentTeamsOnly", () => {
    expect(OPEN_DUE_CHANNELS_SQL).toContain("v.released_at IS NULL AND v.channel_id IS NOT NULL");
    expect(OPEN_DUE_CHANNELS_SQL).toContain(`m.start_at >= NOW() - INTERVAL ${VOICE_CHANNEL_LATE_HOURS} HOUR`);
    expect(OPEN_DUE_CHANNELS_SQL).toContain("v.team_id <=> m.team1_id OR v.team_id <=> m.team2_id");
  });

  const openRows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ ...open, match_id: 100 + index, channel_id: `9${index}` }));

  it("dispatchMatchVoiceChannels_sixDueOpenChannels_neverMoreThanFiveBotCallsInFlight", async () => {
    database({ openDue: openRows(6) });
    let inFlight = 0;
    let peak = 0;
    jest.mocked(ensureVoiceChannel).mockImplementation(async (key) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { kind: "ok", value: `9${Number(key.split(":")[1]) - 100}` };
    });
    await dispatchMatchVoiceChannels();
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(6);
    expect(peak).toBe(5);
  });

  it("dispatchMatchVoiceChannels_botUnreachableOnRecheck_stopsRemainingChecks", async () => {
    database({ openDue: openRows(12) });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" });
    await dispatchMatchVoiceChannels();
    expect(jest.mocked(ensureVoiceChannel).mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("dispatchMatchVoiceChannels_moreThanBatchDue_checksAtMostEightyPerPass", async () => {
    database({ openDue: openRows(100) });
    jest.mocked(ensureVoiceChannel).mockImplementation(async (key) => ({
      kind: "ok",
      value: `9${Number(key.split(":")[1]) - 100}`,
    }));
    await dispatchMatchVoiceChannels();
    expect(ensureVoiceChannel).toHaveBeenCalledTimes(80);
    await dispatchMatchVoiceChannels(true);
    // Passe suivante : les vingt non vus passent avant les quatre-vingts déjà revus.
    const keys = jest.mocked(ensureVoiceChannel).mock.calls.slice(80).map(([key]) => key);
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
  });

  it("dispatchMatchVoiceChannels_channelCreatedThisPass_notAskedAgainByRecheck", async () => {
    database({ due: [dueMatch], openDue: [{ ...open, match_id: 42, team_id: 1 }] });
    jest.mocked(ensureVoiceChannel).mockResolvedValue({ kind: "ok", value: "901" });
    await dispatchMatchVoiceChannels();
    expect(jest.mocked(ensureVoiceChannel).mock.calls.map(([key]) => key)).toEqual([
      "match:42:team:1",
      "match:42:team:2",
    ]);
  });

  it("dispatchMatchVoiceChannels_nothingDue_skipsRecheck", async () => {
    const { execute } = database({ needed: { due: 0, open_rows: 1 }, openDue: [open] });
    await dispatchMatchVoiceChannels();
    expect(execute.mock.calls.some(([sql]) => sql === OPEN_DUE_CHANNELS_SQL)).toBe(false);
  });
});
