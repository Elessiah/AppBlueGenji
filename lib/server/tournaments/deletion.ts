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
 * Les suppressions sont écrites explicitement alors que le schéma cascaderait
 * seul depuis `bg_tournaments` — un seul `DELETE` suffirait donc. Deux raisons
 * de ne pas s'en remettre à lui :
 *
 * 1. **Le schéma peut avoir dérivé.** Les migrations créent les tables en
 *    `CREATE TABLE IF NOT EXISTS` (`lib/server/database.ts`) : les clés
 *    étrangères ne sont posées qu'à la **création**. Une base installée avant
 *    l'ajout d'une contrainte ne la gagnera jamais, et une cascade absente
 *    laisserait des lignes orphelines pointant sur un tournoi disparu.
 * 2. **C'est la liste relisible de ce qui part.** La garantie donnée à
 *    l'utilisateur — aucune équipe, aucun joueur — se vérifie ici d'un coup
 *    d'œil, au lieu de se déduire de six contraintes réparties dans le schéma.
 *
 * Le prix est de huit requêtes en trop dans le cas nominal, sur une action qui
 * arrive quelques fois par saison. Une table de tournoi ajoutée plus tard et
 * oubliée ici reste rattrapée par sa cascade : la liste ne peut pas faire pire
 * que le schéma seul.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { publishUpdatedEvent } from "./notifications";

/** Identité du tournoi effacé, pour le message de confirmation et les logs. */
export type DeletedTournament = { id: number; name: string };

interface TournamentIdentityRow extends RowDataPacket {
  id: number;
  name: string;
}

/**
 * Efface toutes les lignes rattachées au tournoi, de la feuille vers la racine.
 * L'ordre garantit qu'aucune clé étrangère ne bloque la suppression, y compris
 * sur une base dont une cascade manquerait (voir l'en-tête du module).
 */
async function purgeTournamentRows(
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

  // Sa clé étrangère passe par la phase, pas par le tournoi : la suppression des
  // phases (plus bas) l'emporterait donc déjà par cascade. On l'écrit quand même,
  // pour la même raison que le reste — c'est la seule requête qui nomme cette
  // table, et une base dont la contrainte manquerait garderait ses lignes.
  await connection.execute(
    `DELETE FROM bg_tournament_phase_teams WHERE tournament_id = ?`,
    [tournamentId],
  );
  await connection.execute(`DELETE FROM bg_swiss_standings WHERE tournament_id = ?`, [tournamentId]);
  await connection.execute(`DELETE FROM bg_survival_standings WHERE tournament_id = ?`, [tournamentId]);
  await connection.execute(`DELETE FROM bg_endurance_standings WHERE tournament_id = ?`, [tournamentId]);
  // Les rappels de match pendent aux manches, pas au tournoi : on les efface
  // avant elles, à la main comme le reste, plutôt que de compter sur la cascade
  // de `bg_match_reminders.match_id`.
  await connection.execute(
    `DELETE r FROM bg_match_reminders r
     JOIN bg_matches m ON m.id = r.match_id
     WHERE m.tournament_id = ?`,
    [tournamentId],
  );
  // Même remarque pour les réservations d'alerte arbitre : elles pendent aux
  // manches, et la liste relisible de ce qui part vaut mieux qu'une cascade que
  // personne ne relit — d'autant que la création de la table est avalée par un
  // `catch` dans `database.ts`, où une contrainte manquante passerait inaperçue.
  //
  // Sous `try`, à la différence de ses voisines, mais **pour ce seul cas** : la
  // contrainte qui protège `bg_matches` vit sur cette table-là, donc une base
  // où le `CREATE TABLE` avalé a échoué n'a ni table ni contrainte — le
  // `DELETE` y lèverait `ER_NO_SUCH_TABLE` et rendrait *tous* les tournois
  // indéboulonnables, pour une table de notifications ; il n'y a alors rien à
  // effacer non plus. Toute autre erreur remonte : un interblocage, par exemple,
  // annule la transaction, et poursuivre la purge sur une transaction défaite
  // laisserait un tournoi à moitié supprimé.
  try {
    await connection.execute(
      `DELETE a FROM bg_referee_alerts a
       JOIN bg_matches m ON m.id = a.match_id
       WHERE m.tournament_id = ?`,
      [tournamentId],
    );
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }
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
