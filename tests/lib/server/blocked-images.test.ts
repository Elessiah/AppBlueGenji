import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { getDatabase } from "@/lib/server/database";
import { imagePerceptualHash, PHASH_MATCH_DISTANCE } from "@/lib/server/image-phash";
import {
  blockImageHashOn,
  blockImageHashesSafely,
  blockRemovedImageFiles,
  imageSha256,
  isBlockedImage,
  pinAccountBlockedHashesOn,
  pinClosedQuarantineHashesOn,
  readImageFingerprint,
  retireAccountQuarantinesOn,
  unblockImageHashOn,
} from "@/lib/server/blocked-images";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/*
 * E6 / D6 — l'empreinte d'un avatar supprimé par la modération reste, et refuse
 * la remise en ligne de la même image (`IMAGE_BLOCKED`).
 */

// Octets qui ne sont pas une image : pas d'empreinte perceptuelle, SHA-256 seul.
const IMAGE = Buffer.from("image webp traitée");

/** Une vraie image, avec du dessin : elle a une empreinte perceptuelle. */
async function drawnImage(): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#123456"/><circle cx="90" cy="100" r="60" fill="#f0c040"/><rect x="140" y="150" width="90" height="80" fill="#e04080"/></svg>`,
    ),
  )
    .webp({ quality: 80 })
    .toBuffer();
}
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

  it("isBlockedImage_notAnImage_queriesSha256Only", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await isBlockedImage(IMAGE);

    expect(execute.mock.calls[0][0]).not.toContain("BIT_COUNT");
  });

  // EF-72 / D17 : l'allure de l'image traitée est comparée en SQL, au seuil commun.
  it("isBlockedImage_drawnImage_addsPerceptualComparisonWithThreshold", async () => {
    const image = await drawnImage();
    const raw = Buffer.from("fichier tel que téléversé");
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await isBlockedImage(image, raw);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain(
      "WHERE sha256 IN (?, ?) OR (phash IS NOT NULL AND BIT_COUNT(phash ^ CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)) <= ?) LIMIT 1",
    );
    expect(execute.mock.calls[0][1]).toEqual([
      imageSha256(image),
      imageSha256(raw),
      await imagePerceptualHash(image),
      PHASH_MATCH_DISTANCE,
    ]);
  });

  it("isBlockedImage_perceptualMatchFound_true", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[{ 1: 1 }], []]) }));

    expect(await isBlockedImage(await drawnImage())).toBe(true);
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

// MySQL 8, requête préparée : `CAST(? AS UNSIGNED)` d'une chaîne plafonne à 2^63 − 1.
it("blockedImagesSql_phashParameters_castThroughDecimalNeverDirectlyToUnsigned", () => {
  const source = readFileSync(join(process.cwd(), "lib", "server", "blocked-images.ts"), "utf8");
  const quarantine = readFileSync(join(process.cwd(), "lib", "server", "logo-quarantine.ts"), "utf8");

  expect(source).not.toContain("CAST(? AS UNSIGNED)");
  expect(quarantine).not.toContain("CAST(? AS UNSIGNED)");
});

describe("blockRemovedImageFiles", () => {
  it("blockRemovedImageFiles_readableFile_insertsSha256OnPool", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockRemovedImageFiles([file]);

    // Geste sans ligne qui le justifie : blocage non levable (revue sécurité #571, D18).
    expect(execute.mock.calls[0][0]).toContain(
      "INSERT INTO bg_blocked_image_hashes (sha256, phash, created_at) VALUES (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), CURRENT_DATE)",
    );
    expect(execute.mock.calls[0][0]).toContain("ON DUPLICATE KEY UPDATE liftable = 0, phash = COALESCE(phash, VALUES(phash))");
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE), null]);
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

// Revue sécurité #571, cycle 3 : l'insertion n'est plus exportée, elle se vérifie par l'API publique.
describe("blockRemovedImageFiles — jour donné (revue juridique #571, D31)", () => {
  function setup() {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    return { file, execute };
  }

  it("blockRemovedImageFiles_dayGiven_datesNewHashWithThatDay", async () => {
    const { file, execute } = setup();

    await blockRemovedImageFiles([file], { day: "2026-10-03" });

    expect(execute.mock.calls[0][0]).toContain("VALUES (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), ?)");
    expect(execute.mock.calls[0][0]).not.toContain("CURRENT_DATE");
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE), null, "2026-10-03"]);
  });

  it("blockRemovedImageFiles_dayGivenLiftable_datesNewHashWithThatDay", async () => {
    const { file, execute } = setup();

    await blockRemovedImageFiles([file], { liftable: true, day: "2026-10-03" });

    expect(execute.mock.calls[0][0]).toContain(
      "INSERT INTO bg_blocked_image_hashes (sha256, phash, liftable, created_at) VALUES (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), 1, ?)",
    );
    expect(execute.mock.calls[0][0]).toContain("ON DUPLICATE KEY UPDATE phash = COALESCE(phash, VALUES(phash))");
    expect(execute.mock.calls[0][0]).not.toContain("liftable = 0");
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE), null, "2026-10-03"]);
  });

  it("blockRemovedImageFiles_malformedDay_fallsBackToCurrentDate", async () => {
    const { file, execute } = setup();

    await blockRemovedImageFiles([file], { day: "2026-10-03 21:14:00" });

    expect(execute.mock.calls[0][0]).toContain("VALUES (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), CURRENT_DATE)");
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE), null]);
  });
});

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

    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(execute.mock.calls[0][0])).toContain(
      "VALUES (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), CURRENT_DATE), (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), CURRENT_DATE)",
    );
    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE), null, imageSha256(other), null]);
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
    expect(String(error.mock.calls[0][0])).toContain("empreinte non bloquée (1 fichier(s)) : avatar.webp");
    error.mockRestore();
  });

  it("blockRemovedImageFiles_quarantinedFileMissing_logsNameWithoutAccountIds", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>() }));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await blockRemovedImageFiles([join(tmpdir(), "user-42-42-abc123.webp")]);

    const line = String(error.mock.calls[0][0]);
    expect(line).toContain(": abc123.webp");
    expect(line).not.toContain("42");
    error.mockRestore();
  });

  it("blockRemovedImageFiles_onePathMissing_logsAndBlocksTheOther", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await blockRemovedImageFiles([join(tmpdir(), "bg-absent-avatar.webp"), writeImage(IMAGE)]);

    expect(execute.mock.calls[0][1]).toEqual([imageSha256(IMAGE), null]);
    expect(String(error.mock.calls[0][0])).toContain("empreinte non bloquée (1 fichier(s))");
    error.mockRestore();
  });
});

describe("unblockImageHashOn (D18)", () => {
  it("unblockImageHashOn_otherUpholdingRemoval_keepsHash", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[{ 1: 1 }], []]);

    expect(await unblockImageHashOn(fakeConnection({ execute }), "abc", 30)).toBe(false);

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("LOCK IN SHARE MODE");
    expect(sql).toContain("status = 'PURGED' AND hash_blocked = 1");
    expect(params).toEqual(["abc", 30]);
  });

  it("unblockImageHashOn_noOtherRemoval_deletesHash", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    expect(await unblockImageHashOn(fakeConnection({ execute }), "abc", 30)).toBe(true);

    expect(execute.mock.calls[1][0]).toContain("DELETE FROM bg_blocked_image_hashes WHERE sha256 = ? AND liftable = 1");
    expect(execute.mock.calls[1][1]).toEqual(["abc"]);
  });

  it("unblockImageHashOn_missingTable_returnsFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[], []]).mockRejectedValueOnce(missingTable);

    expect(await unblockImageHashOn(fakeConnection({ execute }), "abc", 30)).toBe(false);
  });
});

describe("blockImageHashOn (D22)", () => {
  it("blockImageHashOn_newHash_insertsLiftableKeepingExistingState", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);

    await blockImageHashOn(fakeConnection({ execute }), { sha256: "abc", phash: "123" });

    // D31 : datée du jour seulement ; D17 : l'empreinte perceptuelle suit.
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain(
      "INSERT INTO bg_blocked_image_hashes (sha256, phash, liftable, created_at) VALUES (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), 1, CURRENT_DATE)",
    );
    expect(sql).toContain("ON DUPLICATE KEY UPDATE phash = COALESCE(phash, VALUES(phash))");
    expect(sql).not.toContain("liftable = 0");
    expect(params).toEqual(["abc", "123"]);
  });
});

describe("blockRemovedImageFiles — blocage levable (revue sécurité #571, cycle 3)", () => {
  it("blockRemovedImageFiles_liftable_insertsLiftableKeepingExistingState", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, IMAGE);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockRemovedImageFiles([file], { liftable: true });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain(
      "INSERT INTO bg_blocked_image_hashes (sha256, phash, liftable, created_at) VALUES (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), 1, CURRENT_DATE)",
    );
    expect(sql).not.toContain("liftable = 0");
    expect(params).toEqual([imageSha256(IMAGE), null]);
  });
});

describe("pinAccountBlockedHashesOn (revue sécurité #571, D18)", () => {
  it("pinAccountBlockedHashesOn_account_pinsHashesItsRemovalsBlocked", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 2 }, []]);

    await pinAccountBlockedHashesOn(fakeConnection({ execute }), 7);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("INSERT INTO bg_blocked_image_hashes (sha256, phash, liftable, created_at)");
    expect(sql).toContain("WHERE user_id = ? AND status = 'PURGED' AND image_sha256 IS NOT NULL");
    // Cycle 3 : une suppression dont la contestation attendait son issue est comprise.
    expect(sql).toContain("AND (contest_outcome IS NULL OR contest_outcome = 'UPHELD')");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE liftable = 0");
    expect(params).toEqual([7]);
  });

  // D31 : jour de la suppression la plus ancienne, jamais l'instant de l'effacement.
  it("pinAccountBlockedHashesOn_account_datesHashFromOldestRemovalDay", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);

    await pinAccountBlockedHashesOn(fakeConnection({ execute }), 7);

    const [sql] = execute.mock.calls[0];
    // Revue juridique #571 : jour de la purge, à défaut du masquage.
    expect(sql).toContain(
      "SELECT image_sha256, MAX(image_phash), 0, DATE(MIN(COALESCE(closed_at, hidden_at))) FROM bg_logo_quarantines",
    );
    expect(sql).toContain("GROUP BY image_sha256");
    expect(sql).not.toContain("NOW()");
  });

  it("pinAccountBlockedHashesOn_missingTable_resolves", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(missingTable);

    await expect(pinAccountBlockedHashesOn(fakeConnection({ execute }), 7)).resolves.toBeUndefined();
  });
});

describe("readImageFingerprint", () => {
  it("readImageFingerprint_drawnImage_returnsBothHashes", async () => {
    const image = await drawnImage();
    const file = join(mkdtempSync(join(tmpdir(), "bg-sha-")), "a.webp");
    writeFileSync(file, image);

    expect(await readImageFingerprint(file)).toEqual({
      sha256: imageSha256(image),
      phash: await imagePerceptualHash(image),
    });
  });

  it("readImageFingerprint_notAnImage_returnsSha256WithoutPhash", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bg-sha-")), "a.webp");
    writeFileSync(file, IMAGE);

    expect(await readImageFingerprint(file)).toEqual({ sha256: imageSha256(IMAGE), phash: null });
  });

  it("readImageFingerprint_missingFile_returnsNull", async () => {
    expect(await readImageFingerprint(join(tmpdir(), "absent-bg-sha.webp"))).toBeNull();
  });
});

describe("blockRemovedImageFiles — empreinte perceptuelle (D17)", () => {
  it("blockRemovedImageFiles_drawnImage_insertsSha256AndPhash", async () => {
    const image = await drawnImage();
    const file = join(mkdtempSync(join(tmpdir(), "bg-blocked-")), "avatar.webp");
    writeFileSync(file, image);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockRemovedImageFiles([file]);

    expect(execute.mock.calls[0][1]).toEqual([imageSha256(image), await imagePerceptualHash(image)]);
  });
});

describe("blockImageHashesSafely", () => {
  it("blockImageHashesSafely_failsTwice_logsHashesWithoutThrowing", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("pool saturé"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(blockImageHashesSafely([{ sha256: "abc", phash: null }])).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("abc"), "Error");
    logged.mockRestore();
  });

  it("blockImageHashesSafely_failsTwice_logsPhashForManualBlock", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockRejectedValue(new Error("pool saturé")) }));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await blockImageHashesSafely([{ sha256: "abc", phash: "123" }]);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("abc (phash 123)"), "Error");
    logged.mockRestore();
  });

  it("blockImageHashesSafely_sameShaWithAndWithoutPhash_insertsOnceWithPhash", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockImageHashesSafely([
      { sha256: "abc", phash: null },
      { sha256: "abc", phash: "123" },
    ]);

    expect(execute.mock.calls[0][1]).toEqual(["abc", "123"]);
  });

  it("blockImageHashesSafely_empty_noQuery", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await blockImageHashesSafely([]);

    expect(execute).not.toHaveBeenCalled();
  });
});

describe("retireAccountQuarantinesOn (D31)", () => {
  it("retireAccountQuarantinesOn_account_pinsThenDeletesQuarantineRowsOnConnection", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);

    await retireAccountQuarantinesOn(fakeConnection({ execute }), 7);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toContain("INSERT INTO bg_blocked_image_hashes");
    expect(execute.mock.calls[1]).toEqual(["DELETE FROM bg_logo_quarantines WHERE user_id = ?", [7]]);
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("retireAccountQuarantinesOn_missingTable_resolves", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(missingTable);

    await expect(retireAccountQuarantinesOn(fakeConnection({ execute }), 7)).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("retireAccountQuarantinesOn_deleteFails_rejects", async () => {
    const deadlock = Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" });
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockRejectedValueOnce(deadlock);

    await expect(retireAccountQuarantinesOn(fakeConnection({ execute }), 7)).rejects.toBe(deadlock);
  });
});

describe("pinClosedQuarantineHashesOn (D87)", () => {
  it("pinClosedQuarantineHashesOn_ids_pinsOnlyBlockedPurgedHashesNonLiftable", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);

    await pinClosedQuarantineHashesOn(fakeConnection({ execute }), [4, 9]);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("WHERE id IN (?, ?)");
    expect(sql).toContain("AND status = 'PURGED' AND hash_blocked = 1 AND image_sha256 IS NOT NULL");
    expect(sql).toContain("SELECT image_sha256, MAX(image_phash), 0, DATE(MIN(COALESCE(closed_at, hidden_at)))");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE liftable = 0, phash = COALESCE(phash, VALUES(phash))");
    expect(params).toEqual([4, 9]);
  });

  it("pinClosedQuarantineHashesOn_noIds_noQuery", async () => {
    const execute = jest.fn<SqlQuery>();

    await pinClosedQuarantineHashesOn(fakeConnection({ execute }), []);

    expect(execute).not.toHaveBeenCalled();
  });

  it("pinClosedQuarantineHashesOn_missingTable_ignored", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(missingTable);

    await expect(pinClosedQuarantineHashesOn(fakeConnection({ execute }), [4])).resolves.toBeUndefined();
  });
});
