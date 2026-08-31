/**
 * Calendrier des matchs : écriture de la date de début d'une manche.
 *
 * Toute la règle vit dans le module pur `lib/shared/match-schedule.ts` ; ce
 * fichier ne fait que l'appliquer à la base et publier l'événement qui réveille
 * les pages ouvertes — la date voyage ensuite dans l'instantané du flux SSE,
 * comme le reste du plateau.
 *
 * Réservé à la permission `tournaments` (arbitre, admin) : programmer une
 * manche engage l'organisation vis-à-vis des engagés, contrairement au lien de
 * diffusion qu'un caster pose sur son seul cast.
 *
 * Aucune garde d'état. La date est **descriptive** : elle n'avance pas le match
 * et ne verrouille rien, si bien que la poser sur une manche déjà jouée n'est
 * pas une incohérence mais une correction d'archive. Le seul effet de bord
 * possible — l'ouverture d'antenne du mode `START_TIME` — est déjà borné par
 * `resolveMatchLiveState`, qui coupe le direct dès qu'un score est saisi.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { normalizeMatchStartAt } from "@/lib/shared/match-schedule";
import { toIso } from "@/lib/server/serialization";
import { publishUpdatedEvent } from "./notifications";

type MatchScheduleRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  start_at: Date | string | null;
};

/**
 * Fixe (ou efface) la date de début d'un match.
 *
 * `null` ou chaîne vide valent effacement : le formulaire renvoie `""` quand le
 * staff vide le champ, et exiger `null` là serait un piège. Un match casté en
 * mode `START_TIME` dont on efface la date reste « programmé » sans jamais
 * passer à l'antenne — c'est volontaire, et l'interface le signale plutôt que
 * de refuser l'effacement : le calendrier ne doit pas être pris en otage par
 * une configuration de diffusion.
 *
 * @returns la date normalisée en ISO, ou `null` si elle a été effacée.
 * @throws `MATCH_NOT_FOUND` | `INVALID_MATCH_START_AT`
 */
export async function setMatchStartAt(
  matchId: number,
  rawStartAt: string | Date | null,
): Promise<string | null> {
  const blank =
    rawStartAt === null || (typeof rawStartAt === "string" && rawStartAt.trim() === "");
  const startAt = blank ? null : normalizeMatchStartAt(rawStartAt);
  if (!blank && startAt === null) throw new Error("INVALID_MATCH_START_AT");

  const db = await getDatabase();
  const [rows] = await db.execute<MatchScheduleRow[]>(
    `SELECT id, tournament_id, start_at FROM bg_matches WHERE id = ? LIMIT 1`,
    [matchId],
  );
  if (rows.length === 0) throw new Error("MATCH_NOT_FOUND");

  // `DATETIME` n'a pas de fuseau : on écrit une `Date`, que le pilote convertit
  // dans le fuseau de la connexion — exactement comme les autres horodatages du
  // schéma (`live_started_at`, `score_deadline_at`).
  await db.execute(`UPDATE bg_matches SET start_at = ? WHERE id = ?`, [
    startAt === null ? null : new Date(startAt),
    matchId,
  ]);

  // Les rappels déjà envoyés portaient l'ancienne date : ils ne valent plus
  // rien. Les effacer fait repartir le cycle à zéro
  // (`lib/server/tournaments/match-reminders.ts`), donc réannoncer la nouvelle
  // date — c'est précisément ce qu'un déplacement de manche doit produire.
  // Meilleur effort : une manche reprogrammée ne doit pas échouer parce que le
  // ménage des rappels a échoué.
  const previousStartAt = toIso(rows[0].start_at);
  if (previousStartAt !== startAt) {
    try {
      await db.execute(`DELETE FROM bg_match_reminders WHERE match_id = ?`, [matchId]);
    } catch {
      // Meilleur effort : au pire, le cycle des rappels garde son ancien état.
    }
  }

  publishUpdatedEvent(Number(rows[0].tournament_id));
  return startAt;
}
