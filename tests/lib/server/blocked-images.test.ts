import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "@/lib/server/database";
import { blockImageFiles, blockImageHashes, hashImageFiles, imageSha256, isBlockedImage } from "@/lib/server/blocked-images";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/*
 * E6 — l'empreinte d'un avatar en quarantaine qu'emporte un effacement reste,
 * et refuse la remise en ligne de la même image (`IMAGE_BLOCKED`).
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

describe("blockImageFiles", () => {
  it("blockImageFiles_readableFile_insertsSha256OnConnection", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);

    expect(await blockImageFiles(fakeConnection({ execute }), [file])).toEqual([imageSha256(IMAGE)]);
    expect(execute.mock.calls[0][0]).toContain("INSERT IGNORE INTO bg_blocked_image_hashes");
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE)]);
  });

  it("blockImageFiles_unreadableFile_skipped", async () => {
    const execute = jest.fn<SqlQuery>();

    expect(await blockImageFiles(fakeConnection({ execute }), [join(tmpdir(), "bg-absent-avatar.webp")])).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
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
      ["INSERT IGNORE INTO bg_blocked_image_hashes (sha256) VALUES (?)", ["aa"]],
      ["INSERT IGNORE INTO bg_blocked_image_hashes (sha256) VALUES (?)", ["bb"]],
    ]);
  });

  it("blockImageHashes_missingTable_doesNotThrow", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(missingTable);

    await expect(blockImageHashes(fakeConnection({ execute }), ["aa"])).resolves.toBeUndefined();
  });
});
