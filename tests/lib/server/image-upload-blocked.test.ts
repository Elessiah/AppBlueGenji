import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("node:fs/promises", () => ({
  mkdir: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
  writeFile: jest.fn(async () => undefined),
}));
jest.mock("@/lib/server/blocked-images", () => ({ IMAGE_BLOCKED: "IMAGE_BLOCKED", isBlockedImage: jest.fn() }));

import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { isBlockedImage } from "@/lib/server/blocked-images";
import { storeImageBuffer } from "@/lib/server/image-upload";

/*
 * E6 — un avatar ou un logo dont l'image traitée est bloquée (avatar en
 * quarantaine d'un compte effacé) est refusé avec `IMAGE_BLOCKED`, sans rien
 * écrire sur le disque.
 */

const png = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 90, g: 200, b: 255 } } }).png().toBuffer();

beforeEach(() => {
  jest.clearAllMocks();
});

describe("storeImageBuffer — image bloquée", () => {
  it("storeImageBuffer_blockedAvatar_throwsImageBlockedWithoutWriting", async () => {
    jest.mocked(isBlockedImage).mockResolvedValue(true);

    await expect(storeImageBuffer(await png(), "image/png", "avatar", 7)).rejects.toThrow("IMAGE_BLOCKED");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("storeImageBuffer_blockedTeamLogo_throwsImageBlocked", async () => {
    jest.mocked(isBlockedImage).mockResolvedValue(true);

    await expect(storeImageBuffer(await png(), "image/png", "team-logo", 3)).rejects.toThrow("IMAGE_BLOCKED");
  });

  it("storeImageBuffer_rawUploadMatchesBlockedHash_refusedImageBlocked", async () => {
    // La copie exacte d'un avatar servi : c'est le fichier brut qui est bloqué.
    const upload = await png();
    jest.mocked(isBlockedImage).mockImplementation(async (...contents) => contents.some((content) => content.equals(upload)));

    await expect(storeImageBuffer(upload, "image/png", "avatar", 7)).rejects.toThrow("IMAGE_BLOCKED");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("storeImageBuffer_notBlockedAvatar_writesFile", async () => {
    jest.mocked(isBlockedImage).mockResolvedValue(false);

    await expect(storeImageBuffer(await png(), "image/png", "avatar", 7)).resolves.toMatch(/^\/uploads\//);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("storeImageBuffer_otherKind_neverChecksBlocklist", async () => {
    await storeImageBuffer(await png(), "image/png", "benevole-photo", 7);

    expect(isBlockedImage).not.toHaveBeenCalled();
  });
});
