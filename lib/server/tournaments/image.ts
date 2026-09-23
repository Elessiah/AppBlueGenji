/**
 * Illustration ou logo d'un tournoi : écriture du fichier et de son cadrage.
 *
 * Toute la règle (modes, point focal, bornes) vit dans le module pur
 * `lib/shared/tournament-image.ts` ; ce fichier ne fait que l'appliquer à la
 * base et au disque, puis publier l'événement qui réveille les pages ouvertes.
 *
 * **Aucune garde d'état**, comme pour la chaîne officielle : l'image est
 * décorative, elle n'entre dans aucune règle du moteur. Poser un logo sur un
 * tournoi en cours ou sur une archive est légitime.
 *
 * Trois règles d'écriture, communes aux trois gestes :
 *
 * - le fichier est **traité avant** la transaction : la conversion (sharp) est
 *   le seul temps long, il ne doit pas tenir un verrou sur `bg_tournaments` ;
 * - l'ancienne image est relue **sous verrou** (`FOR UPDATE`) : deux envois
 *   simultanés s'ordonnent, chacun efface bien le fichier que l'autre avait
 *   posé, et aucun ne reste orphelin ;
 * - un fichier n'est effacé **qu'après le commit** — un `unlink` ne se défait
 *   pas —, et le fichier neuf est repris si l'écriture échoue.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import {
  DEFAULT_IMAGE_SETTINGS,
  type TournamentImage,
  type TournamentImageSettings,
} from "@/lib/shared/tournament-image";
import { localUploadUrl, toDiskUploadPath, toServedUploadUrl } from "@/lib/shared/uploads";
import { publishUpdatedEvent } from "./notifications";

type ImageRow = RowDataPacket & { image_url: string | null };

/** Ouvre la transaction et verrouille la ligne ; `TOURNAMENT_NOT_FOUND` sinon. */
async function lockTournamentImage(connection: PoolConnection, tournamentId: number): Promise<string | null> {
  const [rows] = await connection.execute<ImageRow[]>(
    `SELECT image_url FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`,
    [tournamentId],
  );
  if (rows.length === 0) throw new Error("TOURNAMENT_NOT_FOUND");
  return rows[0].image_url ?? null;
}

/**
 * Exécute `write` dans une transaction qui a verrouillé la ligne du tournoi, et
 * rend l'URL d'image qu'il y avait avant.
 */
async function withLockedImage(
  tournamentId: number,
  write: (connection: PoolConnection, previousUrl: string | null) => Promise<void>,
): Promise<string | null> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const previousUrl = await lockTournamentImage(connection, tournamentId);
    await write(connection, previousUrl);
    await connection.commit();
    return previousUrl;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Efface un fichier désormais inutile ; un échec se journalise sans remonter. */
async function discardFile(url: string | null): Promise<void> {
  try {
    await deleteStoredImage(toDiskUploadPath(url));
  } catch (error) {
    console.error(`[tournaments] fichier d'image non effacé (${url})`, error);
  }
}

/**
 * Pose (ou remplace) l'image d'un tournoi.
 *
 * @throws `TOURNAMENT_NOT_FOUND`, ou l'erreur de traitement d'image
 *   (`IMAGE_TOO_LARGE`, `IMAGE_FORMAT_INVALID`…) — voir `image-upload.ts`.
 */
export async function setTournamentImage(
  tournamentId: number,
  file: File,
  settings: TournamentImageSettings,
): Promise<TournamentImage> {
  const url = toServedUploadUrl(await processAndStoreImage(file, "tournament-image", tournamentId));

  let previousUrl: string | null;
  try {
    previousUrl = await withLockedImage(tournamentId, async (connection) => {
      await connection.execute(
        `UPDATE bg_tournaments
         SET image_url = ?, image_fit = ?, image_focus_x = ?, image_focus_y = ?
         WHERE id = ?`,
        [url, settings.fit, settings.focusX, settings.focusY, tournamentId],
      );
    });
  } catch (error) {
    // Le fichier est écrit mais aucune ligne ne le désigne : on le reprend.
    await discardFile(url);
    throw error;
  }

  if (previousUrl !== url) await discardFile(previousUrl);
  publishUpdatedEvent(tournamentId);
  return { url, ...settings };
}

/**
 * Change le cadrage de l'image déjà posée, sans renvoyer de fichier.
 *
 * @throws `TOURNAMENT_NOT_FOUND` | `TOURNAMENT_IMAGE_MISSING` (rien à cadrer :
 *   l'image a été retirée entre l'ouverture du réglage et son envoi).
 */
export async function updateTournamentImageSettings(
  tournamentId: number,
  settings: TournamentImageSettings,
): Promise<TournamentImage> {
  const url = await withLockedImage(tournamentId, async (connection, previousUrl) => {
    // Jugé sur l'URL **filtrée** (`localUploadUrl`), comme toute lecture : une
    // adresse étrangère restée en base ne s'affiche pas, il n'y a donc rien à
    // cadrer — et le refus doit tomber avant l'écriture, pas après.
    if (localUploadUrl(previousUrl) === null) throw new Error("TOURNAMENT_IMAGE_MISSING");
    await connection.execute(
      `UPDATE bg_tournaments SET image_fit = ?, image_focus_x = ?, image_focus_y = ? WHERE id = ?`,
      [settings.fit, settings.focusX, settings.focusY, tournamentId],
    );
  });

  publishUpdatedEvent(tournamentId);
  return { url: url as string, ...settings };
}

/**
 * Retire l'image d'un tournoi. Idempotent : un tournoi sans image reste sans
 * image, sans erreur.
 *
 * Le cadrage revient au défaut : une prochaine image n'a aucune raison
 * d'hériter du point focal d'une autre.
 *
 * @throws `TOURNAMENT_NOT_FOUND`
 */
export async function removeTournamentImage(tournamentId: number): Promise<void> {
  const previousUrl = await withLockedImage(tournamentId, async (connection, current) => {
    if (current === null) return;
    await connection.execute(
      `UPDATE bg_tournaments
       SET image_url = NULL, image_fit = ?, image_focus_x = ?, image_focus_y = ?
       WHERE id = ?`,
      [DEFAULT_IMAGE_SETTINGS.fit, DEFAULT_IMAGE_SETTINGS.focusX, DEFAULT_IMAGE_SETTINGS.focusY, tournamentId],
    );
  });

  if (previousUrl === null) return;
  await discardFile(previousUrl);
  publishUpdatedEvent(tournamentId);
}
