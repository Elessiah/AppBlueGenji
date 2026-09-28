import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";

/**
 * Tournois **non terminés et déjà publiés** où le joueur est engagé : par une
 * équipe dont il est membre **aujourd'hui** (`left_at IS NULL`), ou par son
 * entrée solo en tournoi individuel.
 *
 * Aucune condition sur `participant_type` : une entrée solo n'a aucun membre et
 * une équipe réelle n'a pas de `solo_user_id`, si bien que chaque branche ne
 * peut désigner que son propre type d'engagé. C'est la lecture que fait
 * `resolveUserEntrant` tournoi par tournoi, posée une fois pour toute la liste.
 *
 * Les terminés sont écartés : la section « Mes tournois » de `/tournois` ne
 * sert qu'à retrouver ce qui attend encore un geste (s'y présenter, suivre le
 * plateau) — l'archive reste rangée sous « Terminés ». Les tournois pas encore
 * publiés aussi, par principe : une inscription y est impossible (les
 * inscriptions ouvrent après la visibilité), mais cette route ne doit pas
 * pouvoir révéler l'identifiant d'un tournoi caché.
 */
export async function listMyActiveTournamentIds(userId: number): Promise<number[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT DISTINCT r.tournament_id
       FROM bg_tournament_registrations r
       JOIN bg_tournaments t ON t.id = r.tournament_id
       JOIN bg_teams e ON e.id = r.team_id
      WHERE t.start_visibility_at <= ?
        AND t.state <> 'FINISHED'
        AND (
          e.solo_user_id = ?
          OR EXISTS (
            SELECT 1 FROM bg_team_members tm
             WHERE tm.team_id = r.team_id
               AND tm.user_id = ?
               AND tm.left_at IS NULL
          )
        )`,
    [new Date(), userId, userId],
  );
  return rows.map((row) => Number(row.tournament_id));
}
