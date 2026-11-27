import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database", () => ({ getDatabase: jest.fn() }));
jest.mock("@/lib/server/periodic-clock", () => ({ startPeriodicClock: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import {
  analyseGetiPost,
  deleteGetiPosts,
  getiRetentionCutoff,
  listGetiPosts,
  purgeExpiredGetiPosts,
  reconcileGetiChannel,
  startGetiPostsPurgeClock,
  upsertGetiPosts,
} from "@/lib/server/geti/posts";
import { startPeriodicClock } from "@/lib/server/periodic-clock";
import { GETI_CHANNEL_IDS, type GetiParsedPost } from "@/lib/shared/geti";
import { parsedGetiPost } from "../../../helpers/geti";
import { GETI_FAKE_MESSAGE_ID, getiPushedPost, getiWireRelay } from "../../../helpers/geti-ingest";
import { parsePushedPost } from "@/lib/server/geti/wire";
import { fakePool, type SqlMock, type SqlQuery } from "../../../helpers/sql-double";

/** Annonces GETI gardées : écriture analysée, suppression, réconciliation, purge, lecture. */

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const MENTIONED_ID = "100000000000000012";

function executeMock(rows: unknown[] = [], affectedRows = 0): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => (sql.trimStart().startsWith("SELECT") ? [rows] : [{ affectedRows }]));
}

function executor(execute: SqlMock) {
  return fakePool({ execute });
}

function relayWithMention(mention: Record<string, unknown>) {
  const post = parsePushedPost(
    getiWireRelay("Nom Affiché", `DPS Diamant 1 cherche équipe. Contact : <@${MENTIONED_ID}>`, { mentions: [mention] }),
  );
  if (!post) throw new Error("corps de test illisible");
  return post;
}

function row(overrides: Record<string, unknown> = {}, parsed: Partial<GetiParsedPost> = {}) {
  return {
    message_id: GETI_FAKE_MESSAGE_ID,
    channel_id: GETI_CHANNEL_IDS.lft,
    category: "lft",
    author_id: "100000000000000001",
    author_tag: "fauxjoueur",
    parsed_json: JSON.stringify(parsedGetiPost({ text: "LFT support", ...parsed })),
    posted_at: "2026-11-27 10:00:00",
    edited_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("analyseGetiPost", () => {
  it("analyseGetiPost_userMessage_keepsTheDiscordAuthor", () => {
    const parsed = analyseGetiPost(getiPushedPost());

    expect(parsed).toMatchObject({ authorTag: "fauxjoueur", authorId: "100000000000000001", category: "lft" });
  });

  it("analyseGetiPost_authorMentionResolvedByTheBot_usesItsUsername", () => {
    const parsed = analyseGetiPost(relayWithMention({ id: MENTIONED_ID, username: "vraipseudo", discriminator: "0" }));

    expect(parsed).toMatchObject({ authorId: MENTIONED_ID, authorTag: "vraipseudo" });
  });

  it("analyseGetiPost_mentionWithLegacyDiscriminator_appendsTheSuffix", () => {
    const parsed = analyseGetiPost(relayWithMention({ id: MENTIONED_ID, username: "vraipseudo", discriminator: "4821" }));

    expect(parsed.authorTag).toBe("vraipseudo#4821");
  });

  it("analyseGetiPost_resolvedMentionOfAnotherAccount_keepsTheEmbedAuthor", () => {
    const parsed = analyseGetiPost(relayWithMention({ id: "100000000000000013", username: "autre", discriminator: "0" }));

    expect(parsed.authorTag).toBe("Nom Affiché");
  });

  it("analyseGetiPost_resolvedMentionWithBlankUsername_keepsTheEmbedAuthor", () => {
    const parsed = analyseGetiPost(relayWithMention({ id: MENTIONED_ID, username: "@@", discriminator: "0" }));

    expect(parsed.authorTag).toBe("Nom Affiché");
  });
});

describe("upsertGetiPosts", () => {
  it("upsertGetiPosts_freshPost_writesRawAndParsedPost", async () => {
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
      "100000000000000001",
      "fauxjoueur",
      JSON.stringify(post.raw),
      JSON.stringify(analyseGetiPost(post)),
      new Date("2026-11-27T10:00:00.000Z"),
      new Date("2026-11-27T11:00:00.000Z"),
    ]);
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

  it("upsertGetiPosts_postedJustBeforeTheRetentionWindow_isCountedExpiredAndNotWritten", async () => {
    const execute = executeMock();
    const post = getiPushedPost({ postedAt: new Date(NOW - 14 * DAY_MS - 1).toISOString() });

    const outcome = await upsertGetiPosts(executor(execute), [post], NOW);

    expect(outcome).toEqual({ stored: 0, emptied: 0, expired: 1 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("upsertGetiPosts_postedExactlyAtTheRetentionCutoff_isStored", async () => {
    const execute = executeMock();
    const post = getiPushedPost({ postedAt: new Date(NOW - 14 * DAY_MS).toISOString() });

    const outcome = await upsertGetiPosts(executor(execute), [post], NOW);

    expect(outcome.stored).toBe(1);
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

  it("reconcileGetiChannel_sinceOlderThanTheRetentionWindow_isClampedToTheCutoff", async () => {
    const execute = executeMock();

    await reconcileGetiChannel(executor(execute), { ...request, since: new Date("2026-01-01T00:00:00.000Z") }, NOW);

    expect(execute.mock.calls[0][1]).toEqual([GETI_CHANNEL_IDS.lfp, new Date(NOW - 14 * DAY_MS), request.until]);
  });
});

describe("purgeExpiredGetiPosts", () => {
  it("purgeExpiredGetiPosts_called_deletesPostsOlderThanFourteenDays", async () => {
    const execute = executeMock([], 3);

    const removed = await purgeExpiredGetiPosts(executor(execute), NOW);

    expect(removed).toBe(3);
    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_posts WHERE posted_at < ?", [new Date(NOW - 14 * DAY_MS)]);
  });
});

describe("getiRetentionCutoff", () => {
  it("getiRetentionCutoff_now_isFourteenDaysEarlier", () => {
    expect(getiRetentionCutoff(NOW)).toEqual(new Date("2026-11-13T12:00:00.000Z"));
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

    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_posts WHERE posted_at < ?", [expect.any(Date)]);
  });
});

describe("listGetiPosts", () => {
  it("listGetiPosts_noFilter_readsTheRetentionWindowNewestFirst", async () => {
    const execute = executeMock([row()]);

    const page = await listGetiPosts({}, {}, executor(execute), NOW);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("WHERE posted_at >= ?");
    expect(sql).toContain("ORDER BY posted_at DESC, id DESC");
    expect(params).toEqual([new Date(NOW - 14 * DAY_MS)]);
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 30 });
  });

  it("listGetiPosts_storedRow_isReturnedWithoutTheRawMessage", async () => {
    const execute = executeMock([row({ edited_at: "2026-11-27 11:00:00" })]);

    const page = await listGetiPosts({}, {}, executor(execute), NOW);

    const postedAt = new Date("2026-11-27 10:00:00").toISOString();
    expect(page.posts).toEqual([
      {
        messageId: GETI_FAKE_MESSAGE_ID,
        channelId: GETI_CHANNEL_IDS.lft,
        category: "lft",
        authorTag: "fauxjoueur",
        authorId: "100000000000000001",
        parsed: parsedGetiPost({ text: "LFT support", postedAt }),
        postedAt,
        editedAt: new Date("2026-11-27 11:00:00").toISOString(),
      },
    ]);
  });

  it("listGetiPosts_noExecutorGiven_readsFromThePool", async () => {
    const execute = executeMock([row()]);
    jest.mocked(getDatabase).mockResolvedValue(executor(execute));

    const page = await listGetiPosts();

    expect(page.total).toBe(1);
  });

  it("listGetiPosts_categoryFilter_isAppliedInSql", async () => {
    const execute = executeMock();

    await listGetiPosts({ category: "lfs" }, {}, executor(execute), NOW);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("posted_at >= ? AND category = ?");
    expect(params).toEqual([new Date(NOW - 14 * DAY_MS), "lfs"]);
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
});
