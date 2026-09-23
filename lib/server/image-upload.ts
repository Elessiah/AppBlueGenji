import crypto from "node:crypto";
import path from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/uploads";

export type UploadKind = "avatar" | "team-logo" | "sponsor-logo" | "benevole-photo" | "tournament-image";

const MAX_BYTES = IMAGE_UPLOAD_MAX_BYTES;
const MAX_DIMENSION = 8000;
const ALLOWED_MIME: ReadonlySet<string> = new Set(IMAGE_UPLOAD_MIME_TYPES);

const KIND_CONFIG: Record<
  UploadKind,
  { dir: string; relPrefix: string; width: number; height: number; fit: "cover" | "contain" | "inside"; quality: number }
> = {
  avatar: {
    dir: path.join(process.cwd(), "public", "uploads", "avatars"),
    relPrefix: "/uploads/avatars/",
    width: 256,
    height: 256,
    fit: "cover",
    quality: 80,
  },
  "team-logo": {
    dir: path.join(process.cwd(), "public", "uploads", "teams"),
    relPrefix: "/uploads/teams/",
    width: 512,
    height: 512,
    fit: "contain",
    quality: 82,
  },
  // Vitrine partenaires : emplacement large 3:1, logo « contain » sur fond
  // transparent. Résolution cible 600×200 (cf. indice affiché dans la modale).
  "sponsor-logo": {
    dir: path.join(process.cwd(), "public", "uploads", "sponsors"),
    relPrefix: "/uploads/sponsors/",
    width: 600,
    height: 200,
    fit: "contain",
    quality: 82,
  },
  // Photo de bénévole : portrait carré recadré « cover », rendu en cercle côté UI.
  "benevole-photo": {
    dir: path.join(process.cwd(), "public", "uploads", "benevoles"),
    relPrefix: "/uploads/benevoles/",
    width: 256,
    height: 256,
    fit: "cover",
    quality: 80,
  },
  // Illustration ou logo d'un tournoi : **ni recadrée ni agrandie**, seulement
  // réduite si l'un de ses côtés dépasse 1600 px. Le cadrage se décide au rendu
  // (point focal, mode logo — `lib/shared/tournament-image.ts`) : c'est ce qui
  // laisse passer n'importe quel format, d'une bannière 21:9 à un logo en
  // portrait, là où un gabarit fixe aurait rogné l'un ou bordé l'autre. La
  // transparence d'un logo survit (WebP avec couche alpha).
  "tournament-image": {
    dir: path.join(process.cwd(), "public", "uploads", "tournaments"),
    relPrefix: "/uploads/tournaments/",
    width: 1600,
    height: 1600,
    fit: "inside",
    quality: 82,
  },
};

function detectFormat(buffer: Buffer): "png" | "jpeg" | "webp" | null {
  if (buffer.length < 12) return null;
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export async function processAndStoreImage(
  file: File,
  kind: UploadKind,
  ownerId: number,
): Promise<string> {
  if (!file || typeof file.size !== "number") {
    throw new Error("FILE_MISSING");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("IMAGE_TOO_LARGE");
  }

  const arrayBuffer = await file.arrayBuffer();
  return storeImageBuffer(Buffer.from(arrayBuffer), file.type, kind, ownerId);
}

/**
 * Le même traitement, à partir d'octets déjà en main.
 *
 * Tout ce qui suit la lecture du fichier vaut mot pour mot pour une image
 * **téléchargée** : la photo de profil d'un compte Google, copiée chez nous à
 * la connexion (`lib/server/user-avatar-import.ts`), doit subir les mêmes
 * contrôles de format et la même normalisation qu'un téléversement — c'est un
 * octet venu d'ailleurs dans les deux cas.
 *
 * Le corps a été extrait plutôt que recopié : une seconde implémentation aurait
 * fini par accepter ce que celle-ci refuse, et l'écart se serait creusé du côté
 * qui ne passe par aucun formulaire.
 *
 * @param buffer Octets de l'image.
 * @param declaredMime Type annoncé par la source ; confronté aux octets réels.
 * @param kind Gabarit de sortie (dimensions, cadrage, qualité).
 * @param ownerId Identifiant repris dans le nom du fichier.
 * @returns Le chemin disque relatif (`/uploads/...`) du fichier écrit.
 */
export async function storeImageBuffer(
  buffer: Buffer,
  declaredMime: string,
  kind: UploadKind,
  ownerId: number,
): Promise<string> {
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error("IMAGE_TOO_LARGE");
  }
  if (!ALLOWED_MIME.has(declaredMime)) {
    throw new Error("IMAGE_FORMAT_INVALID");
  }

  const detected = detectFormat(buffer);
  if (!detected) {
    throw new Error("IMAGE_FORMAT_INVALID");
  }
  const declaredFromMime =
    declaredMime === "image/png" ? "png" : declaredMime === "image/jpeg" ? "jpeg" : "webp";
  if (detected !== declaredFromMime) {
    throw new Error("IMAGE_FORMAT_INVALID");
  }

  const pipeline = sharp(buffer, { failOn: "error" });
  const meta = await pipeline.metadata();

  if (!meta.width || !meta.height) {
    throw new Error("IMAGE_DIMENSIONS_INVALID");
  }
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    throw new Error("IMAGE_DIMENSIONS_INVALID");
  }
  if (meta.pages && meta.pages > 1) {
    throw new Error("IMAGE_ANIMATED_NOT_SUPPORTED");
  }

  const config = KIND_CONFIG[kind];

  const resized =
    config.fit === "cover"
      ? pipeline.resize(config.width, config.height, { fit: "cover", position: "centre" })
      : config.fit === "inside"
        ? pipeline.resize(config.width, config.height, { fit: "inside", withoutEnlargement: true })
        : pipeline.resize(config.width, config.height, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          });

  const output = await resized.webp({ quality: config.quality }).toBuffer();

  const hash = crypto.randomBytes(8).toString("hex");
  const filename = `${ownerId}-${hash}.webp`;
  const absPath = path.join(config.dir, filename);
  // Le dossier d'un gabarit ajouté après coup n'existe pas forcément sur un
  // serveur déjà déployé (seul son `.gitkeep` le crée) : l'écriture ne doit pas
  // en dépendre.
  await mkdir(config.dir, { recursive: true });
  await writeFile(absPath, output);

  return `${config.relPrefix}${filename}`;
}

export async function deleteStoredImage(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  const allowed =
    relativePath.startsWith("/uploads/avatars/") ||
    relativePath.startsWith("/uploads/teams/") ||
    relativePath.startsWith("/uploads/sponsors/") ||
    relativePath.startsWith("/uploads/benevoles/") ||
    relativePath.startsWith("/uploads/tournaments/");
  if (!allowed) return;

  const safeRelative = relativePath.replace(/^\/+/, "");
  if (safeRelative.includes("..")) return;

  const absPath = path.join(process.cwd(), "public", safeRelative);
  try {
    await unlink(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}
