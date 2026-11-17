import { describe, expect, it } from "@jest/globals";
import sharp from "sharp";
import {
  imagePerceptualHash,
  PHASH_MATCH_DISTANCE,
  perceptualHashFromGrey,
  phashDistance,
} from "@/lib/server/image-phash";

/*
 * EF-72 / D17 — empreinte perceptuelle des avatars bloqués
 * (`docs/features/BLOCKED_IMAGE_PHASH.md`). Les images sont de synthèse,
 * tirées d'une graine : mêmes octets à chaque passage, mesures stables.
 */

const SOURCE_SIZE = 600;

/** Générateur pseudo-aléatoire déterministe (congruence linéaire). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Une scène de synthèse : dégradé et six formes colorées, tirés de la graine. */
function scene(seed: number): Buffer {
  const random = seeded(seed);
  const hue = Math.floor(random() * 360);
  const parts = [
    `<defs><linearGradient id="g" x1="0" y1="0" x2="${random()}" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,${20 + random() * 40}%)"/><stop offset="1" stop-color="hsl(${(hue + 120) % 360},60%,${30 + random() * 50}%)"/></linearGradient></defs>`,
    `<rect width="${SOURCE_SIZE}" height="${SOURCE_SIZE}" fill="url(#g)"/>`,
  ];
  for (let i = 0; i < 6; i += 1) {
    const colour = `hsl(${Math.floor(random() * 360)},${50 + random() * 50}%,${20 + random() * 60}%)`;
    parts.push(
      random() < 0.5
        ? `<circle cx="${random() * 600}" cy="${random() * 600}" r="${40 + random() * 160}" fill="${colour}"/>`
        : `<rect x="${random() * 500}" y="${random() * 500}" width="${60 + random() * 250}" height="${60 + random() * 250}" fill="${colour}" transform="rotate(${random() * 90} 300 300)"/>`,
    );
  }
  return svg(parts.join(""));
}

/** Silhouette (tête et buste) : même disposition, couleurs et tailles au choix. */
function silhouette(skin: string, radius: number, background: string): Buffer {
  return svg(
    `<rect width="600" height="600" fill="${background}"/><circle cx="300" cy="230" r="${radius}" fill="${skin}"/><ellipse cx="300" cy="560" rx="${radius * 2}" ry="200" fill="${skin}"/>`,
  );
}

function svg(body: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SOURCE_SIZE}" height="${SOURCE_SIZE}">${body}</svg>`);
}

/** Le gabarit avatar de `storeImageBuffer` : cadre éventuel, 256 × 256 `cover`, WebP 80. */
async function storedAvatar(
  source: Buffer,
  crop?: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  const pipeline = sharp(source, { autoOrient: true });
  if (crop) pipeline.extract(crop);
  return pipeline.resize(256, 256, { fit: "cover", position: "centre" }).webp({ quality: 80 }).toBuffer();
}

async function hashOf(content: Buffer): Promise<string> {
  const hash = await imagePerceptualHash(content);
  if (hash === null) throw new Error("image sans empreinte");
  return hash;
}

async function sourcePng(seed: number): Promise<Buffer> {
  return sharp(scene(seed)).png().toBuffer();
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe("imagePerceptualHash — même image, autre version", () => {
  it("imagePerceptualHash_jpegSource_withinTwoBits", async () => {
    const png = await sourcePng(1);
    const stored = await hashOf(await storedAvatar(png));

    const fromJpeg = await hashOf(await storedAvatar(await sharp(png).jpeg({ quality: 70 }).toBuffer()));

    expect(phashDistance(stored, fromJpeg)).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileReencodedAsPng_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(2));

    const reencoded = await sharp(stored).png().toBuffer();

    expect(phashDistance(await hashOf(stored), await hashOf(reencoded))).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileReencodedAsLowQualityJpeg_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(3));

    const reencoded = await sharp(stored).jpeg({ quality: 50 }).toBuffer();

    expect(phashDistance(await hashOf(stored), await hashOf(reencoded))).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileResizedSmall_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(4));

    const small = await sharp(stored).resize(96, 96).png().toBuffer();

    expect(phashDistance(await hashOf(stored), await hashOf(small))).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileResizedLarge_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(5));

    const large = await sharp(stored).resize(1024, 1024).jpeg().toBuffer();

    expect(phashDistance(await hashOf(stored), await hashOf(large))).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileUploadedAgainThroughPipeline_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(6));

    const again = await storedAvatar(stored);

    expect(phashDistance(await hashOf(stored), await hashOf(again))).toBeLessThanOrEqual(2);
  });

  it.each(SEEDS)("imagePerceptualHash_cropShiftedByTwoAndAHalfPercent_matches (graine %i)", async (seed) => {
    const png = await sourcePng(seed);
    const stored = await hashOf(await storedAvatar(png));

    const shifted = await hashOf(await storedAvatar(png, { left: 15, top: 15, width: 585, height: 585 }));

    expect(phashDistance(stored, shifted)).toBeLessThanOrEqual(PHASH_MATCH_DISTANCE);
  });

  it("imagePerceptualHash_cropShiftedFivePercent_matches", async () => {
    const png = await sourcePng(1);
    const stored = await hashOf(await storedAvatar(png));

    const shifted = await hashOf(await storedAvatar(png, { left: 30, top: 30, width: 570, height: 570 }));

    expect(phashDistance(stored, shifted)).toBeLessThanOrEqual(PHASH_MATCH_DISTANCE);
  });
});

describe("imagePerceptualHash — images différentes", () => {
  it("imagePerceptualHash_distinctScenes_allPairsBeyondThreshold", async () => {
    const hashes = await Promise.all(SEEDS.map(async (seed) => hashOf(await storedAvatar(await sourcePng(seed)))));

    const closest = Math.min(
      ...hashes.flatMap((a, i) => hashes.slice(i + 1).map((b) => phashDistance(a, b))),
    );

    expect(closest).toBeGreaterThan(PHASH_MATCH_DISTANCE);
  });

  it("imagePerceptualHash_sameLayoutOtherColours_beyondThreshold", async () => {
    const light = await hashOf(await storedAvatar(silhouette("#e0b090", 110, "#204060")));

    const dark = await hashOf(await storedAvatar(silhouette("#e0e0e0", 90, "#101010")));

    expect(phashDistance(light, dark)).toBeGreaterThan(PHASH_MATCH_DISTANCE);
  });

  it("imagePerceptualHash_sameLayoutOtherBackground_beyondThreshold", async () => {
    const blue = await hashOf(await storedAvatar(silhouette("#e0b090", 110, "#204060")));

    const pale = await hashOf(await storedAvatar(silhouette("#e0b090", 110, "#f4f4f4")));

    expect(phashDistance(blue, pale)).toBeGreaterThan(PHASH_MATCH_DISTANCE);
  });
});

describe("imagePerceptualHash — sans empreinte", () => {
  it("imagePerceptualHash_solidColour_returnsNull", async () => {
    const flat = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#3366aa" } })
      .jpeg({ quality: 60 })
      .toBuffer();

    expect(await imagePerceptualHash(flat)).toBeNull();
  });

  it("imagePerceptualHash_transparentImage_returnsNull", async () => {
    const empty = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();

    expect(await imagePerceptualHash(empty)).toBeNull();
  });

  it("imagePerceptualHash_notAnImage_returnsNull", async () => {
    expect(await imagePerceptualHash(Buffer.from("pas une image"))).toBeNull();
  });

  it("perceptualHashFromGrey_tooFewPixels_returnsNull", () => {
    expect(perceptualHashFromGrey(new Uint8Array(32 * 31))).toBeNull();
  });

  it("perceptualHashFromGrey_zeroChannels_returnsNull", () => {
    expect(perceptualHashFromGrey(new Uint8Array(32 * 32), 0)).toBeNull();
  });
});

describe("imagePerceptualHash — forme", () => {
  it("imagePerceptualHash_detailedImage_returnsUnsigned64BitDecimal", async () => {
    const hash = await hashOf(await storedAvatar(await sourcePng(7)));

    expect(hash).toMatch(/^\d+$/);
    expect(BigInt(hash) < BigInt("18446744073709551616")).toBe(true);
  });

  it("perceptualHashFromGrey_multiChannelPixels_readsFirstChannel", () => {
    const grey = new Uint8Array(32 * 32).map((_, i) => (i % 32 < 16 ? 30 : 220));
    const rgb = new Uint8Array(32 * 32 * 3).map((_, i) => grey[Math.floor(i / 3)]);

    expect(perceptualHashFromGrey(rgb, 3)).toBe(perceptualHashFromGrey(grey));
  });
});

describe("phashDistance", () => {
  it("phashDistance_sameHash_zero", () => {
    expect(phashDistance("12345", "12345")).toBe(0);
  });

  it("phashDistance_allBitsDiffer_sixtyFour", () => {
    expect(phashDistance("0", "18446744073709551615")).toBe(64);
  });

  it("phashDistance_oneBitDiffers_one", () => {
    expect(phashDistance("1", "3")).toBe(1);
  });
});
