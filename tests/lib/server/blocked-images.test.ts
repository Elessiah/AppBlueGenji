import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "@/lib/server/database";
import { blockRemovedImageFiles, hashImageFiles, imageSha256, isBlockedImage } from "@/lib/server/blocked-images";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

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

  // Revue sécurité #571, cycle 2 : le fichier part juste après — un échec passager
  // est repris, un échec durable laisse l'empreinte dans le journal pour la poser.
  it("blockRemovedImageFiles_transientDatabaseError_retriedOnce", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);
    const execute = jest.fn<SqlQuery>()
      .mockRejectedValueOnce(new Error("LOCK_WAIT_TIMEOUT"))
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockRemovedImageFiles([file]);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("blockRemovedImageFiles_persistentDatabaseError_logsHashForManualBlock", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("DB_DOWN"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await blockRemovedImageFiles([file]);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0][0])).toContain(imageSha256(IMAGE));
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

// Revue sécurité #571, cycle 3 : l'insertion n'est plus exportée, elle se vérifie par l'API publique.
describe("blockRemovedImageFiles — insertion et fichiers manquants", () => {
  function writeImage(content: Buffer): string {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, content);
    return file;
  }

  it("blockRemovedImageFiles_duplicateHashes_insertedOnceInOneStatement", async () => {
    const other = Buffer.from("autre image");
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockRemovedImageFiles([writeImage(IMAGE), writeImage(IMAGE), writeImage(other)]);

    expect(execute.mock.calls.map(([sql, params]) => [String(sql), params])).toEqual([
      ["INSERT IGNORE INTO bg_blocked_image_hashes (sha256) VALUES (?), (?)", [imageSha256(IMAGE), imageSha256(other)]],
    ]);
  });

  it("blockRemovedImageFiles_missingTable_doesNotThrow", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(missingTable);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(blockRemovedImageFiles([writeImage(IMAGE)])).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("blockRemovedImageFiles_fileMissing_logsErrorAndInsertsNothing", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await blockRemovedImageFiles([join(tmpdir(), "bg-absent-avatar.webp")]);

    expect(execute).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0][0])).toContain("empreinte non bloquée (1 fichier(s))");
    error.mockRestore();
  });

  it("blockRemovedImageFiles_onePathMissing_logsAndBlocksTheOther", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await blockRemovedImageFiles([join(tmpdir(), "bg-absent-avatar.webp"), writeImage(IMAGE)]);

    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE)]);
    expect(String(error.mock.calls[0][0])).toContain("empreinte non bloquée (1 fichier(s))");
    error.mockRestore();
  });
});
