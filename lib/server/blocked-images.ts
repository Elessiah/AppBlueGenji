import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
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

/** `liftable` : le geste laisse une ligne de quarantaine qui le justifie (D18). */
export type BlockOptions = { liftable?: boolean };

/**
 * Pose ces empreintes, hors transaction, sur le pool. Par défaut **non
 * levables** : ces gestes (fiche du joueur, effacement d'un compte) ne laissent
 * aucune ligne qu'une contestation pourrait annuler ; une empreinte déjà posée
 * le devient. `liftable` : levables, une empreinte déjà posée garde son état.
 * Datée du jour seulement : l'instant d'un effacement de compte, rapproché du
 * journal des suppressions, relierait l'empreinte au compte (D31).
 */
async function blockImageHashes(hashes: readonly string[], options: BlockOptions = {}): Promise<void> {
  const unique = [...new Set(hashes)];
  if (unique.length === 0) return;
  const db = await getDatabase();
  // Une seule insertion multi-lignes : un aller-retour, quel que soit le nombre d'images.
  await ignoreMissingTable(
    db.execute(
      options.liftable
        ? `INSERT IGNORE INTO bg_blocked_image_hashes (sha256, liftable, created_at) VALUES ${unique.map(() => "(?, 1, CURRENT_DATE)").join(", ")}`
        : `INSERT INTO bg_blocked_image_hashes (sha256, created_at) VALUES ${unique.map(() => "(?, CURRENT_DATE)").join(", ")}
         ON DUPLICATE KEY UPDATE liftable = 0`,
      unique,
    ),
  );
}

/**
 * Bloque les images de ces fichiers, que la modération vient de supprimer
 * (décision D6) — à appeler **après** le commit qui les retire et **avant**
 * l'`unlink` : le fichier doit encore se lire. Hors transaction, sans verrou :
 * chaque empreinte est une insertion autonome. **Ne lève jamais** : la
 * suppression est faite, un échec ici ne la défait pas. L'insertion est
 * retentée une fois ; si elle échoue encore, les empreintes elles-mêmes sont
 * consignées (pm2) — le fichier part juste après et elles ne se recalculeraient
 * plus —, pour qu'un exploitant les pose à la main. Une empreinte n'identifie
 * personne.
 */
export async function blockRemovedImageFiles(
  absolutePaths: readonly string[],
  options: BlockOptions = {},
): Promise<void> {
  if (absolutePaths.length === 0) return;
  // Chaque lecture est rattrapée : un fichier illisible est seulement omis.
  const read = await Promise.all(
    absolutePaths.map((file) =>
      readFile(file).then(
        (content) => ({ file, sha: imageSha256(content) as string | null }),
        () => ({ file, sha: null }),
      ),
    ),
  );
  const hashes = read.flatMap((entry) => (entry.sha === null ? [] : [entry.sha]));
  const missing = read.filter((entry) => entry.sha === null).map((entry) => anonymousFileName(entry.file));
  if (missing.length > 0) {
    // Un fichier que la modération supprime manquait déjà (course avec une
    // rotation, effacement à la main) : son image n'est pas bloquée et
    // pourrait revenir — consigné, nom du fichier compris, pour qu'un
    // exploitant le retrouve (sauvegarde) et pose son empreinte à la main.
    console.error(
      `[moderation] image supprimée introuvable, empreinte non bloquée (${missing.length} fichier(s)) : ${missing.join(", ")}`,
    );
  }
  await blockImageHashesSafely(hashes, options);
}

/**
 * Pose ces empreintes déjà calculées — même garantie que
 * `blockRemovedImageFiles` : **ne lève jamais**, une reprise, puis les
 * empreintes consignées (pm2) pour une pose à la main.
 */
export async function blockImageHashesSafely(hashes: readonly string[], options: BlockOptions = {}): Promise<void> {
  if (hashes.length === 0) return;
  for (let attempt = 1; attempt <= BLOCK_ATTEMPTS; attempt += 1) {
    try {
      await blockImageHashes(hashes, options);
      return;
    } catch (error) {
      if (attempt === BLOCK_ATTEMPTS) {
        console.error(
          `[moderation] empreintes à bloquer à la main (bg_blocked_image_hashes) : ${hashes.join(", ")}`,
          error,
        );
      }
    }
  }
}

/**
 * L'empreinte d'un fichier, ou `null` s'il ne se lit pas (déjà parti) — lue
 * avant l'effacement, pour être gardée sur la ligne de la décision
 * (`bg_logo_quarantines.image_sha256`, décisions D18 et D22).
 */
export async function readImageSha256(absolutePath: string): Promise<string | null> {
  return readFile(absolutePath).then(
    (content) => imageSha256(content),
    () => null,
  );
}

/** Ce qu'il faut pour écrire dans la transaction de l'appelant. */
type Executor = Pick<PoolConnection, "execute">;

/**
 * Bloque une empreinte au nom d'une décision **tracée** sur sa ligne de
 * quarantaine (`hash_blocked = 1`), dans la transaction de l'appelant : une
 * empreinte neuve est levable (D18) ; une empreinte déjà posée garde son état
 * — non levable, elle le reste.
 */
export async function blockImageHashOn(connection: Executor, sha256: string): Promise<void> {
  await ignoreMissingTable(
    connection.execute(
      `INSERT IGNORE INTO bg_blocked_image_hashes (sha256, liftable, created_at) VALUES (?, 1, CURRENT_DATE)`,
      [sha256],
    ),
  );
}

/**
 * Avant l'effacement d'un compte, qui emporte ses lignes de quarantaine : les
 * empreintes de ses avatars supprimés par la modération et non rétablis en
 * contestation (issue nulle ou maintenue) sont bloquées, **non levables** —
 * sans quoi l'annulation d'une autre suppression de la même image lèverait un
 * blocage que plus rien n'explique, et une suppression dont la contestation
 * attendait son issue (purge d'office, non bloquée) partirait sans décision
 * possible (revue sécurité #571, cycles 2 et 3). Une empreinte neuve porte le
 * **jour** de la suppression la plus ancienne, jamais l'instant de
 * l'effacement : rapprochée du journal des suppressions, une date d'effacement
 * relierait l'empreinte au compte (D31).
 */
export async function pinAccountBlockedHashesOn(connection: Executor, userId: number): Promise<void> {
  await ignoreMissingTable(
    connection.execute(
      `INSERT INTO bg_blocked_image_hashes (sha256, liftable, created_at)
       SELECT image_sha256, 0, DATE(MIN(hidden_at)) FROM bg_logo_quarantines
        WHERE user_id = ? AND status = 'PURGED' AND image_sha256 IS NOT NULL
          AND (contest_outcome IS NULL OR contest_outcome = 'UPHELD')
        GROUP BY image_sha256
       ON DUPLICATE KEY UPDATE liftable = 0`,
      [userId],
    ),
  );
}

/**
 * À l'effacement d'un compte, dans sa transaction : fige les blocages que ses
 * lignes de quarantaine justifiaient (`pinAccountBlockedHashesOn`), puis retire
 * ces lignes — seul lien entre une empreinte et un compte (D31) —, sans
 * dépendre de la cascade (clé étrangère absente d'une base ancienne). Les deux
 * gestes vont ensemble : figer sans délier garderait le lien, délier sans figer
 * laisserait un blocage levable que plus rien n'explique.
 */
export async function retireAccountQuarantinesOn(connection: Executor, userId: number): Promise<void> {
  await pinAccountBlockedHashesOn(connection, userId);
  await ignoreMissingTable(connection.execute(`DELETE FROM bg_logo_quarantines WHERE user_id = ?`, [userId]));
}

/**
 * Lève le blocage d'une empreinte (contestation acceptée, D18), dans la
 * transaction de l'appelant — sauf si une **autre** suppression de modération
 * de la même image le justifie encore (ligne `PURGED` qui l'a bloquée,
 * `hash_blocked = 1`), relue en lecture courante : une suppression commitée
 * pendant l'attente est vue ; et jamais un blocage non levable (`liftable =
 * 0` : posé sans trace qui le justifie). Rend `true` si l'empreinte a été
 * retirée.
 */
export async function unblockImageHashOn(connection: Executor, sha256: string, exceptQuarantineId: number): Promise<boolean> {
  const [others] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_logo_quarantines
      WHERE image_sha256 = ? AND id <> ? AND status = 'PURGED' AND hash_blocked = 1
      LIMIT 1 LOCK IN SHARE MODE`,
    [sha256, exceptQuarantineId],
  );
  if (others.length > 0) return false;
  try {
    const [result] = await connection.execute<ResultSetHeader>(`DELETE FROM bg_blocked_image_hashes WHERE sha256 = ? AND liftable = 1`, [
      sha256,
    ]);
    return Number(result.affectedRows) > 0;
  } catch (error) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
}

/**
 * Le nom d'un fichier sans les identifiants de compte qu'il porte
 * (`user-<id>-<id>-<empreinte>.webp` → `<empreinte>.webp`) : le journal pm2 ne
 * relie pas un compte à une décision de modération.
 */
export function anonymousFileName(file: string): string {
  return path.basename(file).split("-").pop() ?? "";
}

/** Insertion de l'empreinte : une tentative, puis une reprise (verrou ou pool saturé passagers). */
const BLOCK_ATTEMPTS = 2;
