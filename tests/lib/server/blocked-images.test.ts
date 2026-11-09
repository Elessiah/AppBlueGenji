import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "@/lib/server/database";
import { blockImageHashes, blockRemovedImageFiles, hashImageFiles, imageSha256, isBlockedImage } from "@/lib/server/blocked-images";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/*
 * E6 / D6 — l'empreinte d'un avatar supprimé par la modération reste, et refuse
 * la remise en ligne de la même image (`IMAGE_BLOCKED`).
 */

const IMAGE = Buffer.from("image webp traitée");
const missingTable = Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE" });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("isBlockedImage", () => {
  it("isBlockedImage_hashPresent_true", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ 1: 1 }], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    expect(await isBlockedImage(IMAGE)).toBe(true);
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE)]);
  });

  it("isBlockedImage_twoContents_queriesBothHashesInOneStatement", async () => {
    const raw = Buffer.from("fichier tel que téléversé");
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await isBlockedImage(IMAGE, raw);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain("sha256 IN (?, ?)");
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE), imageSha256(raw)]);
  });

  it("isBlockedImage_noContent_falseWithoutQuery", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    expect(await isBlockedImage()).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("isBlockedImage_hashAbsent_false", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[], []]) }));

    expect(await isBlockedImage(IMAGE)).toBe(false);
  });

  it("isBlockedImage_missingTable_false", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockRejectedValue(missingTable) }));

    expect(await isBlockedImage(IMAGE)).toBe(false);
  });

  it("isBlockedImage_otherError_throws", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockRejectedValue(new Error("DB_DOWN")) }));

    await expect(isBlockedImage(IMAGE)).rejects.toThrow("DB_DOWN");
  });
});

describe("blockRemovedImageFiles", () => {
  it("blockRemovedImageFiles_readableFile_insertsSha256OnPool", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockRemovedImageFiles([file]);

    expect(execute.mock.calls[0][0]).toContain("INSERT IGNORE INTO bg_blocked_image_hashes");
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE)]);
  });

  it("blockRemovedImageFiles_unreadableFile_noQuery", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockRemovedImageFiles([join(tmpdir(), "bg-absent-avatar.webp")]);

    expect(execute).not.toHaveBeenCalled();
  });

  it("blockRemovedImageFiles_noFile_noDatabase", async () => {
    await blockRemovedImageFiles([]);

    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("blockRemovedImageFiles_databaseError_loggedNeverThrown", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockRejectedValue(new Error("DB_DOWN")) }));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(blockRemovedImageFiles([file])).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("hashImageFiles", () => {
  it("hashImageFiles_readableAndMissingFiles_skipsMissingAndKeepsReadableHashes", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);

    const hashes = await hashImageFiles([join(tmpdir(), "bg-absent-avatar.webp"), file]);

    expect(hashes).toEqual([imageSha256(IMAGE)]);
  });

  it("hashImageFiles_noFile_returnsEmpty", async () => {
    expect(await hashImageFiles([])).toEqual([]);
  });
});

describe("blockImageHashes", () => {
  it("blockImageHashes_hashes_insertsEachIgnoringDuplicates", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);

    await blockImageHashes(fakeConnection({ execute }), ["aa", "bb"]);

    expect(execute.mock.calls.map(([sql, params]) => [String(sql), params])).toEqual([
      ["INSERT IGNORE INTO bg_blocked_image_hashes (sha256) VALUES (?), (?)", ["aa", "bb"]],
    ]);
  });

  it("blockImageHashes_duplicateHashes_insertedOnce", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);

    await blockImageHashes(fakeConnection({ execute }), ["aa", "aa"]);

    expect(execute.mock.calls[0][1]).toEqual(["aa"]);
  });

  it("blockImageHashes_noHash_noQuery", async () => {
    const execute = jest.fn<SqlQuery>();

    await blockImageHashes(fakeConnection({ execute }), []);

    expect(execute).not.toHaveBeenCalled();
  });

  it("blockImageHashes_missingTable_doesNotThrow", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(missingTable);

    await expect(blockImageHashes(fakeConnection({ execute }), ["aa"])).resolves.toBeUndefined();
  });
});
