import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/stored-upload-cleanup");

import { keptStoredUpload } from "@/lib/server/kept-stored-upload";
import { storedUploadExists } from "@/lib/server/stored-upload-cleanup";

/**
 * Image d'un ajout (partenaire, bénévole) : gardée, sauf un fichier du dossier
 * qui n'existe plus — un ajout rejoué après la suppression de la ligne la
 * recréerait sur une image absente (EF-69, EF-70).
 */
const LOGO = "/api/uploads/sponsors/5-logo.webp";

describe("keptStoredUpload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keptStoredUpload_nonString_returnsNull", async () => {
    const kept = await keptStoredUpload(42, "sponsors");

    expect(kept).toBeNull();
    expect(storedUploadExists).not.toHaveBeenCalled();
  });

  it("keptStoredUpload_storedFileMissing_returnsNull", async () => {
    jest.mocked(storedUploadExists).mockResolvedValue(false);

    expect(await keptStoredUpload(LOGO, "sponsors")).toBeNull();
  });

  it("keptStoredUpload_storedFileExists_returnsOriginalValue", async () => {
    jest.mocked(storedUploadExists).mockResolvedValue(true);

    expect(await keptStoredUpload(LOGO, "sponsors")).toBe(LOGO);
  });

  it("keptStoredUpload_foreignUrl_keptWithoutDiskCheck", async () => {
    const kept = await keptStoredUpload("https://example.org/logo.png", "sponsors");

    expect(kept).toBe("https://example.org/logo.png");
    expect(storedUploadExists).not.toHaveBeenCalled();
  });

  it("keptStoredUpload_otherFolderUpload_keptWithoutDiskCheck", async () => {
    const kept = await keptStoredUpload("/api/uploads/benevoles/7-abc.webp", "sponsors");

    expect(kept).toBe("/api/uploads/benevoles/7-abc.webp");
    expect(storedUploadExists).not.toHaveBeenCalled();
  });

  it("keptStoredUpload_paddedStoredUrl_checksTrimmedUrl", async () => {
    jest.mocked(storedUploadExists).mockResolvedValue(true);

    await keptStoredUpload(`  ${LOGO}  `, "sponsors");

    expect(storedUploadExists).toHaveBeenCalledWith(LOGO, "sponsors");
  });
});
