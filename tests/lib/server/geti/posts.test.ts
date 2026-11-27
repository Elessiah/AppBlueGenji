import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database", () => ({ getDatabase: jest.fn() }));
jest.mock("@/lib/server/periodic-clock", () => ({ startPeriodicClock: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import {
  deleteGetiPosts,
  forgetGetiListScans,
  GETI_LIST_SCAN_MAX,
  getiTrustedBots,
  listGetiPosts,
  purgeExpiredGetiPosts,
  reconcileGetiChannel,
  startGetiPostsPurgeClock,
  upsertGetiPosts,
} from "@/lib/server/geti/posts";
import { parsePushedPost } from "@/lib/server/geti/wire";
import { startPeriodicClock } from "@/lib/server/periodic-clock";
import { GETI_CHANNEL_IDS, parseGetiPost, type GetiParsedPost } from "@/lib/shared/geti";
import { GETI_BOT_USER_ID, GETI_RETENTION_DAYS, GETI_RETENTION_MAX_DAYS, getiRetentionCutoff, getiRetentionMs } from "@/lib/shared/geti/ingest";
import { GETI_TRUSTED_BOTS, parsedGetiPost } from "../../../helpers/geti";
import {
  GETI_FAKE_MESSAGE_ID,
  GETI_FAKE_RELAYED_AUTHOR_ID,
  getiPushedPost,
  getiWireRelay,
} from "../../../helpers/geti-ingest";
import { fakePool, type SqlMock, type SqlQuery } from "../../../helpers/sql-double";

/** Annonces GETI gardées : écriture analysée, suppression, réconciliation, purge par catégorie, lecture. */

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function executeMock(rows: unknown[] = [], affectedRows = 0): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => (sql.trimStart().startsWith("SELECT") ? [rows] : [{ affectedRows }]));
}

function executor(execute: SqlMock) {
  return fakePool({ execute });
}

/** Date gardée en base (heure locale du serveur, sans fuseau), `ageMs` avant {@link NOW}. */
function storedDate(ageMs: number): string {
  const date = new Date(NOW - ageMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function row(overrides: Record<string, unknown> = {}, parsed: Partial<GetiParsedPost> = {}) {
  return {
    message_id: GETI_FAKE_MESSAGE_ID,
    channel_id: GETI_CHANNEL_IDS.lft,
    category: "lft",
    source: "direct",
    author_id: "100000000000000001",
    author_tag: "fauxjoueur",
    parsed_json: JSON.stringify(parsedGetiPost({ text: "LFT support", ...parsed })),
    posted_at: storedDate(2 * 60 * 60 * 1000),
    edited_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  forgetGetiListScans();
  jest.clearAllMocks();
});

describe("durées de garde", () => {
  it("GETI_RETENTION_DAYS_scrimSearches_liveSevenDays", () => {
    expect(GETI_RETENTION_DAYS.lfs).toBe(7);
  });

  it("GETI_RETENTION_DAYS_otherCategories_liveFourteenDays", () => {
    expect([GETI_RETENTION_DAYS.lfp, GETI_RETENTION_DAYS.lft, GETI_RETENTION_DAYS.lfsub, GETI_RETENTION_DAYS.lfstaff, GETI_RETENTION_DAYS.lfcast]).toEqual([14, 14, 14, 14, 14]);
    expect(GETI_RETENTION_MAX_DAYS).toBe(14);
  });

  it("getiRetentionCutoff_scrim_isSevenDaysEarlier", () => {
    expect(getiRetentionCutoff("lfs", NOW)).toEqual(new Date("2026-11-20T12:00:00.000Z"));
  });

  it("getiRetentionCutoff_teamSearch_isFourteenDaysEarlier", () => {
    expect(getiRetentionCutoff("lft", NOW)).toEqual(new Date("2026-11-13T12:00:00.000Z"));
  });

  it("getiRetentionMs_scrim_isSevenDays", () => {
    expect(getiRetentionMs("lfs")).toBe(7 * DAY_MS);
  });
});

describe("getiTrustedBots", () => {
  it("getiTrustedBots_always_trustsGetiBotOnly", () => {
    expect(getiTrustedBots()).toEqual({ getiBotIds: [GETI_BOT_USER_ID], siteBotIds: [] });
  });

  it("getiTrustedBots_testHelper_trustsNoSiteBotLikeProduction", () => {
    expect(GETI_TRUSTED_BOTS.siteBotIds).toEqual(getiTrustedBots().siteBotIds);
  });
});

describe("upsertGetiPosts", () => {
  it("upsertGetiPosts_directPost_writesRawAndParsedPost", async () => {
    const execute = executeMock();
    const post = getiPushedPost({ postedAt: "2026-11-27T10:00:00.000Z", editedAt: "2026-11-27T11:00:00.000Z" });

    const outcome = await upsertGetiPosts(executor(execute), [post], NOW);

    expect(outcome).toEqual({ stored: 1, emptied: 0, expired: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("INSERT INTO bg_geti_posts");
    expect(params).toEqual([
      GETI_FAKE_MESSAGE_ID,
      GETI_CHANNEL_IDS.lft,
      "lft",
      "direct",
      "100000000000000001",
      "fauxjoueur",
      JSON.stringify(post.raw),
      JSON.stringify(parseGetiPost(post.raw)),
      new Date("2026-11-27T10:00:00.000Z"),
      new Date("2026-11-27T11:00:00.000Z"),
    ]);
  });

  it("upsertGetiPosts_relayOfGetiBot_storesTheRelayedAuthorNotTheBot", async () => {
    const execute = executeMock();
    const post = parsePushedPost(getiWireRelay("LFP tank Master 3, EU"));
    if (!post) throw new Error("corps de test illisible");

    await upsertGetiPosts(executor(execute), [post], NOW);

    const params = execute.mock.calls[0][1];
    expect(params).toEqual(expect.arrayContaining(["relay", GETI_FAKE_RELAYED_AUTHOR_ID, "fauxpseudo"]));
  });

  it("upsertGetiPosts_sql_keepsTheStoredVersionWhenTheIncomingOneIsOlder", async () => {
    const execute = executeMock();

    await upsertGetiPosts(executor(execute), [getiPushedPost()], NOW);

    const sql = String(execute.mock.calls[0][0]);
    const guard = "IF(COALESCE(VALUES(edited_at), VALUES(posted_at)) >= COALESCE(edited_at, posted_at)";
    expect(sql).toContain(`parsed_json = ${guard}, VALUES(parsed_json), parsed_json)`);
    // `edited_at` affecté en dernier : les colonnes plus à gauche lisent encore l'ancienne date.
    expect(sql.trimEnd().endsWith(`edited_at = ${guard}, VALUES(edited_at), edited_at)`)).toBe(true);
  });

  it("upsertGetiPosts_teamSearchJustOlderThanFourteenDays_isCountedExpiredAndNotWritten", async () => {
    const execute = executeMock();
    const post = getiPushedPost({ postedAt: new Date(NOW - 14 * DAY_MS - 1).toISOString() });

    const outcome = await upsertGetiPosts(executor(execute), [post], NOW);

    expect(outcome).toEqual({ stored: 0, emptied: 0, expired: 1 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("upsertGetiPosts_teamSearchExactlyFourteenDaysOld_isStored", async () => {
    const execute = executeMock();
    const post = getiPushedPost({ postedAt: new Date(NOW - 14 * DAY_MS).toISOString() });

    const outcome = await upsertGetiPosts(executor(execute), [post], NOW);

    expect(outcome.stored).toBe(1);
  });

  it("upsertGetiPosts_scrimJustOlderThanSevenDays_isCountedExpired", async () => {
    const execute = executeMock();
    const post = getiPushedPost({ channelId: GETI_CHANNEL_IDS.lfs, postedAt: new Date(NOW - 7 * DAY_MS - 1).toISOString() });

    const outcome = await upsertGetiPosts(executor(execute), [post], NOW);

    expect(outcome).toEqual({ stored: 0, emptied: 0, expired: 1 });
  });

  it("upsertGetiPosts_scrimExactlySevenDaysOld_isStored", async () => {
    const execute = executeMock();
    const post = getiPushedPost({ channelId: GETI_CHANNEL_IDS.lfs, postedAt: new Date(NOW - 7 * DAY_MS).toISOString() });

    const outcome = await upsertGetiPosts(executor(execute), [post], NOW);

    expect(outcome.stored).toBe(1);
  });

  it("upsertGetiPosts_batchOfPosts_isWrittenByOneMultiRowStatement", async () => {
    const execute = executeMock();
    const posts = [
      getiPushedPost({ id: "100000000000000911" }),
      getiPushedPost({ id: "100000000000000912" }),
      getiPushedPost({ id: "100000000000000913" }),
    ];

    const outcome = await upsertGetiPosts(executor(execute), posts, NOW);

    expect(outcome.stored).toBe(3);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql).match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g)).toHaveLength(3);
    expect(params).toHaveLength(30);
    const values: unknown[] = Array.isArray(params) ? params : [];
    expect([values[0], values[10], values[20]]).toEqual(["100000000000000911", "100000000000000912", "100000000000000913"]);
  });

  it("upsertGetiPosts_expiredAndEmptiedMixedWithKept_writesOnlyTheKeptOnes", async () => {
    const execute = executeMock([], 1);
    const posts = [
      getiPushedPost({ id: "100000000000000921" }),
      getiPushedPost({ id: "100000000000000922", content: "  " }),
      getiPushedPost({ id: "100000000000000923", postedAt: new Date(NOW - 20 * DAY_MS).toISOString() }),
    ];

    const outcome = await upsertGetiPosts(executor(execute), posts, NOW);

    expect(outcome).toEqual({ stored: 1, emptied: 1, expired: 1 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toHaveLength(10);
  });

  it("upsertGetiPosts_postWithoutText_removesTheStoredPost", async () => {
    const execute = executeMock([], 1);
    const post = getiPushedPost({ content: "   " });

    const outcome = await upsertGetiPosts(executor(execute), [post], NOW);

    expect(outcome).toEqual({ stored: 0, emptied: 1, expired: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_posts WHERE message_id IN (?)", [GETI_FAKE_MESSAGE_ID]);
  });
});

describe("deleteGetiPosts", () => {
  it("deleteGetiPosts_noIds_runsNoQuery", async () => {
    const execute = executeMock();

    const removed = await deleteGetiPosts(executor(execute), []);

    expect(removed).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("deleteGetiPosts_ids_returnsTheRemovedRows", async () => {
    const execute = executeMock([], 2);

    const removed = await deleteGetiPosts(executor(execute), ["100000000000000901", "100000000000000902"]);

    expect(removed).toBe(2);
    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_posts WHERE message_id IN (?, ?)", [
      "100000000000000901",
      "100000000000000902",
    ]);
  });

  it("deleteGetiPosts_twoHundredAndOneIds_runsTwoQueries", async () => {
    const execute = executeMock([], 1);
    const ids = Array.from({ length: 201 }, (_, index) => `1000000000000${String(index).padStart(5, "0")}`);

    await deleteGetiPosts(executor(execute), ids);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][1]).toEqual([ids[200]]);
  });
});

describe("reconcileGetiChannel", () => {
  const request = {
    channelId: GETI_CHANNEL_IDS.lfp,
    since: new Date("2026-11-20T00:00:00.000Z"),
    until: new Date("2026-11-27T11:00:00.000Z"),
    ids: ["100000000000000901"],
  };

  it("reconcileGetiChannel_storedPostMissingFromDiscord_isRemoved", async () => {
    const execute = executeMock([{ message_id: "100000000000000901" }, { message_id: "100000000000000902" }], 1);

    const removed = await reconcileGetiChannel(executor(execute), request, NOW);

    expect(removed).toBe(1);
    expect(execute).toHaveBeenLastCalledWith("DELETE FROM bg_geti_posts WHERE message_id IN (?)", ["100000000000000902"]);
  });

  it("reconcileGetiChannel_nothingMissing_deletesNothing", async () => {
    const execute = executeMock([{ message_id: "100000000000000901" }]);

    const removed = await reconcileGetiChannel(executor(execute), request, NOW);

    expect(removed).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reconcileGetiChannel_window_readsOnlyTheChannelBetweenSinceAndUntil", async () => {
    const execute = executeMock();

    await reconcileGetiChannel(executor(execute), request, NOW);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("channel_id = ? AND posted_at >= ? AND posted_at <= ?");
    expect(params).toEqual([GETI_CHANNEL_IDS.lfp, request.since, request.until]);
  });

  it("reconcileGetiChannel_sinceOlderThanFourteenDays_isClampedToTheCutoff", async () => {
    const execute = executeMock();

    await reconcileGetiChannel(executor(execute), { ...request, since: new Date("2026-01-01T00:00:00.000Z") }, NOW);

    expect(execute.mock.calls[0][1]).toEqual([GETI_CHANNEL_IDS.lfp, new Date(NOW - 14 * DAY_MS), request.until]);
  });

  it("reconcileGetiChannel_scrimChannelSinceOlderThanSevenDays_isClampedToSevenDays", async () => {
    const execute = executeMock();
    const scrims = { ...request, channelId: GETI_CHANNEL_IDS.lfs, since: new Date(NOW - 10 * DAY_MS) };

    await reconcileGetiChannel(executor(execute), scrims, NOW);

    expect(execute.mock.calls[0][1]).toEqual([GETI_CHANNEL_IDS.lfs, new Date(NOW - 7 * DAY_MS), request.until]);
  });

  it("reconcileGetiChannel_channelOutsideTheSixSources_touchesNothing", async () => {
    const execute = executeMock([{ message_id: "100000000000000902" }], 1);

    const removed = await reconcileGetiChannel(executor(execute), { ...request, channelId: "100000000000000555" }, NOW);

    expect(removed).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("purgeExpiredGetiPosts", () => {
  it("purgeExpiredGetiPosts_scrims_areDeletedAfterSevenDays", async () => {
    const execute = executeMock();

    await purgeExpiredGetiPosts(executor(execute), NOW);

    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_posts WHERE category = ? AND posted_at < ? LIMIT 500", [
      "lfs",
      new Date(NOW - 7 * DAY_MS),
    ]);
  });

  it("purgeExpiredGetiPosts_otherCategories_areDeletedAfterFourteenDays", async () => {
    const execute = executeMock();

    await purgeExpiredGetiPosts(executor(execute), NOW);

    for (const category of ["lfp", "lft", "lfsub", "lfstaff", "lfcast"]) {
      expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_posts WHERE category = ? AND posted_at < ? LIMIT 500", [
        category,
        new Date(NOW - 14 * DAY_MS),
      ]);
    }
  });

  it("purgeExpiredGetiPosts_rowOfAnyCategory_isDeletedAfterTheLongestDuration", async () => {
    const execute = executeMock();

    await purgeExpiredGetiPosts(executor(execute), NOW);

    expect(execute).toHaveBeenLastCalledWith("DELETE FROM bg_geti_posts WHERE posted_at < ? LIMIT 500", [new Date(NOW - 14 * DAY_MS)]);
  });

  it("purgeExpiredGetiPosts_fullBatch_runsAgainUntilABatchIsShort", async () => {
    const answers = [500, 500, 20];
    const execute = jest.fn<SqlQuery>(async () => [{ affectedRows: answers.shift() ?? 0 }]);

    const removed = await purgeExpiredGetiPosts(executor(execute), NOW);

    // Première catégorie : trois passages (500, 500, 20) ; les autres et la condition finale : un passage chacune.
    expect(execute).toHaveBeenCalledTimes(3 + 6);
    expect(removed).toBe(1020);
  });

  it("purgeExpiredGetiPosts_neverShortBatch_stopsAtTheBatchCap", async () => {
    const execute = jest.fn<SqlQuery>(async () => [{ affectedRows: 500 }]);

    await purgeExpiredGetiPosts(executor(execute), NOW);

    expect(execute).toHaveBeenCalledTimes(100 * 7);
  });

  it("purgeExpiredGetiPosts_rowsRemoved_returnsTheirTotal", async () => {
    const execute = executeMock([], 2);

    const removed = await purgeExpiredGetiPosts(executor(execute), NOW);

    expect(removed).toBe(14);
  });
});

describe("startGetiPostsPurgeClock", () => {
  it("startGetiPostsPurgeClock_called_registersAnHourlyClock", () => {
    startGetiPostsPurgeClock();

    expect(startPeriodicClock).toHaveBeenCalledWith(expect.objectContaining({ key: "geti-posts-purge", tickMs: 60 * 60 * 1000 }));
  });

  it("startGetiPostsPurgeClock_clockPass_purgesOnThePool", async () => {
    const execute = executeMock([], 1);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));
    startGetiPostsPurgeClock();
    const [{ run }] = jest.mocked(startPeriodicClock).mock.calls[0];

    await run();

    expect(execute).toHaveBeenLastCalledWith("DELETE FROM bg_geti_posts WHERE posted_at < ? LIMIT 500", [expect.any(Date)]);
  });
});

describe("listGetiPosts", () => {
  it("listGetiPosts_noFilter_readsTheLongestRetentionWindowNewestFirst", async () => {
    const execute = executeMock([row()]);

    const page = await listGetiPosts({}, {}, executor(execute), NOW);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("WHERE posted_at >= ?");
    expect(sql).toContain("ORDER BY posted_at DESC, id DESC");
    expect(params).toEqual([new Date(NOW - 14 * DAY_MS)]);
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 30 });
  });

  it("listGetiPosts_storedRow_isReturnedWithoutTheRawMessage", async () => {
    const posted = storedDate(2 * 60 * 60 * 1000);
    const edited = storedDate(60 * 60 * 1000);
    const execute = executeMock([row({ source: "relay", posted_at: posted, edited_at: edited })]);

    const page = await listGetiPosts({}, {}, executor(execute), NOW);

    const postedAt = new Date(posted).toISOString();
    expect(page.posts).toEqual([
      {
        messageId: GETI_FAKE_MESSAGE_ID,
        channelId: GETI_CHANNEL_IDS.lft,
        category: "lft",
        source: "relay",
        authorTag: "fauxjoueur",
        authorId: "100000000000000001",
        parsed: parsedGetiPost({ text: "LFT support", postedAt }),
        postedAt,
        editedAt: new Date(edited).toISOString(),
      },
    ]);
  });

  it("listGetiPosts_noExecutorGiven_readsFromThePool", async () => {
    const execute = executeMock([]);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));

    await listGetiPosts();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("listGetiPosts_twoReadsOnThePool_shareOneScan", async () => {
    const execute = executeMock([row()]);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));

    await listGetiPosts();
    await listGetiPosts();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("listGetiPosts_otherCategory_scansAgain", async () => {
    const execute = executeMock([row()]);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));

    await listGetiPosts({ category: "lfp" });
    await listGetiPosts({ category: "lft" });

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("listGetiPosts_storedScanOlderThanTenSeconds_isReadAgain", async () => {
    const execute = executeMock([row()]);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));
    const clock = jest.spyOn(Date, "now");
    try {
      clock.mockReturnValue(NOW);
      await listGetiPosts();
      clock.mockReturnValue(NOW + 10_001);
      await listGetiPosts();
    } finally {
      clock.mockRestore();
    }

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("listGetiPosts_afterAWrite_readsAgain", async () => {
    const execute = executeMock([row()]);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));
    await listGetiPosts();

    await deleteGetiPosts(executor(executeMock([], 1)), [GETI_FAKE_MESSAGE_ID]);
    await listGetiPosts();

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("listGetiPosts_givenExecutor_neverUsesTheScanKept", async () => {
    const execute = executeMock([row()]);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));
    await listGetiPosts();
    const given = executeMock([]);

    await listGetiPosts({}, {}, executor(given), NOW);

    expect(given).toHaveBeenCalledTimes(1);
  });

  it("listGetiPosts_manyFilters_keepAtMostEightScans", async () => {
    const execute = executeMock([row()]);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));
    for (let hours = 1; hours <= 10; hours += 1) await listGetiPosts({ maxAgeHours: hours });
    execute.mockClear();

    await listGetiPosts({ maxAgeHours: 10 });
    await listGetiPosts({ maxAgeHours: 1 });

    // 10 est gardée ; 1, la plus ancienne, a été oubliée.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("listGetiPosts_scanAtTheCap_warnsOnce", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const execute = executeMock(Array.from({ length: GETI_LIST_SCAN_MAX }, () => row()));
      jest.mocked(getDatabase).mockResolvedValue(executor(execute));

      await listGetiPosts();
      await listGetiPosts();

      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("listGetiPosts_categoryFilter_isAppliedInSql", async () => {
    const execute = executeMock();

    await listGetiPosts({ category: "lfp" }, {}, executor(execute), NOW);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("posted_at >= ? AND category = ?");
    expect(params).toEqual([new Date(NOW - 14 * DAY_MS), "lfp"]);
  });

  it("listGetiPosts_scrimCategory_readsSevenDaysOnly", async () => {
    const execute = executeMock();

    await listGetiPosts({ category: "lfs" }, {}, executor(execute), NOW);

    expect(execute.mock.calls[0][1]).toEqual([new Date(NOW - 7 * DAY_MS), "lfs"]);
  });

  it("listGetiPosts_noCategoryAndScrimOlderThanSevenDays_leavesItOut", async () => {
    const execute = executeMock([
      row({ message_id: "100000000000000901", category: "lfs", posted_at: storedDate(8 * DAY_MS) }),
      row({ message_id: "100000000000000902", category: "lfs", posted_at: storedDate(6 * DAY_MS) }),
      row({ message_id: "100000000000000903", category: "lft", posted_at: storedDate(8 * DAY_MS) }),
    ]);

    const page = await listGetiPosts({ includeUnknown: true }, {}, executor(execute), NOW);

    expect(page.posts.map((post) => post.messageId)).toEqual(["100000000000000902", "100000000000000903"]);
  });

  it("listGetiPosts_maxAgeHours_narrowsTheSqlWindow", async () => {
    const execute = executeMock();

    await listGetiPosts({ maxAgeHours: 24 }, {}, executor(execute), NOW);

    expect(execute.mock.calls[0][1]).toEqual([new Date(NOW - DAY_MS)]);
  });

  it("listGetiPosts_maxAgeBeyondTheRetentionWindow_keepsTheRetentionCutoff", async () => {
    const execute = executeMock();

    await listGetiPosts({ maxAgeHours: 24 * 30 }, {}, executor(execute), NOW);

    expect(execute.mock.calls[0][1]).toEqual([new Date(NOW - 14 * DAY_MS)]);
  });

  it("listGetiPosts_roleFilter_keepsOnlyMatchingPostsAndCountsThem", async () => {
    const execute = executeMock([
      row({ message_id: "100000000000000901" }, { roles: ["TANK"] }),
      row({ message_id: "100000000000000902" }, { roles: ["SUPPORT"] }),
    ]);

    const page = await listGetiPosts({ roles: ["SUPPORT"] }, {}, executor(execute), NOW);

    expect(page.total).toBe(1);
    expect(page.posts.map((post) => post.messageId)).toEqual(["100000000000000902"]);
  });

  it("listGetiPosts_secondPage_returnsTheNextSlice", async () => {
    const execute = executeMock([
      row({ message_id: "100000000000000901" }),
      row({ message_id: "100000000000000902" }),
      row({ message_id: "100000000000000903" }),
    ]);

    const page = await listGetiPosts({}, { page: 2, pageSize: 2 }, executor(execute), NOW);

    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.posts.map((post) => post.messageId)).toEqual(["100000000000000903"]);
  });

  it("listGetiPosts_pageSizeZero_isRaisedToOne", async () => {
    const page = await listGetiPosts({}, { pageSize: 0 }, executor(executeMock()), NOW);

    expect(page.pageSize).toBe(1);
  });

  it("listGetiPosts_pageSizeOverTheMaximum_isCappedAtHundred", async () => {
    const page = await listGetiPosts({}, { pageSize: 101 }, executor(executeMock()), NOW);

    expect(page.pageSize).toBe(100);
  });

  it("listGetiPosts_unreadableParsedJson_skipsTheRow", async () => {
    const execute = executeMock([row({ parsed_json: "{" }), row({ message_id: "100000000000000902" })]);

    const page = await listGetiPosts({}, {}, executor(execute), NOW);

    expect(page.posts.map((post) => post.messageId)).toEqual(["100000000000000902"]);
  });

  it("listGetiPosts_rowOfAnUnknownCategory_isSkipped", async () => {
    const execute = executeMock([row({ category: "lfg" })]);

    const page = await listGetiPosts({}, {}, executor(execute), NOW);

    expect(page.total).toBe(0);
  });

  it("listGetiPosts_rowOfAnUnknownSource_isSkipped", async () => {
    const execute = executeMock([row({ source: "webhook" })]);

    const page = await listGetiPosts({}, {}, executor(execute), NOW);

    expect(page.total).toBe(0);
  });
});
