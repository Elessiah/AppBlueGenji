import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { ignoreMissingTable, isMissingTableError } from "@/lib/server/mysql-errors";
import { failureReason } from "@/lib/server/failure-reason";
import { imagePerceptualHash, PHASH_MATCH_DISTANCE } from "@/lib/server/image-phash";

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
 * fichier brut sont comparés.
 *
 * À côté du SHA-256, une **empreinte perceptuelle** (`phash`, décision D17,
 * `image-phash.ts`, `docs/features/BLOCKED_IMAGE_PHASH.md`) : l'image traitée
 * d'un téléversement est aussi refusée si son allure est à
 * `PHASH_MATCH_DISTANCE` bits au plus de celle d'une image bloquée — un cadre
 * un peu décalé, un autre format source, un réencodage ne passent plus. Une
 * empreinte posée avant D17 n'a que son SHA-256 (le fichier est parti, rien
 * ne se recalcule). Une retouche franche y échappe encore — c'est un
 * garde-fou, pas une modération.
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
 * Les deux empreintes d'une image bloquée : `sha256` (octets exacts, clé de la
 * liste) et `phash` (allure, entier de 64 bits écrit en décimal ; `null` pour
 * une image presque unie ou indécodable — elle n'est alors bloquée que par
 * ses octets).
 */
export type ImageFingerprint = { sha256: string; phash: string | null };

/** Les deux empreintes d'un contenu. */
export async function imageFingerprint(content: Buffer): Promise<ImageFingerprint> {
  return { sha256: imageSha256(content), phash: await imagePerceptualHash(content) };
}

/**
 * L'image traitée (et, s'il est donné, le fichier tel que téléversé) est-elle
 * bloquée ? Par ses octets : le fichier brut compte, la copie exacte d'un
 * avatar servi, reposée telle quelle, étant réencodée en d'autres octets ; par
 * son allure : l'empreinte perceptuelle de l'image **traitée** — celle qui
 * serait servie, comparable à celle des avatars bloqués — à
 * `PHASH_MATCH_DISTANCE` bits au plus d'une empreinte bloquée.
 *
 * L'empreinte voyage en texte décimal et passe par `DECIMAL(20,0)` avant
 * `UNSIGNED` : en requête préparée, MySQL 8 lit le seul cast `UNSIGNED` d'une
 * chaîne comme un entier **signé** et plafonne tout au-delà de 2^63 − 1 —
 * la moitié des empreintes y seraient faussées (mesuré sur la base de
 * développement).
 *
 * Une requête, comparaison faite en SQL (`BIT_COUNT` du OU exclusif) : la
 * liste ne grandit qu'avec les suppressions de la modération (quelques
 * dizaines de lignes), son parcours complet coûte moins qu'un aller-retour,
 * et aucune empreinte ne quitte la base. Table absente (migration en échec) =
 * non.
 */
export async function isBlockedImage(processed: Buffer, original?: Buffer): Promise<boolean> {
  const hashes = [imageSha256(processed)];
  if (original) hashes.push(imageSha256(original));
  const phash = await imagePerceptualHash(processed);
  const perceptual =
    phash === null ? "" : " OR (phash IS NOT NULL AND BIT_COUNT(phash ^ CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)) <= ?)";
  const db = await getDatabase();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM bg_blocked_image_hashes WHERE sha256 IN (${hashes.map(() => "?").join(", ")})${perceptual} LIMIT 1`,
      phash === null ? hashes : [...hashes, phash, PHASH_MATCH_DISTANCE],
    );
    return rows.length > 0;
  } catch (error) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
}

/**
 * `liftable` : le geste laisse une ligne de quarantaine qui le justifie (D18).
 * `day` (`AAAA-MM-JJ`) : jour à porter sur une empreinte neuve à la place du
 * jour courant — l'effacement d'un compte y met le jour de la suppression de
 * modération, jamais le sien (D31).
 */
export type BlockOptions = { liftable?: boolean; day?: string };

/** Jour d'une empreinte neuve : celui donné s'il a la forme `AAAA-MM-JJ`, sinon le jour courant. */
function blockDay(options: BlockOptions): { sql: string; params: string[] } {
  return options.day && /^\d{4}-\d{2}-\d{2}$/.test(options.day)
    ? { sql: "?", params: [options.day] }
    : { sql: "CURRENT_DATE", params: [] };
}

/**
 * Pose ces empreintes, hors transaction, sur le pool. Par défaut **non
 * levables** : ces gestes (fiche du joueur, effacement d'un compte) ne laissent
 * aucune ligne qu'une contestation pourrait annuler ; une empreinte déjà posée
 * le devient. `liftable` : levables, une empreinte déjà posée garde son état.
 * Datée du jour seulement : l'instant d'un effacement de compte, rapproché du
 * journal des suppressions, relierait l'empreinte au compte (D31).
 */
async function blockImageHashes(fingerprints: readonly ImageFingerprint[], options: BlockOptions = {}): Promise<void> {
  const unique = uniqueFingerprints(fingerprints);
  if (unique.length === 0) return;
  const db = await getDatabase();
  const day = blockDay(options);
  const liftableRow = "(?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), 1, " + day.sql + ")";
  const pinnedRow = "(?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), " + day.sql + ")";
  // Une seule insertion multi-lignes : un aller-retour, quel que soit le nombre
  // d'images. Une ligne déjà posée sans empreinte perceptuelle la reçoit.
  await ignoreMissingTable(
    db.execute(
      options.liftable
        ? `INSERT INTO bg_blocked_image_hashes (sha256, phash, liftable, created_at) VALUES ${unique.map(() => liftableRow).join(", ")}
         ON DUPLICATE KEY UPDATE ${KEEP_OR_ADD_PHASH}`
        : `INSERT INTO bg_blocked_image_hashes (sha256, phash, created_at) VALUES ${unique.map(() => pinnedRow).join(", ")}
         ON DUPLICATE KEY UPDATE liftable = 0, ${KEEP_OR_ADD_PHASH}`,
      unique.flatMap((entry) => [entry.sha256, entry.phash, ...day.params]),
    ),
  );
}

/**
 * Une ligne déjà posée garde son empreinte perceptuelle, ou reçoit celle
 * qu'on lui apporte si elle n'en avait pas (ligne d'avant D17).
 */
const KEEP_OR_ADD_PHASH = "phash = COALESCE(phash, VALUES(phash))";

/** Une entrée par SHA-256 — une empreinte perceptuelle connue l'emporte sur son absence. */
function uniqueFingerprints(fingerprints: readonly ImageFingerprint[]): ImageFingerprint[] {
  const bySha = new Map<string, ImageFingerprint>();
  for (const entry of fingerprints) {
    const known = bySha.get(entry.sha256);
    if (!known || (known.phash === null && entry.phash !== null)) bySha.set(entry.sha256, entry);
  }
  return [...bySha.values()];
}

/** Une empreinte telle qu'écrite au journal pour une pose à la main. */
function fingerprintLabel(entry: ImageFingerprint): string {
  return entry.phash === null ? entry.sha256 : `${entry.sha256} (phash ${entry.phash})`;
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
    absolutePaths.map(async (file) => ({ file, fingerprint: await readImageFingerprint(file) })),
  );
  const hashes = read.flatMap((entry) => (entry.fingerprint === null ? [] : [entry.fingerprint]));
  const missing = read.filter((entry) => entry.fingerprint === null).map((entry) => anonymousFileName(entry.file));
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
export async function blockImageHashesSafely(
  hashes: readonly ImageFingerprint[],
  options: BlockOptions = {},
): Promise<void> {
  if (hashes.length === 0) return;
  for (let attempt = 1; attempt <= BLOCK_ATTEMPTS; attempt += 1) {
    try {
      await blockImageHashes(hashes, options);
      return;
    } catch (error) {
      if (attempt === BLOCK_ATTEMPTS) {
        console.error(
          `[moderation] empreintes à bloquer à la main (bg_blocked_image_hashes) : ${hashes.map(fingerprintLabel).join(", ")}`,
          failureReason(error),
        );
      }
    }
  }
}

/**
 * Les empreintes d'un fichier, ou `null` s'il ne se lit pas (déjà parti) —
 * lues avant l'effacement, pour être gardées sur la ligne de la décision
 * (`bg_logo_quarantines.image_sha256` et `image_phash`, décisions D18, D22, D17).
 */
export async function readImageFingerprint(absolutePath: string): Promise<ImageFingerprint | null> {
  const content = await readFile(absolutePath).catch(() => null);
  return content === null ? null : imageFingerprint(content);
}

/** Ce qu'il faut pour écrire dans la transaction de l'appelant. */
type Executor = Pick<PoolConnection, "execute">;

/**
 * Bloque une empreinte au nom d'une décision **tracée** sur sa ligne de
 * quarantaine (`hash_blocked = 1`), dans la transaction de l'appelant : une
 * empreinte neuve est levable (D18) ; une empreinte déjà posée garde son état
 * — non levable, elle le reste.
 */
export async function blockImageHashOn(connection: Executor, fingerprint: ImageFingerprint): Promise<void> {
  await ignoreMissingTable(
    connection.execute(
      `INSERT INTO bg_blocked_image_hashes (sha256, phash, liftable, created_at) VALUES (?, CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED), 1, CURRENT_DATE)
       ON DUPLICATE KEY UPDATE ${KEEP_OR_ADD_PHASH}`,
      [fingerprint.sha256, fingerprint.phash],
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
 * **jour** de la suppression la plus ancienne (sa purge, à défaut son
 * masquage), jamais l'instant de l'effacement : rapprochée du journal des suppressions, une date d'effacement
 * relierait l'empreinte au compte (D31).
 */
export async function pinAccountBlockedHashesOn(connection: Executor, userId: number): Promise<void> {
  await ignoreMissingTable(
    connection.execute(
      `INSERT INTO bg_blocked_image_hashes (sha256, phash, liftable, created_at)
       SELECT image_sha256, MAX(image_phash), 0, DATE(MIN(COALESCE(closed_at, hidden_at))) FROM bg_logo_quarantines
        WHERE user_id = ? AND status = 'PURGED' AND image_sha256 IS NOT NULL
          AND (contest_outcome IS NULL OR contest_outcome = 'UPHELD')
        GROUP BY image_sha256
       ON DUPLICATE KEY UPDATE liftable = 0, ${KEEP_OR_ADD_PHASH}`,
      [userId],
    ),
  );
}

/**
 * Avant l'effacement de ces lignes de quarantaine closes (D87,
 * `purgeClosedQuarantines`), dans sa transaction : les empreintes que leurs
 * suppressions **ont bloquées** (`hash_blocked = 1`) deviennent **non
 * levables** — sans quoi l'annulation d'une autre suppression de la même image
 * lèverait un blocage que plus rien n'explique. Une empreinte neuve porte le
 * **jour** de la suppression, jamais celui de l'effacement (D31).
 */
export async function pinClosedQuarantineHashesOn(connection: Executor, quarantineIds: readonly number[]): Promise<void> {
  if (quarantineIds.length === 0) return;
  await ignoreMissingTable(
    connection.execute(
      `INSERT INTO bg_blocked_image_hashes (sha256, phash, liftable, created_at)
       SELECT image_sha256, MAX(image_phash), 0, DATE(MIN(COALESCE(closed_at, hidden_at))) FROM bg_logo_quarantines
        WHERE id IN (${quarantineIds.map(() => "?").join(", ")})
          AND status = 'PURGED' AND hash_blocked = 1 AND image_sha256 IS NOT NULL
        GROUP BY image_sha256
       ON DUPLICATE KEY UPDATE liftable = 0, ${KEEP_OR_ADD_PHASH}`,
      [...quarantineIds],
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
