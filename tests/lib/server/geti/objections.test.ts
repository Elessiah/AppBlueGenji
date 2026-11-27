import { describe, expect, it, jest } from "@jest/globals";
import {
  liftGetiObjection,
  parseGetiObjection,
  purgeStaleGetiObjections,
  recordGetiObjection,
  withholdObjectedGetiPosts,
} from "@/lib/server/geti/objections";
import { fakePool, type SqlQuery } from "../../../helpers/sql-double";

/** Oppositions aux annonces GETI (RGPD, art. 21) : lecture du corps, enregistrement, levée, retrait à l'écriture, purge. */

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTHOR_ID = "100000000000000001";
const MESSAGE_ID = "100000000000000901";

function writes(affectedRows: number) {
  return jest.fn<SqlQuery>(async () => [{ affectedRows }]);
}

describe("parseGetiObjection", () => {
  it("parseGetiObjection_authorIdOnly_returnsAuthorObjection", () => {
    expect(parseGetiObjection({ authorId: AUTHOR_ID })).toEqual({ kind: "author", targetId: AUTHOR_ID });
  });

  it("parseGetiObjection_messageIdOnly_returnsMessageObjection", () => {
    expect(parseGetiObjection({ messageId: MESSAGE_ID })).toEqual({ kind: "message", targetId: MESSAGE_ID });
  });

  it("parseGetiObjection_bothIds_returnsNull", () => {
    expect(parseGetiObjection({ authorId: AUTHOR_ID, messageId: MESSAGE_ID })).toBeNull();
  });

  it("parseGetiObjection_neitherId_returnsNull", () => {
    expect(parseGetiObjection({})).toBeNull();
  });

  it("parseGetiObjection_fourteenDigitId_returnsNull", () => {
    expect(parseGetiObjection({ authorId: "10000000000000" })).toBeNull();
  });

  it("parseGetiObjection_fifteenDigitId_isAccepted", () => {
    expect(parseGetiObjection({ authorId: "100000000000000" })).toEqual({ kind: "author", targetId: "100000000000000" });
  });

  it("parseGetiObjection_numericId_returnsNull", () => {
    expect(parseGetiObjection({ messageId: 100000000000000901 })).toBeNull();
  });

  it("parseGetiObjection_nullBody_returnsNull", () => {
    expect(parseGetiObjection(null)).toBeNull();
  });

  it("parseGetiObjection_arrayBody_returnsNull", () => {
    expect(parseGetiObjection([AUTHOR_ID])).toBeNull();
  });
});

describe("recordGetiObjection", () => {
  it("recordGetiObjection_author_recordsItThenRemovesTheAuthorsPosts", async () => {
    const execute = writes(3);

    const removed = await recordGetiObjection(fakePool({ execute }), { kind: "author", targetId: AUTHOR_ID });

    expect(removed).toBe(3);
    expect(String(execute.mock.calls[0][0])).toContain("INSERT INTO bg_geti_objections");
    expect(execute.mock.calls[0][1]).toEqual(["author", AUTHOR_ID]);
    expect(execute).toHaveBeenLastCalledWith("DELETE FROM bg_geti_posts WHERE author_id = ?", [AUTHOR_ID]);
  });

  it("recordGetiObjection_message_removesThatMessageOnly", async () => {
    const execute = writes(1);

    await recordGetiObjection(fakePool({ execute }), { kind: "message", targetId: MESSAGE_ID });

    expect(execute).toHaveBeenLastCalledWith("DELETE FROM bg_geti_posts WHERE message_id = ?", [MESSAGE_ID]);
  });

  it("recordGetiObjection_recordedTwice_doesNotDuplicateTheObjection", async () => {
    const execute = writes(0);

    await recordGetiObjection(fakePool({ execute }), { kind: "author", targetId: AUTHOR_ID });

    expect(String(execute.mock.calls[0][0])).toContain("ON DUPLICATE KEY UPDATE");
  });
});

describe("liftGetiObjection", () => {
  it("liftGetiObjection_existing_returnsTrue", async () => {
    const execute = writes(1);

    const lifted = await liftGetiObjection(fakePool({ execute }), { kind: "author", targetId: AUTHOR_ID });

    expect(lifted).toBe(true);
    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_objections WHERE kind = ? AND target_id = ?", ["author", AUTHOR_ID]);
  });

  it("liftGetiObjection_absent_returnsFalse", async () => {
    const lifted = await liftGetiObjection(fakePool({ execute: writes(0) }), { kind: "message", targetId: MESSAGE_ID });

    expect(lifted).toBe(false);
  });
});

describe("withholdObjectedGetiPosts", () => {
  it("withholdObjectedGetiPosts_noIds_runsNoQuery", async () => {
    const execute = writes(0);

    const withheld = await withholdObjectedGetiPosts(fakePool({ execute }), []);

    expect(withheld).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("withholdObjectedGetiPosts_ids_removesOnlyTheBatchRowsAnObjectionCovers", async () => {
    const execute = writes(1);

    const withheld = await withholdObjectedGetiPosts(fakePool({ execute }), [MESSAGE_ID, "100000000000000902"]);

    expect(withheld).toBe(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("WHERE message_id IN (?, ?)");
    expect(sql).toContain("message_id IN (SELECT target_id FROM bg_geti_objections WHERE kind = 'message')");
    expect(sql).toContain("author_id IN (SELECT target_id FROM bg_geti_objections WHERE kind = 'author')");
    expect(params).toEqual([MESSAGE_ID, "100000000000000902"]);
  });
});

describe("purgeStaleGetiObjections", () => {
  it("purgeStaleGetiObjections_now_deletesMessageObjectionsOlderThanTheLongestRetention", async () => {
    const execute = writes(2);

    const purged = await purgeStaleGetiObjections(fakePool({ execute }), NOW);

    expect(purged).toBe(2);
    expect(execute).toHaveBeenCalledWith("DELETE FROM bg_geti_objections WHERE kind = 'message' AND created_at < ?", [
      new Date(NOW - 14 * DAY_MS),
    ]);
  });
});
