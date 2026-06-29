import { readFile } from "node:fs/promises";
import path from "node:path";

// Sert les fichiers de `public/uploads/` via un route handler qui lit le disque.
// En dev (Turbopack), le serveur statique ne sert que les fichiers présents au
// démarrage : tout fichier importé ensuite (logo de sponsor) renverrait 404
// jusqu'au redémarrage. Passer par `/api/uploads/...` (hors `public`, donc non
// court-circuité par le serveur statique) lit le disque à la volée et reste
// compatible avec la prod.
const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(_req: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  if (!segments || segments.length === 0) {
    return new Response(null, { status: 404 });
  }
  // Rejette toute tentative de remontée de dossier ou de séparateur injecté.
  if (segments.some((s) => s.includes("..") || s.includes("/") || s.includes("\\") || s.includes("\0"))) {
    return new Response(null, { status: 404 });
  }

  const ext = path.extname(segments[segments.length - 1]).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return new Response(null, { status: 404 });
  }

  const absPath = path.join(UPLOADS_ROOT, ...segments);
  // Garde-fou : le chemin résolu doit rester sous le dossier uploads.
  if (absPath !== UPLOADS_ROOT && !absPath.startsWith(UPLOADS_ROOT + path.sep)) {
    return new Response(null, { status: 404 });
  }

  try {
    const data = await readFile(absPath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
