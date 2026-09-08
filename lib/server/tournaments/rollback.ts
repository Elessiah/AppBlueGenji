/**
 * Retour en arrière : effacer la manche courante d'un tournoi en cours.
 *
 * La décision — quelle manche, et ce qu'il advient de ce qui en descendait —
 * appartient au module pur `lib/shared/tournament-rollback.ts`, partagé avec
 * l'interface. Ici, deux choses seulement : l'écriture, et l'entretien qui la
 * suit.
 *
 * **Le moteur n'a rien à apprendre.** On ne défait ni classement, ni
 * élimination, ni qualification : les trois modes à classement *rejouent* tout
 * depuis l'historique des matchs (`replaySwiss`, `replaySurvival`,
 * `replayEndurance`), et une manche effacée disparaît donc du rejeu comme si
 * elle n'avait jamais été jouée. Il suffit d'effacer les saisies puis d'appeler
 * la réconciliation ordinaire, celle-là même qu'une correction de score
 * déclenche. Aucun mode n'a de branche « retour en arrière », et un mode ajouté
 * demain en héritera pour peu qu'il rejoue son classement.
 *
 * **Les identifiants de match survivent.** La manche est *vidée*, pas
 * supprimée : un identifiant de match est une adresse publique — lien profond
 * (`lib/shared/match-anchor.ts`), horaire annoncé, diffusion programmée — et la
 * manche va se rejouer entre les mêmes équipes. Seules les manches *ultérieures*
 * des formats à classement sont supprimées : le moteur les pose au fur et à
 * mesure, leurs appariements sont périmés par le retour en arrière, et il les
 * reposera.
 *
 * **Tournoi en cours seulement.** Un tournoi terminé est refusé, comme il l'est
 * pour un abandon ou une pénalité : corriger *un* score d'archive se rejoue et
 * réécrit un palmarès (`docs/features/FINISHED_TOURNAMENT_RECONCILIATION.md`),
 * mais effacer la finale entière laisserait un tournoi « terminé » sans
 * championne et sans manche pour en désigner une — la clôture ne se rejoue pas.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import {
  planRoundRollback,
  type RollbackMatch,
  type RollbackPlan,
} from "@/lib/shared/tournament-rollback";
import type { BracketType, TournamentFormat } from "@/lib/shared/types";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { tryAutoResolveByes } from "./byes";
import { invalidateTournamentLists } from "./list-cache";
import { publishUpdatedEvent } from "./notifications";
import { syncTournamentState } from "./state";

/** Ce que le retour en arrière a défait, pour le message et le journal. */
export type RolledBackRound = {
  tournamentId: number;
  tournamentName: string;
  /** Numéro de manche tel qu'il est stocké (offset des play-offs compris). */
  roundNumber: number;
  /** Nombre de rencontres vidées de leur résultat. */
  clearedMatches: number;
};

interface RollbackMatchRow extends RowDataPacket {
  id: number;
  bracket: BracketType;
  round_number: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  forfeit_team_id: number | null;
  status: string;
  team1_reported_at: string | null;
  team2_reported_at: string | null;
}

/**
 * Le plateau, dans le vocabulaire du module pur.
 *
 * `nextWinnerMatchId` / `nextLoserMatchId` restent à `null` : le plan ne suit
 * pas les liens de bracket, il range les matchs par stade. Les charger ferait
 * croire qu'ils comptent.
 */
function toRollbackMatch(row: RollbackMatchRow): RollbackMatch {
  return {
    id: Number(row.id),
    bracket: row.bracket,
    roundNumber: Number(row.round_number),
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
    team1Score: row.team1_score === null ? null : Number(row.team1_score),
    team2Score: row.team2_score === null ? null : Number(row.team2_score),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    forfeitTeamId: row.forfeit_team_id === null ? null : Number(row.forfeit_team_id),
    decided: row.status === "COMPLETED",
    hasPendingReport: row.team1_reported_at !== null || row.team2_reported_at !== null,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
  };
}

async function loadRollbackMatches(
  connection: PoolConnection,
  tournamentId: number,
): Promise<RollbackMatch[]> {
  const [rows] = await connection.execute<RollbackMatchRow[]>(
    `SELECT id, bracket, round_number, team1_id, team2_id, team1_score, team2_score,
            winner_team_id, forfeit_team_id, status, team1_reported_at, team2_reported_at
     FROM bg_matches
     WHERE tournament_id = ?`,
    [tournamentId],
  );
  return rows.map(toRollbackMatch);
}

/**
 * Borne du nombre d'identifiants glissés dans un `IN (…)`.
 *
 * Une manche de tournoi à 256 engagés compte 128 rencontres, et le plan en
 * ajoute autant en aval : découper garde la requête lisible par le planificateur
 * et la taille du paquet sous contrôle.
 */
const ID_CHUNK = 200;

function chunk(ids: readonly number[]): number[][] {
  const chunks: number[][] = [];
  for (let from = 0; from < ids.length; from += ID_CHUNK) {
    chunks.push(ids.slice(from, from + ID_CHUNK));
  }
  return chunks;
}

/**
 * Ramène des rencontres à l'état « pas encore jouées ».
 *
 * Tout ce qui a été *saisi* part — scores, vainqueur, perdant, forfait, reports
 * en attente et leur délai. Tout ce qui a été *annoncé* reste : les engagées, la
 * date de début et la diffusion décrivent une rencontre qui va se rejouer entre
 * les mêmes équipes, à la même heure, sur la même chaîne.
 *
 * Le statut se recalcule sur les engagées plutôt que d'être remis à `READY` :
 * une rencontre à un seul camp (bye) doit retomber sur `PENDING`, faute de quoi
 * elle s'annoncerait jouable sans adversaire.
 */
async function clearMatchResults(
  connection: PoolConnection,
  matchIds: readonly number[],
): Promise<void> {
  for (const ids of chunk(matchIds)) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_score = NULL,
           team2_score = NULL,
           winner_team_id = NULL,
           loser_team_id = NULL,
           forfeit_team_id = NULL,
           team1_report_score = NULL,
           team1_report_opponent_score = NULL,
           team1_reported_at = NULL,
           team2_report_score = NULL,
           team2_report_opponent_score = NULL,
           team2_reported_at = NULL,
           score_deadline_at = NULL,
           status = CASE
             WHEN team1_id IS NOT NULL AND team2_id IS NOT NULL THEN 'READY'
             ELSE 'PENDING'
           END
       WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
  }
}

/**
 * Vide de leurs qualifiées les rencontres qui descendaient de la manche défaite.
 *
 * Réservé aux plateaux à élimination, dont la structure est créée au lancement :
 * on ne peut pas supprimer ces lignes sans détruire le tournoi, mais les laisser
 * garnies afficherait au tour suivant une équipe qui n'a plus rien gagné.
 *
 * L'antenne est refermée pour la même raison que dans `pushTeamToTarget` : une
 * affiche qui perd ses deux camps n'est plus l'affiche qu'on diffusait.
 */
async function detachMatchParticipants(
  connection: PoolConnection,
  matchIds: readonly number[],
): Promise<void> {
  for (const ids of chunk(matchIds)) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_id = NULL,
           team2_id = NULL,
           status = 'PENDING',
           live_started_at = NULL
       WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
  }
}

/**
 * Supprime les manches postérieures d'un format à classement.
 *
 * Elles n'ont plus d'objet : leurs appariements ont été tirés d'un classement
 * que le retour en arrière vient de défaire, et le moteur les reposera quand la
 * manche courante sera de nouveau complète.
 *
 * Les tables qui pendent à une manche partent avec elle, écrites à la main
 * plutôt que laissées aux cascades — même raison que la suppression d'un tournoi
 * (`./deletion.ts`) : les contraintes ne sont posées qu'à la création des tables,
 * et une base installée plus tôt ne les a jamais gagnées.
 */
async function deleteMatches(
  connection: PoolConnection,
  matchIds: readonly number[],
): Promise<void> {
  for (const ids of chunk(matchIds)) {
    const placeholders = ids.map(() => "?").join(", ");
    await connection.execute(
      `DELETE FROM bg_match_reminders WHERE match_id IN (${placeholders})`,
      ids,
    );
    // Sous `try` comme dans `./deletion.ts` : la création de cette table est
    // avalée par un `catch` dans `database.ts`, et une base à qui elle manque
    // rendrait sinon tout retour en arrière impossible — pour une table de
    // notifications, où il n'y aurait de toute façon rien à effacer.
    try {
      await connection.execute(
        `DELETE FROM bg_referee_alerts WHERE match_id IN (${placeholders})`,
        ids,
      );
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
    await connection.execute(`DELETE FROM bg_matches WHERE id IN (${placeholders})`, ids);
  }
}

/** Applique le plan : la manche est vidée, ce qui en descendait est traité. */
async function applyRollback(
  connection: PoolConnection,
  plan: RollbackPlan,
): Promise<void> {
  await clearMatchResults(connection, plan.clearedMatchIds);

  if (plan.laterMatchIds.length === 0) return;
  if (plan.disposal === "DETACH") await detachMatchParticipants(connection, plan.laterMatchIds);
  else await deleteMatches(connection, plan.laterMatchIds);
}

/**
 * Rejoue le tournoi sur son nouvel historique.
 *
 * Exactement la chaîne d'une correction de score (`adminSaveMatchScoresPublic`),
 * et c'est le but : le retour en arrière n'est qu'une correction de plus, en
 * gros. Chaque réconciliation sort d'elle-même si le format ne la concerne pas.
 * `reconcilePhases` n'y figure pas — le multi-phases est refusé en amont
 * (`lib/shared/tournament-rollback.ts`).
 */
async function reconcileAfterRollback(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  // Les byes de la manche vidée ont perdu leur 1-0 : le moteur les repose.
  await tryAutoResolveByes(connection, tournamentId);

  const { reconcileSurvival } = await import("./survival");
  await reconcileSurvival(tournamentId, connection);
  const { reconcileSwiss } = await import("./swiss");
  await reconcileSwiss(tournamentId, connection);
  const { reconcileEndurance } = await import("./bg-survie");
  await reconcileEndurance(tournamentId, connection);
}

/**
 * Défait la manche courante du tournoi.
 *
 * @param tournamentId Tournoi concerné.
 * @returns Ce qui a été défait, pour la confirmation et le journal.
 * @throws `TOURNAMENT_NOT_FOUND` — identifiant inconnu.
 * @throws `TOURNAMENT_NOT_RUNNING` — tournoi pas (ou plus) en cours.
 * @throws `ROLLBACK_UNSUPPORTED_FORMAT` / `ROLLBACK_NOTHING_TO_UNDO` /
 *   `ROLLBACK_PLAYOFFS_STARTED` — motifs du module pur.
 */
export async function rollbackCurrentRound(tournamentId: number): Promise<RolledBackRound> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Verrou en toute première instruction, avant toute lecture ordinaire : sous
    // `REPEATABLE READ`, c'est la première lecture non verrouillante qui fige
    // l'instantané, et le plateau lu ensuite serait celui d'avant l'attente —
    // même précaution que l'inscription en lot des équipes fantômes.
    const [rows] = await connection.execute<
      (RowDataPacket & { id: number; name: string; format: TournamentFormat })[]
    >(`SELECT id, name, format FROM bg_tournaments WHERE id = ? FOR UPDATE`, [tournamentId]);
    if (rows.length === 0) throw new Error("TOURNAMENT_NOT_FOUND");
    const tournament = rows[0];

    // L'entretien d'abord : un tournoi dont l'heure de clôture est passée doit
    // être refusé sur son état réel, pas sur celui que la base traîne.
    const { row: synced } = await syncTournamentState(connection, tournamentId);
    if (!synced) throw new Error("TOURNAMENT_NOT_FOUND");
    if (synced.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");

    const plan = planRoundRollback(
      await loadRollbackMatches(connection, tournamentId),
      tournament.format,
    );
    if (typeof plan === "string") throw new Error(plan);

    await applyRollback(connection, plan);
    await reconcileAfterRollback(connection, tournamentId);

    await connection.commit();

    // Le journal part après le commit, comme partout : rien n'est annoncé qui ne
    // soit écrit. La réconciliation ci-dessus a pu mettre en file ses propres
    // lignes (un bye reposé, par exemple).
    flushBotLogs(connection);

    // Le plateau vient de changer pour tout le monde : instantané, aperçu et
    // listes sont invalidés par le même point de passage que toute autre
    // écriture, et le flux SSE pousse la nouvelle version.
    publishUpdatedEvent(tournamentId);
    invalidateTournamentLists();

    return {
      tournamentId: Number(tournament.id),
      tournamentName: tournament.name,
      roundNumber: plan.roundNumber,
      clearedMatches: plan.clearedMatchIds.length,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}
