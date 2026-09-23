import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// Le disque est simulé : on garde les octets écrits pour les relire avec sharp.
const written = new Map<string, Buffer>();
jest.mock("node:fs/promises", () => ({
  mkdir: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
  writeFile: jest.fn(async (file: string, data: Buffer) => {
    written.set(String(file), Buffer.from(data));
  }),
}));

import path from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import sharp from "sharp";
import { deleteStoredImage, storeImageBuffer } from "@/lib/server/image-upload";

/**
 * Gabarit `tournament-image` : l'image d'un tournoi est stockée **sans
 * recadrage**. C'est ce qui rend le système permissif sur les dimensions — le
 * cadrage se décide au rendu (point focal, mode logo), jamais à l'envoi.
 */

async function png(width: number, height: number, alpha = 1): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 90, g: 200, b: 255, alpha } },
  })
    .png()
    .toBuffer();
}

async function storedMeta(relPath: string) {
  const file = path.join(process.cwd(), "public", relPath.replace(/^\//, ""));
  const data = written.get(file);
  if (!data) throw new Error(`rien d'écrit en ${file}`);
  return sharp(data).metadata();
}

beforeEach(() => {
  written.clear();
  jest.clearAllMocks();
});

describe("storeImageBuffer — gabarit tournament-image", () => {
  it("range le fichier sous /uploads/tournaments/, au nom du tournoi", async () => {
    const rel = await storeImageBuffer(await png(800, 300), "image/png", "tournament-image", 42);
    expect(rel).toMatch(/^\/uploads\/tournaments\/42-[0-9a-f]{16}\.webp$/);
    // Le dossier d'un gabarit récent peut manquer sur un serveur déjà déployé.
    expect(mkdir).toHaveBeenCalledWith(path.join(process.cwd(), "public", "uploads", "tournaments"), {
      recursive: true,
    });
  });

  it("garde les proportions d'une bannière très large, sans la rogner", async () => {
    const meta = await storedMeta(await storeImageBuffer(await png(1200, 300), "image/png", "tournament-image", 1));
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([1200, 300]);
  });

  it("garde les proportions d'un portrait", async () => {
    const meta = await storedMeta(await storeImageBuffer(await png(300, 900), "image/png", "tournament-image", 1));
    expect([meta.width, meta.height]).toEqual([300, 900]);
  });

  it("n'agrandit jamais une petite image", async () => {
    const meta = await storedMeta(await storeImageBuffer(await png(64, 48), "image/png", "tournament-image", 1));
    expect([meta.width, meta.height]).toEqual([64, 48]);
  });

  it("réduit une grande image à 1600 px sur son plus grand côté, proportions gardées", async () => {
    const wide = await storedMeta(await storeImageBuffer(await png(4000, 1000), "image/png", "tournament-image", 1));
    expect([wide.width, wide.height]).toEqual([1600, 400]);
    const tall = await storedMeta(await storeImageBuffer(await png(1000, 3200), "image/png", "tournament-image", 1));
    expect([tall.width, tall.height]).toEqual([500, 1600]);
  });

  it("conserve la transparence d'un logo", async () => {
    const meta = await storedMeta(
      await storeImageBuffer(await png(256, 256, 0), "image/png", "tournament-image", 1),
    );
    expect(meta.hasAlpha).toBe(true);
  });

  it("applique les mêmes refus qu'un autre téléversement", async () => {
    await expect(storeImageBuffer(await png(10, 10), "image/gif", "tournament-image", 1)).rejects.toThrow(
      "IMAGE_FORMAT_INVALID",
    );
    await expect(storeImageBuffer(await png(10, 10), "image/jpeg", "tournament-image", 1)).rejects.toThrow(
      "IMAGE_FORMAT_INVALID",
    );
    await expect(
      storeImageBuffer(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png", "tournament-image", 1),
    ).rejects.toThrow("IMAGE_TOO_LARGE");
    expect(written.size).toBe(0);
  });

  it("ne touche pas aux gabarits existants (un logo d'équipe reste un carré 512)", async () => {
    const meta = await storedMeta(await storeImageBuffer(await png(1200, 300), "image/png", "team-logo", 1));
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });
});

describe("deleteStoredImage — dossier des tournois", () => {
  it("efface un fichier d'image de tournoi", async () => {
    await deleteStoredImage("/uploads/tournaments/42-abc.webp");
    expect(unlink).toHaveBeenCalledWith(path.join(process.cwd(), "public", "uploads", "tournaments", "42-abc.webp"));
  });

  it("refuse toujours une remontée de dossier", async () => {
    await deleteStoredImage("/uploads/tournaments/../../.env");
    expect(unlink).not.toHaveBeenCalled();
  });
});
