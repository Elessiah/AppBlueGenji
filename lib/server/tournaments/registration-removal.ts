/**
 * Retrait d'une inscription par le staff, avant le coup d'envoi.
 *
 * La règle — **jusqu'au début du tournoi, pas une seconde de plus** — vit dans
 * le module pur `lib/shared/entrant-removal.ts`, partagé avec l'interface. Ce
 * module-ci ne fait que l'appliquer là où elle fait foi : sous le verrou de la
 * ligne du tournoi, dans la transaction qui écrit.
 *
 * Trois choses, et pas une de plus :
 *
 * 1. **La ligne d'inscription est effacée**, pas marquée. Il n'y a rien à
 *    conserver : avant le coup d'envoi, une inscription n'a produit ni match ni
 *    classement, et la garder « retirée » obligerait chacune des requêtes du
 *    moteur à l'écarter. La trace part au journal Discord, où l'auteur est
 *    nommé (voir la route).
 * 2. **Aucune équipe n'est supprimée.** Ni la fantôme qu'on vient de retirer du
 *    plateau — elle resservira au prochain tournoi —, ni l'entrée solo d'un
 *    joueur, qui est son identité d'engagé et non une inscription. Même règle
 *    que la suppression d'un tournoi (`./deletion`).
 * 3. **Les rangs se referment** (`resequenceSeeds`) : retirer le troisième de
 *    huit ne laisse pas la suite en 4, 5, 6, 7, 8.
 *
 * Ce qu'on ne trouvera pas ici, et c'est voulu : aucun nettoyage de matchs, de
 * classement ni de phase. La fenêtre garantit qu'il n'y en a pas — ils naissent
 * tous à la bascule `REGISTRATION → RUNNING`, que ce module refuse de franchir.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { entrantRemovalBlockReason } from "@/lib/shared/entrant-removal";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { publishUpdatedEvent } from "./notifications";
import { lockTournamentRow } from "./registration";
import { resequenceSeeds } from "./seeding";
import { syncTournamentState } from "./state";

/** Ce que le retrait a produit, pour la ligne de journal et le message rendu. */
export type RemovedEntrant = {
  tournamentId: number;
  tournamentName: string;
  teamId: number;
  /** Nom de l'engagé au moment du retrait : après, plus rien ne le désigne. */
  entrantName: string;
  /** Effectif **après** retrait. */
  registeredTeams: number;
  maxTeams: number;
  participantType: ParticipantType;
};

/**
 * Retire un engagé du plateau.
 *
 * @throws `TOURNAMENT_NOT_FOUND` — identifiant inconnu.
 * @throws `TEAM_NOT_IN_TOURNAMENT` — l'engagé n'est pas (ou n'est plus) inscrit.
 * @throws le code d'`EntrantRemovalBlockReason` — le tournoi a commencé.
 */
export async function removeTournamentEntrant(
  tournamentId: number,
  teamId: number,
): Promise<RemovedEntrant> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // En toute première instruction, avant la moindre lecture : sous
    // `REPEATABLE READ`, c'est la première lecture *ordinaire* qui fige
    // l'instantané de la transaction (voir `lockTournamentRow`). Sans cela, la
    // fenêtre se déciderait sur un état d'avant l'attente du verrou — celui,
    // par exemple, d'un tournoi qu'une inscription concurrente vient de remplir.
    await lockTournamentRow(connection, tournamentId);

    // L'entretien d'abord, la règle ensuite : sans lui, un tournoi dont l'heure
    // de début est passée reste `REGISTRATION` en base tant que personne n'a
    // ouvert sa page, et le retrait passerait — après le coup d'envoi — au seul
    // motif que nul n'était allé voir. La synchronisation le lance ici, dans
    // cette transaction, et la règle le refuse aussitôt.
    const { row: tournament } = await syncTournamentState(connection, tournamentId);
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");

    const blocked = entrantRemovalBlockReason({
      state: tournament.state,
      finishedAt: tournament.finished_at,
      registrationOpenAt: tournament.registration_open_at,
      registrationCloseAt: tournament.registration_close_at,
      startAt: tournament.start_at,
    });
    if (blocked) throw new Error(blocked);

    // Le nom est lu **avant** l'effacement : il vient de `bg_teams`, qui
    // survivrait au retrait, mais la ligne d'inscription est ce qui prouve que
    // cet engagé était bien de ce plateau — et c'est elle qu'on va effacer.
    const [rows] = await connection.execute<(RowDataPacket & { team_name: string })[]>(
      `SELECT t.name AS team_name
       FROM bg_tournament_registrations r
       JOIN bg_teams t ON t.id = r.team_id
       WHERE r.tournament_id = ? AND r.team_id = ?
       LIMIT 1`,
      [tournamentId, teamId],
    );
    const entrantName = rows[0]?.team_name;
    if (entrantName === undefined) throw new Error("TEAM_NOT_IN_TOURNAMENT");

    await connection.execute(
      `DELETE FROM bg_tournament_registrations
       WHERE tournament_id = ? AND team_id = ?`,
      [tournamentId, teamId],
    );

    await resequenceSeeds(connection, tournamentId);

    const [counted] = await connection.execute<(RowDataPacket & { c: number })[]>(
      `SELECT COUNT(*) AS c FROM bg_tournament_registrations WHERE tournament_id = ?`,
      [tournamentId],
    );

    await connection.commit();
    // Après le commit seulement : la synchronisation ci-dessus a pu réserver une
    // ligne de journal (un tournoi dont l'heure d'ouverture des inscriptions
    // vient de tomber), qu'un `rollback` aurait dû jeter.
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);

    return {
      tournamentId,
      tournamentName: tournament.name,
      teamId,
      entrantName,
      registeredTeams: Number(counted[0]?.c ?? 0),
      maxTeams: Number(tournament.max_teams),
      participantType: toParticipantType(tournament.participant_type),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}
