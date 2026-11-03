import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { ignoreMissingTable, isMissingTableError } from "@/lib/server/mysql-errors";

/**
 * Empreintes d'images refusées au téléversement (`docs/features/ACCOUNT_DELETION.md`,
 * décision E6).
 *
 * Un compte effacé emporte son avatar **en quarantaine** (cascade de
 * `bg_logo_quarantines`) : l'image signalée disparaît, mais son empreinte reste,
 * et un nouveau compte ne peut pas la reposer telle quelle. L'empreinte est
 * celle de l'image **traitée** (le WebP que `storeImageBuffer` écrit) : le même
 * fichier, recadré de la même façon, ressort à l'identique ; un autre recadrage
 * ou une retouche y échappent — c'est un garde-fou, pas une modération.
 *
 * L'empreinte d'une image n'identifie personne ; aucune colonne ne désigne de
 * compte.
 */

/** Refus d'un téléversement dont l'image est bloquée. */
export const IMAGE_BLOCKED = "IMAGE_BLOCKED";

/** SHA-256 hexadécimal d'un contenu. */
export function imageSha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** L'image traitée est-elle bloquée ? Table absente (migration en échec) = non. */
export async function isBlockedImage(content: Buffer): Promise<boolean> {
  const db = await getDatabase();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM bg_blocked_image_hashes WHERE sha256 = ? LIMIT 1`,
      [imageSha256(content)],
    );
    return rows.length > 0;
  } catch (error) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
}

/**
 * Bloque les images de ces fichiers, sur la connexion de la transaction qui les
 * emporte. Un fichier illisible (déjà parti) est passé : il n'y a plus rien à
 * reposer. Rend les empreintes posées.
 */
export async function blockImageFiles(
  connection: Pick<PoolConnection, "execute">,
  absolutePaths: readonly string[],
): Promise<string[]> {
  const hashes: string[] = [];
  for (const file of absolutePaths) {
    let content: Buffer;
    try {
      content = await readFile(file);
    } catch {
      continue;
    }
    const sha = imageSha256(content);
    await ignoreMissingTable(
      connection.execute(`INSERT IGNORE INTO bg_blocked_image_hashes (sha256) VALUES (?)`, [sha]),
    );
    hashes.push(sha);
  }
  return hashes;
}
