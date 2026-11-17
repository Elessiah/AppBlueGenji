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
 * garde les 8 × 8 premiers coefficients de sa DCT, et chaque bit dit si son
 * coefficient dépasse la médiane des 63 coefficients hors composante continue.
 *
 * Une image **presque unie** n'a pas d'empreinte (`null`) : ses coefficients
 * sont du bruit d'encodage, et toutes les images unies se ressembleraient — un
 * aplat bloqué refuserait tous les autres.
 */

/** Côté de l'image réduite sur laquelle la DCT est calculée. */
const SAMPLE_SIZE = 32;
/** Côté du bloc de basses fréquences gardé (8 × 8 = 64 bits). */
const BLOCK_SIZE = 8;
/**
 * Énergie moyenne des coefficients hors composante continue (niveaux de gris,
 * DCT divisée par le nombre de pixels) sous laquelle l'image est jugée unie.
 */
export const MIN_AC_ENERGY = 0.5;

/**
 * Écart (bits différents sur 64) jusqu'auquel deux empreintes désignent la
 * même image. Mesuré sur 30 images de synthèse passées par le gabarit avatar
 * (`tests/lib/server/image-phash.test.ts`) : un autre format source, un
 * réencodage, un redimensionnement restent à 2 au plus ; un cadre décalé de
 * 2,5 % de la source, à 8 au plus ; décalé de 5 %, entre 2 et 20 (le plus
 * souvent sous 10). Deux images différentes s'écartent de 18 au moins (moitié
 * des paires au-delà de 30), deux silhouettes de même disposition de 22.
 * 10 rattrape les retouches de cadrage ordinaires et garde 8 bits de marge
 * avant la première image différente : un faux refus coûte plus cher à un
 * joueur de bonne foi qu'un contournement par un cadrage très décalé, que la
 * modération rattrape sur signalement.
 */
export const PHASH_MATCH_DISTANCE = 10;

/** Cosinus de la DCT, calculés une fois : `COS[u][x] = cos((2x + 1)uπ / 2N)`. */
const COS: readonly Float64Array[] = Array.from({ length: BLOCK_SIZE }, (_, u) => {
  const row = new Float64Array(SAMPLE_SIZE);
  for (let x = 0; x < SAMPLE_SIZE; x += 1) row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SAMPLE_SIZE));
  return row;
});

/**
 * L'empreinte perceptuelle de cette image, en entier non signé de 64 bits écrit
 * en décimal (la forme que prend `BIGINT UNSIGNED` en SQL) ; `null` si l'image
 * est presque unie ou ne se décode pas.
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
 * est presque unie.
 */
export function perceptualHashFromGrey(pixels: Uint8Array, channels = 1): string | null {
  if (channels < 1 || pixels.length < SAMPLE_SIZE * SAMPLE_SIZE * channels) return null;
  const coefficients = lowFrequencyDct(pixels, channels);
  const ac = Array.from(coefficients.subarray(1));
  const energy = ac.reduce((total, value) => total + Math.abs(value), 0) / ac.length;
  if (energy < MIN_AC_ENERGY) return null;
  const sorted = [...ac].sort((a, b) => a - b);
  return bitsAbove(coefficients, sorted[Math.floor(sorted.length / 2)]);
}

/**
 * Les 8 × 8 premiers coefficients de la DCT de l'image 32 × 32, divisés par le
 * nombre de pixels. DCT séparable : sur les lignes (8 fréquences par ligne),
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
 * Un bit par coefficient (1 s'il dépasse `median`), en entier non signé de 64
 * bits écrit en décimal — assemblé en deux moitiés de 32 bits : la cible du
 * projet (ES2017) n'a pas de littéral `BigInt`.
 */
function bitsAbove(coefficients: Float64Array, median: number): string {
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
