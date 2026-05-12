import crypto from "node:crypto";
import path from "node:path";
import { unlink, writeFile } from "node:fs/promises";
import sharp from "sharp";

export type UploadKind = "avatar" | "team-logo";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 8000;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const KIND_CONFIG: Record<
  UploadKind,
  { dir: string; relPrefix: string; size: number; fit: "cover" | "contain"; quality: number }
> = {
  avatar: {
    dir: path.join(process.cwd(), "public", "uploads", "avatars"),
    relPrefix: "/uploads/avatars/",
    size: 256,
    fit: "cover",
    quality: 80,
  },
  "team-logo": {
    dir: path.join(process.cwd(), "public", "uploads", "teams"),
    relPrefix: "/uploads/teams/",
    size: 512,
    fit: "contain",
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
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error("IMAGE_FORMAT_INVALID");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const detected = detectFormat(buffer);
  if (!detected) {
    throw new Error("IMAGE_FORMAT_INVALID");
  }
  const declaredFromMime =
    file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpeg" : "webp";
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
      ? pipeline.resize(config.size, config.size, { fit: "cover", position: "centre" })
      : pipeline.resize(config.size, config.size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });

  const output = await resized.webp({ quality: config.quality }).toBuffer();

  const hash = crypto.randomBytes(8).toString("hex");
  const filename = `${ownerId}-${hash}.webp`;
  const absPath = path.join(config.dir, filename);
  await writeFile(absPath, output);

  return `${config.relPrefix}${filename}`;
}

export async function deleteStoredImage(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  const allowed =
    relativePath.startsWith("/uploads/avatars/") || relativePath.startsWith("/uploads/teams/");
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
