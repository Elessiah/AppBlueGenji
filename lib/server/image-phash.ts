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
 * change rien d'une version à l'autre), passe en niveaux de gris 32 × 32 ; on
 * garde les 64 coefficients de plus basse fréquence de sa DCT **hors
 * composante continue** (la luminosité moyenne, qui dépasserait toujours la
 * médiane), et chaque bit dit si son coefficient dépasse leur médiane.
 *
 * Une image **trop simple** n'a pas d'empreinte (`null`) : quand moins de
 * `MIN_SIGNIFICANT_COEFFICIENTS` coefficients s'écartent franchement de la
 * médiane, les autres bits ne disent que le bruit d'arrondi, le même d'une
 * image à l'autre. C'est le cas d'un aplat, d'un dégradé, et de tout motif
 * centré et symétrique (disque, losange, initiale dans un cercle, emblème au
 * milieu d'un logo) : la symétrie annule la moitié des coefficients ou plus,
 * et deux motifs différents de ce genre tombaient à quelques bits l'un de
 * l'autre — un emblème bloqué en aurait refusé d'innocents. Une telle image
 * n'est bloquée que par ses octets.
 */

/** Côté de l'image réduite sur laquelle la DCT est calculée. */
const SAMPLE_SIZE = 32;
/** Côté du bloc de basses fréquences calculé (9 × 9, dont 64 gardés). */
const BLOCK_SIZE = 9;
/** Nombre de bits de l'empreinte. */
const HASH_BITS = 64;
/**
 * Écart à la médiane (niveaux de gris, DCT divisée par le nombre de pixels)
 * au-delà duquel un coefficient porte de l'information et non du bruit
 * d'arrondi.
 */
export const MIN_COEFFICIENT_DEVIATION = 0.5;
/**
 * Nombre de coefficients franchement écartés de la médiane (sur 64) sous
 * lequel l'image est jugée trop simple pour une empreinte. Mesuré
 * (`tests/lib/server/image-phash.test.ts`) : un motif centré et symétrique en a
 * de 14 à 39, une silhouette symétrique 33, une scène ordinaire de 25 à 53
 * (la plupart au-delà de 40).
 */
export const MIN_SIGNIFICANT_COEFFICIENTS = 40;

/**
 * Écart (bits différents sur 64) jusqu'auquel deux empreintes désignent la
 * même image. Mesuré sur des images de synthèse passées par le gabarit avatar
 * (`tests/lib/server/image-phash.test.ts`, et 60 scènes mesurées à la revue
 * EF-72) : un autre format source, un réencodage, un redimensionnement restent
 * à 2 au plus ; un cadre décalé de 2,5 % de la source, à 12 au plus (presque
 * toujours sous 10) ; décalé de 5 %, entre 2 et 18 (trois fois sur quatre sous
 * 10). Deux images différentes qui ont une empreinte s'écartent de 20 au moins
 * (moitié des paires au-delà de 32). 10 rattrape les retouches de cadrage
 * ordinaires et garde 10 bits de marge avant la première image différente :
 * une image qui perd son empreinte une fois retouchée (à la limite de
 * `MIN_SIGNIFICANT_COEFFICIENTS`) passe, elle aussi. Un faux refus coûte plus
 * cher à un joueur de bonne foi qu'un contournement par un cadrage très
 * décalé, que la modération rattrape sur signalement.
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
  const block = lowFrequencyDct(pixels, channels);
  const kept = KEPT_COEFFICIENTS.map((index) => block[index]);
  const sorted = [...kept].sort((a, b) => a - b);
  const median = (sorted[HASH_BITS / 2 - 1] + sorted[HASH_BITS / 2]) / 2;
  const significant = kept.filter((value) => Math.abs(value - median) > MIN_COEFFICIENT_DEVIATION).length;
  if (significant < MIN_SIGNIFICANT_COEFFICIENTS) return null;
  return bitsAbove(kept, median);
}

/**
 * Les 9 × 9 premiers coefficients de la DCT de l'image 32 × 32, divisés par le
 * nombre de pixels. DCT séparable : sur les lignes (9 fréquences par ligne),
 * puis sur les colonnes.
 */
function lowFrequencyDct(pixels: Uint8Array, channels: number): Float64Array {
  const rows: Float64Array[] = [];
  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    const out = new Float64Array(BLOCK_SIZE);
    for (let u = 0; u < BLOCK_SIZE; u += 1) {
      let sum = 0;
      for (let x = 0; x < SAMPLE_SIZE; x += 1) sum += pixels[(y * SAMPLE_SIZE + x) * channels] * COS[u][x];
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
