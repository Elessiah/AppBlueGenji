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
import { sqlPlaceholders } from "@/lib/server/sql-placeholders";

const CHUNK = 500;

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
 * Efface les marques de rappel des manches données.
 *
 * Sous `ignoreMissingTable` : la création de la table est avalée par un
 * `catch` dans `database/schema/`, et une base à qui elle manque n'a aucune
 * marque à effacer — ce n'est pas une raison de faire échouer le geste.
 */
export async function forgetMatchReminders(connection: PoolConnection, matchIds: readonly number[]): Promise<void> {
  for (let start = 0; start < matchIds.length; start += CHUNK) {
    const ids = matchIds.slice(start, start + CHUNK);
    await ignoreMissingTable(
      connection.execute(`DELETE FROM bg_match_reminders WHERE match_id IN (${sqlPlaceholders(ids.length)})`, ids),
    );
  }
}
