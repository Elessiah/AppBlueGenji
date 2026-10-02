import type { Pool } from "mysql2/promise";
import path from "node:path";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import type { TournamentDef } from "./cases";

/**
 * Visuels du jeu de test : deux images, une par mode — une bannière **large**
 * (le cas « illustration », recadrée au rendu sur son point focal) et un logo
 * **carré à fond transparent** (le cas « logo », toujours montré en entier).
 *
 * Fabriquées une fois par exécution, mais écrites **une fois par tournoi** :
 * remplacer ou retirer l'image d'un tournoi efface son fichier, et un fichier
 * partagé disparaîtrait alors de tous les autres. Comme pour
 * `ensureSeedTeamLogo`, un vrai fichier plutôt qu'une URL étrangère, que
 * `localUploadUrl` écarterait à la sortie.
 */
const SEED_TOURNAMENT_IMAGE_SVG: Record<"COVER" | "CONTAIN", string> = {
  COVER:
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="560">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#06121f"/><stop offset="1" stop-color="#0d3b5c"/></linearGradient></defs>` +
    `<rect width="1600" height="560" fill="url(#g)"/>` +
    `<circle cx="1180" cy="200" r="220" fill="#5ac8ff" fill-opacity="0.18"/>` +
    `<circle cx="420" cy="420" r="160" fill="#5ac8ff" fill-opacity="0.10"/>` +
    `<text x="800" y="320" font-family="sans-serif" font-size="120" font-weight="700"` +
    ` fill="#e6f6ff" text-anchor="middle">BLUEGENJI</text></svg>`,
  CONTAIN:
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">` +
    `<circle cx="128" cy="128" r="112" fill="none" stroke="#5ac8ff" stroke-width="14"/>` +
    `<text x="128" y="152" font-family="sans-serif" font-size="80" font-weight="700"` +
    ` fill="#5ac8ff" text-anchor="middle">BG</text></svg>`,
};

const SEED_TOURNAMENT_IMAGE_DIR = path.join(process.cwd(), "public", "uploads", "tournaments");
const seedTournamentImageBuffers = new Map<"COVER" | "CONTAIN", Promise<Buffer>>();
let seedTournamentImageDirReady: Promise<void> | null = null;

/**
 * Prépare le dossier, une fois par exécution : les fichiers `seed-*` laissés
 * par une exécution précédente désignent des tournois que le seed vient
 * d'effacer — sans ce ménage, chaque exécution en ajouterait une dizaine.
 */
function prepareSeedTournamentImageDir(): Promise<void> {
  seedTournamentImageDirReady ??= (async () => {
    await mkdir(SEED_TOURNAMENT_IMAGE_DIR, { recursive: true });
    for (const name of await readdir(SEED_TOURNAMENT_IMAGE_DIR)) {
      if (name.startsWith("seed-")) await unlink(path.join(SEED_TOURNAMENT_IMAGE_DIR, name));
    }
  })();
  return seedTournamentImageDirReady;
}

function seedTournamentImageBuffer(fit: "COVER" | "CONTAIN"): Promise<Buffer> {
  let buffer = seedTournamentImageBuffers.get(fit);
  if (!buffer) {
    buffer = sharp(Buffer.from(SEED_TOURNAMENT_IMAGE_SVG[fit])).webp({ quality: 82 }).toBuffer();
    seedTournamentImageBuffers.set(fit, buffer);
  }
  return buffer;
}

/** Illustration ou logo d'un tournoi seedé ; rien si le cas n'en déclare pas. */
export async function applyTournamentImage(db: Pool, tournamentId: number, def: TournamentDef): Promise<void> {
  if (!def.image) return;
  await prepareSeedTournamentImageDir();
  const filename = `seed-${tournamentId}.webp`;
  await writeFile(path.join(SEED_TOURNAMENT_IMAGE_DIR, filename), await seedTournamentImageBuffer(def.image.fit));
  await db.execute(
    `UPDATE bg_tournaments
     SET image_url = ?, image_fit = ?, image_focus_x = ?, image_focus_y = ?
     WHERE id = ?`,
    [
      toServedUploadUrl(`/uploads/tournaments/${filename}`),
      def.image.fit,
      def.image.focusX ?? 50,
      def.image.focusY ?? 50,
      tournamentId,
    ]
  );
}
