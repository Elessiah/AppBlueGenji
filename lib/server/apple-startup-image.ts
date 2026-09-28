import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { appleStartupLogoSize } from "@/lib/shared/apple-startup-images";
import { APP_BACKGROUND_COLOR } from "@/lib/shared/web-manifest";

const LOGO_PATH = path.join(process.cwd(), "public", "logo_bg.webp");

/**
 * Écran de lancement iOS aux dimensions données : fond `--cyber-bg` (sans
 * transparence — iOS peindrait du blanc dessous), logo au centre. Voir
 * `lib/shared/apple-startup-images.ts`.
 */
export async function renderAppleStartupImage(width: number, height: number): Promise<Buffer> {
  const side = appleStartupLogoSize(width, height);
  const logo = await sharp(await readFile(LOGO_PATH)).resize(side, side).png().toBuffer();
  const composed = await sharp({ create: { width, height, channels: 3, background: APP_BACKGROUND_COLOR } })
    .composite([{ input: logo, gravity: "center" }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  // La composition d'un logo transparent ajoute une couche alpha, entièrement
  // opaque ici : on la retire pour rendre un PNG sans transparence.
  return sharp(composed.data, { raw: composed.info }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}
