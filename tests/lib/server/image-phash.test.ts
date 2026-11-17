import { describe, expect, it } from "@jest/globals";
import sharp from "sharp";
import {
  imagePerceptualHash,
  MIN_TONAL_RANGE,
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

/**
 * Une image « photo » : somme de vagues de fréquences mêlées, d'amplitude en
 * 1/f comme une photo, teintes tirées de la graine (128 × 128, PNG).
 */
async function photoLike(seed: number): Promise<Buffer> {
  const random = seeded(seed * 31 + 7);
  const size = 128;
  const waves = Array.from({ length: 30 }, () => {
    const frequency = 0.5 + random() ** 2 * 24;
    const angle = random() * Math.PI * 2;
    return { fx: Math.cos(angle) * frequency, fy: Math.sin(angle) * frequency, phase: random() * 6.28, tint: [random(), random(), random()] };
  });
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const colour = [0, 0, 0];
      for (const wave of waves) {
        const value = Math.sin(((wave.fx * x + wave.fy * y) * 2 * Math.PI) / size + wave.phase) / Math.hypot(wave.fx, wave.fy);
        for (let c = 0; c < 3; c += 1) colour[c] += value * wave.tint[c];
      }
      for (let c = 0; c < 3; c += 1) pixels[(y * size + x) * 3 + c] = Math.max(0, Math.min(255, 128 + colour[c] * 22));
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

/** Les images « photo » se calculent pixel à pixel : un passage de toute la suite, chargé, y dépasse les 5 s par défaut. */
const PHOTO_TEST_TIMEOUT_MS = 30_000;

/** Un avatar texte : un pseudo en gras sur un aplat. */
function textAvatar(name: string, background: string, small = false): Buffer {
  const foreground = background === "#ffffff" ? "#111111" : "#eeeeee";
  const text = small
    ? `<text x="160" y="380" font-size="120" font-family="Arial" font-weight="bold" fill="${foreground}">${name}</text>`
    : `<text x="300" y="370" font-size="200" text-anchor="middle" font-family="Arial" font-weight="bold" fill="${foreground}">${name}</text>`;
  return svg(`<rect width="600" height="600" fill="${background}"/>${text}`);
}

/**
 * Silhouette (tête et buste) décentrée, comme un portrait cadré de côté : même
 * disposition, couleurs et tailles au choix.
 */
function silhouette(skin: string, radius: number, background: string, centre = 220): Buffer {
  return svg(
    `<rect width="600" height="600" fill="${background}"/><circle cx="${centre}" cy="230" r="${radius}" fill="${skin}"/><ellipse cx="${centre}" cy="560" rx="${radius * 2}" ry="200" fill="${skin}"/><rect x="420" y="60" width="120" height="40" fill="${skin}"/>`,
  );
}

/** Un motif centré et symétrique sur un fond uni (disque, losange, anneau, initiale dans un cercle). */
function centredEmblem(kind: "disc" | "diamond" | "ring" | "initial", foreground: string, background: string): Buffer {
  const shapes = {
    disc: `<circle cx="300" cy="300" r="190" fill="${foreground}"/>`,
    diamond: `<rect x="150" y="150" width="300" height="300" fill="${foreground}" transform="rotate(45 300 300)"/>`,
    ring: `<circle cx="300" cy="300" r="210" fill="none" stroke="${foreground}" stroke-width="40"/>`,
    initial: `<circle cx="300" cy="300" r="250" fill="${foreground}"/><text x="300" y="400" font-size="300" text-anchor="middle" font-family="Arial" fill="${background}">A</text>`,
  };
  return svg(`<rect width="600" height="600" fill="${background}"/>${shapes[kind]}`);
}

/** Le gabarit logo d'équipe de `storeImageBuffer` : 512 × 512 `contain` sur fond transparent, WebP 82. */
async function storedTeamLogo(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82 })
    .toBuffer();
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

// Graines des scènes mesurées : toutes ont une empreinte, avant comme après un
// cadre décalé (revue EF-72 cycle 2 ; au cycle 1, six d'entre elles la
// perdaient, sous le critère d'alors, absolu).
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

describe("imagePerceptualHash — même image, autre version", () => {
  it("imagePerceptualHash_jpegSource_withinTwoBits", async () => {
    const png = await sourcePng(8);
    const stored = await hashOf(await storedAvatar(png));

    const fromJpeg = await hashOf(await storedAvatar(await sharp(png).jpeg({ quality: 70 }).toBuffer()));

    expect(phashDistance(stored, fromJpeg)).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileReencodedAsPng_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(9));

    const reencoded = await sharp(stored).png().toBuffer();

    expect(phashDistance(await hashOf(stored), await hashOf(reencoded))).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileReencodedAsLowQualityJpeg_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(10));

    const reencoded = await sharp(stored).jpeg({ quality: 50 }).toBuffer();

    expect(phashDistance(await hashOf(stored), await hashOf(reencoded))).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileResizedSmall_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(4));

    const small = await sharp(stored).resize(96, 96).png().toBuffer();

    expect(phashDistance(await hashOf(stored), await hashOf(small))).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileResizedLarge_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(12));

    const large = await sharp(stored).resize(1024, 1024).jpeg().toBuffer();

    expect(phashDistance(await hashOf(stored), await hashOf(large))).toBeLessThanOrEqual(2);
  });

  it("imagePerceptualHash_storedFileUploadedAgainThroughPipeline_withinTwoBits", async () => {
    const stored = await storedAvatar(await sourcePng(11));

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
    const png = await sourcePng(8);
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

  it("imagePerceptualHash_distinctPhotoLikeImages_allPairsBeyondThreshold", async () => {
    const hashes = await Promise.all([1, 2, 3, 4, 5, 6].map(async (seed) => hashOf(await storedAvatar(await photoLike(seed)))));

    const closest = Math.min(...hashes.flatMap((a, i) => hashes.slice(i + 1).map((b) => phashDistance(a, b))));

    expect(closest).toBeGreaterThan(PHASH_MATCH_DISTANCE);
  }, PHOTO_TEST_TIMEOUT_MS);
});

// Revue EF-72 cycle 2 : le contraste est étiré avant le calcul — une copie
// assombrie, éclaircie ou délavée d'une image bloquée garde son empreinte et
// correspond.
describe("imagePerceptualHash — même image, autre contraste", () => {
  it.each([
    ["assombrie", 0.3, 0],
    ["délavée", 0.4, 77],
    ["éclaircie", 0.3, 178],
  ] satisfies [string, number, number][])("imagePerceptualHash_photoLikeCopy_matches (%s)", async (_label, factor, offset) => {
    const png = await photoLike(3);
    const stored = await hashOf(await storedAvatar(png));

    const copy = await hashOf(await storedAvatar(await sharp(png).linear(factor, offset).png().toBuffer()));

    expect(phashDistance(stored, copy)).toBeLessThanOrEqual(PHASH_MATCH_DISTANCE);
  }, PHOTO_TEST_TIMEOUT_MS);

  it("imagePerceptualHash_darkenedScene_matches", async () => {
    const png = await sourcePng(9);
    const stored = await hashOf(await storedAvatar(png));

    const dark = await hashOf(await storedAvatar(await sharp(png).linear(0.3, 0).png().toBuffer()));

    expect(phashDistance(stored, dark)).toBeLessThanOrEqual(PHASH_MATCH_DISTANCE);
  });
});

describe("imagePerceptualHash — sans empreinte", () => {
  // Revue EF-72 cycle 1 : la symétrie annule la moitié des coefficients ou plus ;
  // leurs bits n'étaient que du bruit d'arrondi, et deux emblèmes différents
  // tombaient à 6 bits l'un de l'autre.
  it.each(["disc", "diamond", "ring", "initial"] satisfies ("disc" | "diamond" | "ring" | "initial")[])(
    "imagePerceptualHash_centredSymmetricEmblem_returnsNull (%s)",
    async (kind) => {
      const avatar = await storedAvatar(await sharp(centredEmblem(kind, "#f4f4f4", "#2244cc")).png().toBuffer());

      expect(await imagePerceptualHash(avatar)).toBeNull();
    },
  );

  // Revue EF-72 cycle 2 : deux pseudos courts au même endroit tombaient à
  // 0 bit l'un de l'autre — un avatar texte bloqué en refusait d'autres.
  it.each([
    ["Kev", "#000000", false],
    ["Rex", "#ffffff", false],
    ["Dax", "#2244cc", false],
    ["Kev", "#000000", true],
    ["Zed", "#ffffff", true],
  ] satisfies [string, string, boolean][])("imagePerceptualHash_textOnFlatBackground_returnsNull (%s sur %s, petit : %s)", async (name, background, small) => {
    const avatar = await storedAvatar(await sharp(textAvatar(name, background, small)).png().toBuffer());

    expect(await imagePerceptualHash(avatar)).toBeNull();
  });

  it("imagePerceptualHash_identicon_returnsNull", async () => {
    const cells = [
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
    ];
    const squares = cells.flatMap((row, y) =>
      row.flatMap((on, x) =>
        on ? [x, 4 - x].map((column) => `<rect x="${50 + column * 100}" y="${50 + y * 100}" width="100" height="100" fill="#3a8a5a"/>`) : [],
      ),
    );
    const identicon = svg(`<rect width="600" height="600" fill="#f0f0f0"/>${squares.join("")}`);

    expect(await imagePerceptualHash(await storedAvatar(identicon))).toBeNull();
  });

  it("imagePerceptualHash_radialGradient_returnsNull", async () => {
    const vignette = svg(
      `<defs><radialGradient id="g" cx="0.3" cy="0.4" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></radialGradient></defs><rect width="600" height="600" fill="url(#g)"/>`,
    );

    expect(await imagePerceptualHash(await storedAvatar(vignette))).toBeNull();
  });

  // Même disposition, autres couleurs : sur un fond uni, une silhouette n'a pas
  // d'empreinte — deux portraits cadrés pareil ne se refusent pas l'un l'autre.
  it.each([
    ["#e0b090", 110, "#204060"],
    ["#8a5a3a", 110, "#101010"],
  ] satisfies [string, number, string][])("imagePerceptualHash_offCentreSilhouetteOnFlatBackground_returnsNull (%s)", async (skin, radius, background) => {
    expect(await imagePerceptualHash(await storedAvatar(silhouette(skin, radius, background)))).toBeNull();
  });

  it("imagePerceptualHash_centredEmblemTeamLogo_returnsNull", async () => {
    const emblem = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><circle cx="300" cy="200" r="120" fill="#ffd000"/></svg>`,
    );

    const logo = await storedTeamLogo(await sharp(emblem).png().toBuffer());

    expect(await imagePerceptualHash(logo)).toBeNull();
  });

  it("imagePerceptualHash_mirrorSymmetricSilhouette_returnsNull", async () => {
    const centred = svg(
      `<rect width="600" height="600" fill="#204060"/><circle cx="300" cy="230" r="110" fill="#e0b090"/><ellipse cx="300" cy="560" rx="220" ry="200" fill="#e0b090"/>`,
    );

    expect(await imagePerceptualHash(await storedAvatar(centred))).toBeNull();
  });

  it("imagePerceptualHash_horizontalGradient_returnsNull", async () => {
    const gradient = svg(
      `<defs><linearGradient id="g"><stop offset="0" stop-color="#cc2020"/><stop offset="1" stop-color="#2020cc"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/>`,
    );

    expect(await imagePerceptualHash(await storedAvatar(gradient))).toBeNull();
  });

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

/**
 * Pixels 32 × 32 détaillés, sans fond uni ni symétrie : un motif pseudo-aléatoire
 * lissé, étalé sur `range` niveaux de gris.
 */
function detailedGrey(range: number): Uint8Array {
  const random = seeded(5);
  const raw = Array.from({ length: 32 * 32 }, () => random());
  const smooth = raw.map((value, i) => {
    const x = i % 32;
    const y = Math.floor(i / 32);
    return (value + raw[y * 32 + ((x + 1) % 32)] + raw[((y + 1) % 32) * 32 + x]) / 3;
  });
  const low = Math.min(...smooth);
  const high = Math.max(...smooth);
  return Uint8Array.from(smooth, (value) => 20 + Math.round(((value - low) / (high - low)) * range));
}

describe("imagePerceptualHash — forme", () => {
  it("imagePerceptualHash_detailedImage_returnsUnsigned64BitDecimal", async () => {
    const hash = await hashOf(await storedAvatar(await sourcePng(7)));

    expect(hash).toMatch(/^\d+$/);
    expect(BigInt(hash) < BigInt("18446744073709551616")).toBe(true);
  });

  it("perceptualHashFromGrey_multiChannelPixels_readsFirstChannel", () => {
    const grey = detailedGrey(200);
    const rgb = new Uint8Array(32 * 32 * 3).map((_, i) => (i % 3 === 0 ? grey[Math.floor(i / 3)] : 0));

    expect(perceptualHashFromGrey(grey)).not.toBeNull();
    expect(perceptualHashFromGrey(rgb, 3)).toBe(perceptualHashFromGrey(grey));
  });

  it("perceptualHashFromGrey_tonalRangeBelowMinimum_returnsNull", () => {
    expect(perceptualHashFromGrey(detailedGrey(MIN_TONAL_RANGE - 1))).toBeNull();
  });

  it("perceptualHashFromGrey_lowContrastButDetailed_returnsHash", () => {
    expect(perceptualHashFromGrey(detailedGrey(MIN_TONAL_RANGE * 3))).not.toBeNull();
  });
});

describe("imagePerceptualHash — composante continue", () => {
  // La luminosité moyenne dépasse toujours la médiane : gardée, elle aurait
  // posé le même bit sur toutes les empreintes.
  it("imagePerceptualHash_detailedScenes_lowestBitNotConstant", async () => {
    const hashes = await Promise.all(SEEDS.map(async (seed) => hashOf(await storedAvatar(await sourcePng(seed)))));

    const lowestBits = new Set(hashes.map((hash) => BigInt(hash) % BigInt(2)));

    expect(lowestBits.size).toBe(2);
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
