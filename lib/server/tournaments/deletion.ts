/**
 * Suppression définitive d'un tournoi (réservée aux administrateurs).
 *
 * Le tournoi disparaît « partout » sans qu'aucune page n'ait à le savoir : la
 * liste, le palmarès, les statistiques approfondies, le classement du site, le
 * leaderboard et le calendrier de l'accueil se recalculent tous depuis
 * `bg_matches` et `bg_tournament_registrations`. Effacer ces lignes suffit donc
 * à effacer le tournoi de toutes ses vues dérivées.
 *
 * **Ce qui n'est jamais supprimé** : aucune équipe, aucun joueur, aucun compte.
 * Ni les équipes fantômes (entités gérées par le staff, réutilisables d'un
 * tournoi à l'autre) ni les entrées solo (`bg_teams.solo_user_id` : une seule
 * ligne par joueur, partagée par tous ses tournois individuels) ne sont
 * touchées — les effacer briserait les autres tournois qui s'y réfèrent. La
 * purge ne connaît que des tables portant un `tournament_id`.
 *
 * Les suppressions sont écrites explicitement plutôt que laissées aux cascades
 * `ON DELETE CASCADE` du schéma : c'est la liste exhaustive de ce qui part, elle
 * est relisible, et elle ne dépend pas de l'ordre dans lequel MySQL propage une
 * cascade en chaîne (`bg_tournament_phase_teams` n'a d'ailleurs pas de clé
 * étrangère vers le tournoi — elle passe par la phase).
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "./notifications";

/** Identité du tournoi effacé, pour le message de confirmation et les logs. */
export type DeletedTournament = { id: number; name: string };

interface TournamentIdentityRow extends RowDataPacket {
  id: number;
  name: string;
}

/**
 * Efface toutes les lignes rattachées au tournoi, de la feuille vers la racine.
 * Exportée pour les tests : l'ordre des requêtes est la garantie qu'aucune clé
 * étrangère ne bloque la suppression.
 */
export async function purgeTournamentRows(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  // Les matchs se pointent les uns les autres (`next_winner_match_id`). On
  // désarme ces liens avant d'effacer, pour ne pas dépendre de l'ordre dans
  // lequel InnoDB traite les auto-références.
  await connection.execute(
    `UPDATE bg_matches SET next_winner_match_id = NULL, next_loser_match_id = NULL
     WHERE tournament_id = ?`,
    [tournamentId],
  );

  await connection.execute(
    `DELETE FROM bg_tournament_phase_teams WHERE tournament_id = ?`,
    [tournamentId],
  );
  await connection.execute(`DELETE FROM bg_swiss_standings WHERE tournament_id = ?`, [tournamentId]);
  await connection.execute(`DELETE FROM bg_survival_standings WHERE tournament_id = ?`, [tournamentId]);
  await connection.execute(`DELETE FROM bg_endurance_standings WHERE tournament_id = ?`, [tournamentId]);
  await connection.execute(`DELETE FROM bg_matches WHERE tournament_id = ?`, [tournamentId]);
  await connection.execute(`DELETE FROM bg_tournament_phases WHERE tournament_id = ?`, [tournamentId]);
  await connection.execute(
    `DELETE FROM bg_tournament_registrations WHERE tournament_id = ?`,
    [tournamentId],
  );
  await connection.execute(`DELETE FROM bg_tournaments WHERE id = ?`, [tournamentId]);
}

/**
 * Supprime le tournoi et tout ce qui lui appartient, en une transaction.
 *
 * Aucune restriction d'état : un tournoi en cours ou terminé est supprimable —
 * c'est le sens d'une suppression définitive. Le garde-fou est la confirmation
 * par recopie du nom, côté interface (`lib/shared/tournament-deletion.ts`).
 *
 * @throws `TOURNAMENT_NOT_FOUND` si l'identifiant ne désigne aucun tournoi.
 */
export async function deleteTournament(tournamentId: number): Promise<DeletedTournament> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<TournamentIdentityRow[]>(
      `SELECT id, name FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    if (rows.length === 0) throw new Error("TOURNAMENT_NOT_FOUND");
    const deleted: DeletedTournament = { id: Number(rows[0].id), name: rows[0].name };

    await purgeTournamentRows(connection, tournamentId);

    await connection.commit();

    // Même point de passage que toute autre écriture (`./notifications`), et il
    // suffit : il vide l'instantané, l'aperçu et les listes — sans quoi le
    // tournoi supprimé resterait affiché dans `/tournois` jusqu'à cinq minutes
    // — puis réveille la salle du flux. Celle-ci ne retrouve plus d'instantané
    // et **termine** les connexions ; les lecteurs basculent alors sur leur
    // écran « Tournoi introuvable » (`docs/features/REALTIME_REFRESH.md`).
    //
    // Aucun événement dédié n'est nécessaire : le flux ne dit jamais pourquoi
    // il tombe, c'est la lecture REST de secours qui voit le 404.
    publishUpdatedEvent(tournamentId);

    return deleted;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
