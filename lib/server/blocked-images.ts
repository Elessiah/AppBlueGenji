import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { ignoreMissingTable, isMissingTableError } from "@/lib/server/mysql-errors";

/**
 * Empreintes d'images refusées au téléversement (`docs/features/ACCOUNT_DELETION.md`,
 * décision E6, revue par D6 le 2026-11-09).
 *
 * Un avatar que la modération **supprime** — sans délai, à l'échéance de sa
 * quarantaine ou après une contestation rejetée, ou retiré depuis la fiche —
 * laisse son empreinte ici avant que le fichier ne parte
 * (`blockRemovedImageFiles`) : son titulaire, ou un autre compte, ne peut pas
 * reposer la même image. Un avatar seulement **masqué** (quarantaine `HIDDEN`)
 * se conteste encore : il n'est pas bloqué, même si son compte est effacé
 * entre-temps. L'empreinte est celle du fichier tel qu'il était servi (le WebP
 * que `storeImageBuffer` écrit) ; au téléversement, l'image traitée **et** le
 * fichier brut sont comparés. Un autre recadrage ou une retouche y échappent —
 * c'est un garde-fou, pas une modération.
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

/**
 * L'une de ces images (l'image traitée, et le fichier tel que téléversé) est-elle
 * bloquée ? Le fichier brut compte : la copie exacte d'un avatar servi, reposée
 * telle quelle, est réencodée en d'autres octets. Table absente (migration en
 * échec) = non.
 */
export async function isBlockedImage(...contents: Buffer[]): Promise<boolean> {
  if (contents.length === 0) return false;
  const db = await getDatabase();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM bg_blocked_image_hashes WHERE sha256 IN (${contents.map(() => "?").join(", ")}) LIMIT 1`,
      contents.map((content) => imageSha256(content)),
    );
    return rows.length > 0;
  } catch (error) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
}

/**
 * L'empreinte de chacun de ces fichiers, lus **en parallèle**, à lire hors de
 * toute transaction. Un fichier illisible (déjà parti) est passé : il n'y a
 * plus rien à reposer.
 */
export async function hashImageFiles(absolutePaths: readonly string[]): Promise<string[]> {
  const hashes = await Promise.all(
    absolutePaths.map((file) =>
      readFile(file).then(
        (content) => imageSha256(content),
        () => null,
      ),
    ),
  );
  return hashes.filter((sha): sha is string => sha !== null);
}

/** Pose ces empreintes (doublons ignorés), sur la connexion ou le pool donné. */
export async function blockImageHashes(
  connection: Pick<PoolConnection, "execute">,
  hashes: readonly string[],
): Promise<void> {
  const unique = [...new Set(hashes)];
  if (unique.length === 0) return;
  // Une seule insertion multi-lignes : un aller-retour, quel que soit le nombre d'images.
  await ignoreMissingTable(
    connection.execute(
      `INSERT IGNORE INTO bg_blocked_image_hashes (sha256) VALUES ${unique.map(() => "(?)").join(", ")}`,
      unique,
    ),
  );
}

/**
 * Bloque les images de ces fichiers, que la modération vient de supprimer
 * (décision D6) — à appeler **après** le commit qui les retire et **avant**
 * l'`unlink` : le fichier doit encore se lire. Hors transaction, sans verrou :
 * chaque empreinte est une insertion autonome. **Ne lève jamais** : la
 * suppression est faite, un échec ici ne la défait pas et se consigne.
 */
export async function blockRemovedImageFiles(absolutePaths: readonly string[]): Promise<void> {
  if (absolutePaths.length === 0) return;
  try {
    const hashes = await hashImageFiles(absolutePaths);
    if (hashes.length === 0) return;
    const db = await getDatabase();
    await blockImageHashes(db, hashes);
  } catch (error) {
    console.error("[moderation] empreinte de l'image supprimée non bloquée", error);
  }
}
