/**
 * Retrait d'une inscription avant le coup d'envoi : par le staff
 * (`removeTournamentEntrant`) ou par le joueur lui-même
 * (`withdrawOwnRegistration`, `docs/features/SELF_WITHDRAWAL.md`).
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
 *    moteur à l'écarter. La trace part au journal Discord, où personne n'est
 *    nommé : « le staff » pour un retrait, le nom de l'équipe ou « un joueur »
 *    pour l'engagé (voir les routes) ; le staff auteur ne l'est que dans les
 *    journaux du serveur (`publishStaffAction`).
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
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";
import { entrantRemovalBlockReason } from "@/lib/shared/entrant-removal";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { isSoloTournament, toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { releaseWithServerLockWait, rollbackKeepingError } from "./lock-wait";
import { publishUpdatedEvent } from "./notifications";
import type { TournamentRow } from "./_internal";
import { lockTournamentRow, resolveUserEntrant } from "./registration";
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
 * Le geste même du retrait, sur la transaction de l'appelant — qui tient déjà
 * la ligne du tournoi (`lockTournamentRow`) et en a jugé la fenêtre : la ligne
 * d'inscription effacée, les rangs refermés. Partagé avec la suppression d'un
 * compte (`deleted-solo-entries.ts`, `account-erasure.ts`), qui retire ses
 * inscriptions solo de la même façon.
 */
export async function withdrawRegistrationOn(
  connection: PoolConnection,
  tournamentId: number,
  teamId: number,
): Promise<void> {
  await connection.execute(
    `DELETE FROM bg_tournament_registrations
     WHERE tournament_id = ? AND team_id = ?`,
    [tournamentId, teamId],
  );
  await resequenceSeeds(connection, tournamentId);
}

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
  return runEntrantRemoval(tournamentId, {
    resolveTeamId: async () => teamId,
  });
}

/**
 * Désinscription **à l'initiative du joueur** : son équipe active en tournoi
 * par équipes, son entrée solo en tournoi individuel — même fenêtre que le
 * retrait par le staff (jusqu'au coup d'envoi), même effacement.
 *
 * Le droit est celui de l'inscription : engager ou désengager une équipe
 * demande d'en avoir la charge (`OWNER` ou `MANAGER`, `hasTeamManagementRole`) ;
 * en individuel, le joueur ne retire que lui-même. Les conditions
 * d'utilisation ne sont **pas** exigées : on ne retient pas une équipe dans un
 * tournoi faute d'une case cochée (voir `registerCurrentUserTeam`).
 *
 * @throws `TOURNAMENT_NOT_FOUND` — identifiant inconnu.
 * @throws `NO_ACTIVE_TEAM` — rien à désinscrire (aucune équipe, aucune entrée
 *   solo).
 * @throws `CONCURRENT_UPDATE_RETRY` — l'équipe active a changé pendant
 *   l'attente du verrou : un nouvel essai tranche.
 * @throws `NOT_TEAM_MANAGER` — le joueur n'a pas la charge de son équipe.
 * @throws `TEAM_NOT_IN_TOURNAMENT` — son engagé n'est pas inscrit.
 * @throws le code d'`EntrantRemovalBlockReason` — le tournoi a commencé.
 */
export async function withdrawOwnRegistration(
  tournamentId: number,
  userId: number,
): Promise<RemovedEntrant> {
  // L'équipe du joueur, lue sur le pool **avant** d'emprunter la connexion de
  // la transaction — même raison que l'inscription (`registerCurrentUserTeam`) :
  // la lire sur une seconde place du pool sous le verrou du tournoi ferait
  // attendre chaque geste d'une place que les autres ne rendent pas. Elle est
  // verrouillée puis relue dans la transaction.
  const candidate = await getUserActiveTeam(userId);
  const candidateTeamId = candidate?.teamId ?? null;
  let solo = false;

  return runEntrantRemoval(tournamentId, {
    // Verrou de l'équipe **avant la première lecture ordinaire** (ordre
    // tournoi → équipe, celui de l'inscription) : les gestes d'effectif
    // (rôles, départ, exclusion) tiennent ce verrou, et les rôles relus
    // ensuite sont donc ceux de l'instant de l'écriture.
    afterLock: async (connection) => {
      const [rows] = await connection.execute<(RowDataPacket & { participant_type: string | null })[]>(
        `SELECT participant_type FROM bg_tournaments WHERE id = ? FOR UPDATE`,
        [tournamentId],
      );
      solo = rows.length > 0 && isSoloTournament(toParticipantType(rows[0].participant_type));
      if (!solo && candidateTeamId !== null) {
        await connection.execute(`SELECT id FROM bg_teams WHERE id = ? FOR UPDATE`, [candidateTeamId]);
      }
    },
    resolveTeamId: async (connection, tournament) => {
      const entrant = await resolveUserEntrant(connection, tournament, userId);
      if (entrant.teamId === null) throw new Error("NO_ACTIVE_TEAM");
      // Relue sous le verrou : un joueur qui a changé d'équipe entre la lecture
      // sur le pool et le verrou ne retire rien — sa nouvelle équipe n'est pas
      // sous verrou ; un nouvel essai la retire. « Réessaie », et non « crée
      // une équipe » : il en a une.
      if (!solo && entrant.teamId !== candidateTeamId) throw new Error(CONCURRENT_UPDATE_RETRY);
      if (!entrant.canActForEntrant) throw new Error("NOT_TEAM_MANAGER");
      return entrant.teamId;
    },
  });
}

type EntrantRemovalSteps = {
  /** Verrous supplémentaires, pris juste après celui du tournoi et avant toute lecture ordinaire. */
  afterLock?: (connection: PoolConnection) => Promise<void>;
  /** Engagé à retirer, jugé une fois la fenêtre vérifiée (tournoi non commencé). */
  resolveTeamId: (connection: PoolConnection, tournament: TournamentRow) => Promise<number>;
};

/** Tronc commun du retrait par le staff et de la désinscription par le joueur. */
async function runEntrantRemoval(
  tournamentId: number,
  steps: EntrantRemovalSteps,
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
    if (steps.afterLock) await steps.afterLock(connection);

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

    const teamId = await steps.resolveTeamId(connection, tournament);

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

    await withdrawRegistrationOn(connection, tournamentId, teamId);

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
    // L'erreur d'origine survit à un `ROLLBACK` raté (contention rendue en
    // 409, pas en 500), et une connexion restée en transaction est détruite
    // au lieu de revenir au pool avec le verrou du tournoi (`./lock-wait`).
    await rollbackKeepingError(connection);
    throw error;
  } finally {
    discardBotLogs(connection);
    await releaseWithServerLockWait(connection);
  }
}
