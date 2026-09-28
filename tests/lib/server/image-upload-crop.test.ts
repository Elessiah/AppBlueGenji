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
import sharp, { type Sharp } from "sharp";
import { storeImageBuffer } from "@/lib/server/image-upload";

/**
 * Recadrage manuel, côté serveur : `sharp` découpe la zone choisie dans la
 * modale **avant** d'appliquer le gabarit, dans le repère de l'image redressée
 * par son EXIF — celui où le navigateur l'a montrée.
 */

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

/** Image en deux moitiés : gauche rouge, droite bleue. */
async function halves(width: number, height: number): Promise<Sharp> {
  const half = Math.floor(width / 2);
  const left = await sharp({ create: { width: half, height, channels: 3, background: RED } }).png().toBuffer();
  const right = await sharp({ create: { width: width - half, height, channels: 3, background: BLUE } })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: RED } }).composite([
    { input: left, left: 0, top: 0 },
    { input: right, left: half, top: 0 },
  ]);
}

function stored(relPath: string): Buffer {
  const file = path.join(process.cwd(), "public", relPath.replace(/^\//, ""));
  const data = written.get(file);
  if (!data) throw new Error(`rien d'écrit en ${file}`);
  return data;
}

/** Couleur dominante du centre d'une image stockée. */
async function centreColour(data: Buffer): Promise<"red" | "blue" | "other"> {
  const { width = 0, height = 0 } = await sharp(data).metadata();
  const { data: px } = await sharp(data)
    .extract({ left: Math.floor(width / 2), top: Math.floor(height / 2), width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (px[0] > 200 && px[2] < 60) return "red";
  if (px[2] > 200 && px[0] < 60) return "blue";
  return "other";
}

beforeEach(() => {
  written.clear();
});

describe("storeImageBuffer — recadrage manuel", () => {
  it("sans recadrage, le gabarit « cover » garde le centre, comme avant l'outil", async () => {
    const input = await (await halves(400, 100)).png().toBuffer();
    const rel = await storeImageBuffer(input, "image/png", "avatar", 1);
    const meta = await sharp(stored(rel)).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });

  it("garde la zone choisie : la moitié bleue d'une image bicolore", async () => {
    const input = await (await halves(400, 200)).png().toBuffer();
    const rel = await storeImageBuffer(input, "image/png", "avatar", 1, { x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(await centreColour(stored(rel))).toBe("blue");
  });

  it("garde la zone choisie : la moitié rouge", async () => {
    const input = await (await halves(400, 200)).png().toBuffer();
    const rel = await storeImageBuffer(input, "image/png", "benevole-photo", 1, {
      x: 0,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(await centreColour(stored(rel))).toBe("red");
  });

  it("découpe avant le gabarit : un gabarit qui ne fait que réduire garde les proportions de la zone", async () => {
    const input = await (await halves(800, 400)).png().toBuffer();
    const rel = await storeImageBuffer(input, "image/png", "tournament-image", 3, {
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
    const meta = await sharp(stored(rel)).metadata();
    expect([meta.width, meta.height]).toEqual([400, 200]);
  });

  it("taille un bandeau 3:1 dans la zone choisie", async () => {
    const input = await (await halves(900, 900)).png().toBuffer();
    const rel = await storeImageBuffer(input, "image/png", "sponsor-banner", 2, {
      x: 0.5,
      y: 0.4,
      width: 0.5,
      height: 1 / 6,
    });
    const data = stored(rel);
    const meta = await sharp(data).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 400]);
    expect(await centreColour(data)).toBe("blue");
  });

  it("recadre dans le repère de l'image redressée par son EXIF", async () => {
    // 200 × 100 stockés, orientation 6 (rotation d'un quart de tour horaire) :
    // le navigateur montre un portrait 100 × 200 dont la moitié **haute** est
    // la moitié gauche stockée — la rouge.
    const input = await (await halves(200, 100)).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
    const rel = await storeImageBuffer(input, "image/jpeg", "avatar", 1, { x: 0, y: 0, width: 1, height: 0.5 });
    expect(await centreColour(stored(rel))).toBe("red");
    const bottom = await storeImageBuffer(input, "image/jpeg", "avatar", 1, { x: 0, y: 0.5, width: 1, height: 0.5 });
    expect(await centreColour(stored(bottom))).toBe("blue");
  });

  it("redresse une photo orientée même sans recadrage", async () => {
    const input = await (await halves(200, 100)).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
    const rel = await storeImageBuffer(input, "image/jpeg", "tournament-image", 1);
    const meta = await sharp(stored(rel)).metadata();
    expect([meta.width, meta.height]).toEqual([100, 200]);
  });
});
