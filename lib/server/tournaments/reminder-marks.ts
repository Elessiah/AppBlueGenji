/**
 * Marques de rappel d'une manche (`bg_match_reminders` : observation, palier,
 * horaire reçu — `./match-reminders`).
 *
 * Une seule règle, appliquée partout où l'affiche d'une manche change ou
 * disparaît (correction d'un score amont, retour en arrière, arbre réécrit) :
 * ses marques appartenaient à l'ancienne affiche. Les nouvelles engagées n'ont
 * reçu aucun horaire et doivent recevoir l'annonce.
 */
import type { PoolConnection } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { ignoreMissingTable, isMissingTableError } from "@/lib/server/mysql-errors";
import { chunkIds, sqlPlaceholders } from "@/lib/server/sql-placeholders";
import { MATCH_STAFF_KEY } from "@/lib/shared/discord-notifications";

/**
 * Un horaire reçu vaut encore tant qu'il est devant, ou passé depuis moins de
 * 12 h (un match en retard) : il se cite, se retire, et son retrait se dit.
 */
export const HELD_TIME_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * Rend des marques réservées (observation, palier) — **seulement celles prises
 * pour cet horaire** (`start_at <=> ?` : chaque réservation date la sienne,
 * `setMatchStartAt` aussi). Un ancien envoi en échec n'efface ainsi jamais les
 * marques d'un changement plus récent. Seul chemin de rendu : un appelant qui
 * oublierait la condition rouvrirait le doublon. Ne lève jamais.
 */
export async function releaseDatedMarks(
  matchId: number,
  keys: readonly string[],
  startAt: string | Date,
): Promise<void> {
  if (keys.length === 0) return;
  try {
    const db = await getDatabase();
    await db.execute(
      `DELETE FROM bg_match_reminders
        WHERE match_id = ? AND offset_key IN (${sqlPlaceholders(keys.length)}) AND start_at <=> ?`,
      [matchId, ...keys, new Date(startAt)],
    );
  } catch (error) {
    // La marque attendra le changement d'horaire suivant ; pm2 le dit.
    if (!isMissingTableError(error)) console.error("[match-reminders] marque non rendue", error);
  }
}

/**
 * Retient l'horaire poussé aux arbitres ({@link MATCH_STAFF_KEY}) — seulement
 * s'il est encore celui de la manche (un changement plus récent l'emporte).
 * Au meilleur effort : sans elle, son retrait ne leur sera simplement pas
 * poussé.
 */
export async function markStaffPushed(matchId: number, startAt: string): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO bg_match_reminders (match_id, offset_key, start_at)
       SELECT id, ?, start_at FROM bg_matches WHERE id = ? AND start_at = ?
       ON DUPLICATE KEY UPDATE start_at = ?`,
      [MATCH_STAFF_KEY, matchId, new Date(startAt), new Date(startAt)],
    );
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[match-schedule] horaire poussé aux arbitres non retenu", error);
  }
}

/** Oublie l'horaire poussé aux arbitres, une fois son retrait poussé. Au meilleur effort. */
export async function forgetStaffPush(matchId: number, startAt: string): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(`DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? AND start_at <=> ?`, [
      matchId,
      MATCH_STAFF_KEY,
      new Date(startAt),
    ]);
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[match-schedule] horaire poussé aux arbitres non oublié", error);
  }
}

/**
 * Efface les marques de rappel des manches données — pas celle de l'horaire
 * poussé aux arbitres ({@link MATCH_STAFF_KEY}) : une affiche changée ne change
 * pas l'horaire qu'ils ont reçu, et son retrait doit encore leur être poussé.
 *
 * Sous `ignoreMissingTable` : la création de la table est avalée par un
 * `catch` dans `database/schema/`, et une base à qui elle manque n'a aucune
 * marque à effacer — ce n'est pas une raison de faire échouer le geste.
 */
export async function forgetMatchReminders(connection: PoolConnection, matchIds: readonly number[]): Promise<void> {
  for (const ids of chunkIds(matchIds)) {
    await ignoreMissingTable(
      connection.execute(
        `DELETE FROM bg_match_reminders WHERE match_id IN (${sqlPlaceholders(ids.length)}) AND offset_key <> ?`,
        [...ids, MATCH_STAFF_KEY],
      ),
    );
  }
}
