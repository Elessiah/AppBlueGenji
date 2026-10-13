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
import { ignoreMissingTable } from "@/lib/server/mysql-errors";

const CHUNK = 500;

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
      connection.execute(`DELETE FROM bg_match_reminders WHERE match_id IN (${ids.map(() => "?").join(", ")})`, ids),
    );
  }
}
