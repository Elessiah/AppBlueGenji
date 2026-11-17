import sharp from "sharp";

/**
 * Empreinte perceptuelle d'une image (pHash DCT, 64 bits) — décision D17,
 * `docs/features/BLOCKED_IMAGE_PHASH.md`.
 *
 * Le SHA-256 d'un avatar bloqué ne reconnaît que les mêmes octets : un
 * recadrage décalé de quelques pixels, un autre format source, un réencodage
 * ou une mise à jour de sharp le contournent. Cette empreinte résume l'allure
 * de l'image (basses fréquences de sa luminance) : deux versions de la même
 * image n'en diffèrent que de quelques bits, deux images différentes de bien
 * davantage.
 *
 * Calcul : l'image, aplatie sur un gris moyen (la transparence d'un logo ne
 * change rien d'une version à l'autre), passe en niveaux de gris 32 × 32, puis
 * son contraste est étiré (2e et 98e centiles ramenés à 0 et 255) : une copie
 * assombrie, éclaircie ou délavée garde l'allure de l'originale. On garde les
 * 64 coefficients de plus basse fréquence de sa DCT **hors composante
 * continue** (la luminosité moyenne, qui dépasserait toujours la médiane), et
 * chaque bit dit si son coefficient dépasse leur médiane.
 *
 * Une image **trop simple** n'a pas d'empreinte (`null`) : à si basse
 * résolution, deux images différentes de ce genre tombent à quelques bits
 * l'une de l'autre, et un avatar bloqué en refuserait d'innocents (revue
 * EF-72, cycles 1 et 2, mesuré sur un jeu d'images :
 * `tests/lib/server/image-phash.test.ts`). Elle n'est alors bloquée que par
 * ses octets. Est trop simple une image :
 * - presque unie (moins de `MIN_TONAL_RANGE` niveaux entre ses centiles) ;
 * - faite **surtout d'un fond uni** : au moins `MAX_BACKGROUND_SHARE` de ses
 *   pixels dans un même ton — un pseudo ou une initiale sur un aplat, un
 *   emblème au milieu d'un logo, une silhouette sur un fond uni (deux pseudos
 *   courts au même endroit tombaient à 0 bit l'un de l'autre) ;
 * - **symétrique** en miroir, de gauche à droite ou de haut en bas (identicon,
 *   motif centré : la symétrie annule la moitié des coefficients, dont les
 *   bits ne disent plus que le bruit d'arrondi, le même d'une image à
 *   l'autre) ;
 * - un **dégradé** : `MAX_LOW_FREQUENCY_SHARE` de ses variations, ou plus,
 *   dans ses cinq plus basses fréquences.
 * Une photo, une illustration, une scène détaillée — même sombre ou délavée —
 * en a une.
 */

/** Côté de l'image réduite sur laquelle la DCT est calculée. */
const SAMPLE_SIZE = 32;
/** Côté du bloc de basses fréquences calculé (9 × 9, dont 64 gardés). */
const BLOCK_SIZE = 9;
/** Nombre de bits de l'empreinte. */
const HASH_BITS = 64;
/** Centiles (en part des pixels) ramenés à 0 et à 255 par l'étirement du contraste. */
const STRETCH_PERCENTILE = 0.02;
/** Écart (niveaux de gris) entre ces centiles sous lequel l'image est presque unie. */
export const MIN_TONAL_RANGE = 8;
/** Demi-largeur (niveaux de gris, après étirement) de ce qui compte pour un même ton. */
const BACKGROUND_TONE_TOLERANCE = 6;
/**
 * Part des pixels dans un même ton à partir de laquelle l'image est faite
 * surtout d'un fond uni. Mesuré (après étirement) : un pseudo sur un aplat, de
 * 88 à 97 % ; un emblème, une silhouette sur un fond uni, de 54 à 97 % ; un
 * identicon, de 46 à 75 % ; une scène détaillée, de 12 à 58 % (presque
 * toujours sous 50) ; une photo, sous 30 %.
 */
export const MAX_BACKGROUND_SHARE = 0.5;
/**
 * Écart à son reflet (somme des écarts pixel à pixel, rapportée à la somme des
 * écarts à la moyenne) sous lequel l'image est symétrique. Mesuré : un motif
 * symétrique, de 0 à 0,05 (arrondi) ; une illustration à peu près symétrique,
 * 0,25 et plus ; une photo, une scène, au-delà de 0,4.
 */
export const MIN_MIRROR_ASYMMETRY = 0.1;
/**
 * Part de la variance de l'image portée par ses cinq plus basses fréquences à
 * partir de laquelle l'image est un dégradé. Mesuré : un dégradé linéaire ou
 * radial, 0,93 et plus ; une photo, une scène, au plus 0,88.
 */
export const MAX_LOW_FREQUENCY_SHARE = 0.9;

/**
 * Écart (bits différents sur 64) jusqu'auquel deux empreintes désignent la
 * même image. Mesuré sur le jeu d'images de la revue EF-72 (scènes, photos,
 * illustrations, pixel art, passés par le gabarit avatar) : un autre format
 * source, un réencodage, un redimensionnement restent à 6 au plus ; une copie
 * assombrie ou délavée, à 8 au plus (une copie très éclaircie, deux fois sur
 * quatre-vingts, au-delà) ; un cadre décalé de 2,5 % de la source, à 12 au
 * plus (presque toujours sous 10) ; décalé de 5 %, jusqu'à 18 (un peu plus
 * d'une fois sur deux sous 10). Deux images
 * différentes qui ont une empreinte s'écartent de 14 au moins (une paire sur
 * cent sous 22). 10 rattrape les retouches de cadrage ordinaires et garde de
 * la marge avant la première image différente. Un faux refus coûte plus cher
 * à un joueur de bonne foi qu'un contournement par un cadrage très décalé, que
 * la modération rattrape sur signalement.
 */
export const PHASH_MATCH_DISTANCE = 10;

/** Cosinus de la DCT, calculés une fois : `COS[u][x] = cos((2x + 1)uπ / 2N)`. */
const COS: readonly Float64Array[] = Array.from({ length: BLOCK_SIZE }, (_, u) => {
  const row = new Float64Array(SAMPLE_SIZE);
  for (let x = 0; x < SAMPLE_SIZE; x += 1) row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SAMPLE_SIZE));
  return row;
});

/**
 * Les 64 coefficients gardés, des plus basses fréquences aux plus hautes
 * (`u + v` croissant, puis `v`, puis `u`), composante continue (0, 0) exclue :
 * index dans le bloc, `v * BLOCK_SIZE + u`.
 */
const KEPT_COEFFICIENTS: readonly number[] = (() => {
  const cells: { u: number; v: number }[] = [];
  for (let v = 0; v < BLOCK_SIZE; v += 1) {
    for (let u = 0; u < BLOCK_SIZE; u += 1) if (u + v > 0) cells.push({ u, v });
  }
  cells.sort((a, b) => a.u + a.v - (b.u + b.v) || a.v - b.v || a.u - b.u);
  return cells.slice(0, HASH_BITS).map(({ u, v }) => v * BLOCK_SIZE + u);
})();

/**
 * L'empreinte perceptuelle de cette image, en entier non signé de 64 bits écrit
 * en décimal (la forme que prend `BIGINT UNSIGNED` en SQL) ; `null` si l'image
 * est trop simple ou ne se décode pas.
 */
export async function imagePerceptualHash(content: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(content, { failOn: "none", autoOrient: true })
      .flatten({ background: { r: 128, g: 128, b: 128 } })
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" })
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    return perceptualHashFromGrey(data, info.channels);
  } catch {
    return null;
  }
}

/**
 * Le calcul seul, sur des pixels déjà réduits à 32 × 32 (premier canal lu,
 * `channels` octets par pixel) ; `null` si les pixels manquent ou si l'image
 * est trop simple.
 */
export function perceptualHashFromGrey(pixels: Uint8Array, channels = 1): string | null {
  if (channels < 1 || pixels.length < SAMPLE_SIZE * SAMPLE_SIZE * channels) return null;
  const grey = stretchedGrey(pixels, channels);
  if (grey === null || isMostlyOneTone(grey) || isMirrorSymmetric(grey)) return null;
  const block = lowFrequencyDct(grey);
  if (lowFrequencyShare(block, grey) >= MAX_LOW_FREQUENCY_SHARE) return null;
  const kept = KEPT_COEFFICIENTS.map((index) => block[index]);
  const sorted = [...kept].sort((a, b) => a - b);
  const median = (sorted[HASH_BITS / 2 - 1] + sorted[HASH_BITS / 2]) / 2;
  return bitsAbove(kept, median);
}

/**
 * Les niveaux de gris, contraste étiré : le 2e centile ramené à 0, le 98e à
 * 255 (au-delà, écrêtés). `null` si l'écart entre eux reste sous
 * `MIN_TONAL_RANGE` : image presque unie.
 */
function stretchedGrey(pixels: Uint8Array, channels: number): Float64Array | null {
  const count = SAMPLE_SIZE * SAMPLE_SIZE;
  const values = new Float64Array(count);
  for (let i = 0; i < count; i += 1) values[i] = pixels[i * channels];
  const sorted = Float64Array.from(values).sort();
  const low = sorted[Math.floor(count * STRETCH_PERCENTILE)];
  const high = sorted[Math.ceil(count * (1 - STRETCH_PERCENTILE)) - 1];
  if (high - low < MIN_TONAL_RANGE) return null;
  const scale = 255 / (high - low);
  return values.map((value) => Math.min(255, Math.max(0, (value - low) * scale)));
}

/** Au moins `MAX_BACKGROUND_SHARE` des pixels dans un même ton (à `BACKGROUND_TONE_TOLERANCE` près) ? */
function isMostlyOneTone(grey: Float64Array): boolean {
  const histogram = new Array<number>(256).fill(0);
  for (const value of grey) histogram[Math.round(value)] += 1;
  const width = BACKGROUND_TONE_TOLERANCE * 2 + 1;
  let window = 0;
  for (let tone = 0; tone < width; tone += 1) window += histogram[tone];
  let largest = window;
  for (let tone = width; tone < 256; tone += 1) {
    window += histogram[tone] - histogram[tone - width];
    largest = Math.max(largest, window);
  }
  return largest >= grey.length * MAX_BACKGROUND_SHARE;
}

/** L'image est-elle (presque) son propre reflet, de gauche à droite ou de haut en bas ? */
function isMirrorSymmetric(grey: Float64Array): boolean {
  const mean = meanOf(grey);
  let spread = 0;
  let horizontal = 0;
  let vertical = 0;
  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    for (let x = 0; x < SAMPLE_SIZE; x += 1) {
      const value = grey[y * SAMPLE_SIZE + x];
      spread += Math.abs(value - mean);
      horizontal += Math.abs(value - grey[y * SAMPLE_SIZE + (SAMPLE_SIZE - 1 - x)]);
      vertical += Math.abs(value - grey[(SAMPLE_SIZE - 1 - y) * SAMPLE_SIZE + x]);
    }
  }
  return Math.min(horizontal, vertical) < spread * MIN_MIRROR_ASYMMETRY;
}

/**
 * Part de la variance de l'image portée par ses cinq plus basses fréquences
 * (`u + v ≤ 2`, composante continue exclue). Égalité de Parseval : avec la
 * normalisation de `lowFrequencyDct` (somme divisée par le nombre de pixels),
 * un coefficient y pèse son carré fois 4 (fréquence non nulle sur les deux
 * axes) ou fois 2 (sur un seul).
 */
function lowFrequencyShare(block: Float64Array, grey: Float64Array): number {
  const mean = meanOf(grey);
  let variance = 0;
  for (const value of grey) variance += (value - mean) ** 2;
  variance /= grey.length;
  let low = 0;
  for (const { index, weight } of LOWEST_FREQUENCIES) low += block[index] ** 2 * weight;
  return variance > 0 ? low / variance : 1;
}

/** Les cinq plus basses fréquences (`u + v ≤ 2`, hors (0, 0)) : index dans le bloc et poids de Parseval. */
const LOWEST_FREQUENCIES: readonly { index: number; weight: number }[] = [
  { index: 1, weight: 2 }, // (u, v) = (1, 0)
  { index: 2, weight: 2 }, // (2, 0)
  { index: BLOCK_SIZE, weight: 2 }, // (0, 1)
  { index: BLOCK_SIZE + 1, weight: 4 }, // (1, 1)
  { index: 2 * BLOCK_SIZE, weight: 2 }, // (0, 2)
];

function meanOf(values: Float64Array): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Les 9 × 9 premiers coefficients de la DCT de l'image 32 × 32 (étirée), divisés par le
 * nombre de pixels. DCT séparable : sur les lignes (9 fréquences par ligne),
 * puis sur les colonnes.
 */
function lowFrequencyDct(grey: Float64Array): Float64Array {
  const rows: Float64Array[] = [];
  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    const out = new Float64Array(BLOCK_SIZE);
    for (let u = 0; u < BLOCK_SIZE; u += 1) {
      let sum = 0;
      for (let x = 0; x < SAMPLE_SIZE; x += 1) sum += grey[y * SAMPLE_SIZE + x] * COS[u][x];
      out[u] = sum;
    }
    rows.push(out);
  }
  const coefficients = new Float64Array(BLOCK_SIZE * BLOCK_SIZE);
  for (let v = 0; v < BLOCK_SIZE; v += 1) {
    for (let u = 0; u < BLOCK_SIZE; u += 1) {
      let sum = 0;
      for (let y = 0; y < SAMPLE_SIZE; y += 1) sum += rows[y][u] * COS[v][y];
      coefficients[v * BLOCK_SIZE + u] = sum / (SAMPLE_SIZE * SAMPLE_SIZE);
    }
  }
  return coefficients;
}

/**
 * Un bit par coefficient gardé (1 s'il dépasse `median`), en entier non signé
 * de 64 bits écrit en décimal — assemblé en deux moitiés de 32 bits : la cible
 * du projet (ES2017) n'a pas de littéral `BigInt`.
 */
function bitsAbove(coefficients: readonly number[], median: number): string {
  let low = 0;
  let high = 0;
  for (let i = 0; i < 32; i += 1) {
    if (coefficients[i] > median) low = (low | (1 << i)) >>> 0;
    if (coefficients[i + 32] > median) high = (high | (1 << i)) >>> 0;
  }
  return (BigInt(high) * BigInt(0x100000000) + BigInt(low)).toString();
}

/** Nombre de bits différents entre deux empreintes (écrites en décimal). */
export function phashDistance(a: string, b: string): number {
  const diff = BigInt.asUintN(64, BigInt(a) ^ BigInt(b)).toString(2);
  let count = 0;
  for (const bit of diff) if (bit === "1") count += 1;
  return count;
}
