/**
 * Réordonnancement du seeding par le staff.
 *
 * Le seeding vit dans `bg_tournament_registrations.seed`. Les formats à plateau
 * le lisaient déjà (`loadRegisteredTeamIds` trie par seed) ; la survie, la ronde
 * suisse et le multi-phases seedaient, eux, depuis le classement du site. Le
 * drapeau `bg_tournaments.manual_seeding` arbitre : tant qu'il vaut 0 chacun
 * garde son comportement d'origine, dès qu'un arbitre réordonne il passe à 1 et
 * l'ordre saisi fait autorité partout.
 *
 * Fenêtre d'édition : jusqu'à la première saisie de score (cf. `lib/shared/seeding.ts`).
 * Si des matchs ont déjà été générés mais qu'aucun score n'a été posé, ils sont
 * détruits et régénérés depuis le nouvel ordre.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isValidSeedOrder, seedingLockReason, type SeedingEntry, type SeedingLockReason } from "@/lib/shared/seeding";
import type { MatchScoreState } from "@/lib/shared/match-lock";
import { loadTournamentRow, getMatchRows, deleteAllMatches, resetRegistrationRanks } from "./repository";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { lockTournamentRow } from "./registration";
import { publishUpdatedEvent } from "./notifications";
import { isTransactionAborted } from "@/lib/server/mysql-errors";

export type SeedingBoard = {
  entries: SeedingEntry[];
  /** `null` quand l'ordre est encore modifiable. */
  lockReason: SeedingLockReason;
  manualSeeding: boolean;
};

/**
 * Pose le verrou sur les matchs du tournoi, **table seule** : MariaDB (la
 * production) refuse `FOR UPDATE OF`, et un `FOR UPDATE` sur la jointure de
 * `getMatchRows` verrouillerait aussi les lignes d'équipe. Un report de score
 * écrit son match sous `SELECT … FOR UPDATE` (`./scoring`), le forfait aussi
 * (`./player-forfeit`), l'arbitrage aussi (`./admin`) : poser ce verrou-ci les
 * fait attendre la fin du réordonnancement, ou le fait attendre la leur.
 *
 * Coût assumé : lue par l'index non unique `idx_bg_matches_tournament` sous
 * `REPEATABLE READ`, la requête verrouille aussi les **intervalles** qui
 * bordent les matchs du tournoi — une insertion de matchs du tournoi voisin
 * dans l'index peut attendre la fin du réordonnancement. Verrouiller par clé
 * primaire l'éviterait, mais exigerait de lire d'abord les identifiants par une
 * lecture ordinaire, qui figerait l'instantané **avant** le verrou : c'est le
 * piège que ce verrou referme. `deleteAllMatches` pose de toute façon les mêmes
 * intervalles dès qu'un plateau existe.
 */
async function lockTournamentMatches(connection: PoolConnection, tournamentId: number): Promise<void> {
  await connection.execute(`SELECT id FROM bg_matches WHERE tournament_id = ? FOR UPDATE`, [
    tournamentId,
  ]);
}

/** Vue « score » des matchs du tournoi, pour la règle de verrouillage partagée. */
function toScoreStates(rows: Awaited<ReturnType<typeof getMatchRows>>): MatchScoreState[] {
  return rows.map((row) => ({
    id: Number(row.id),
    roundNumber: Number(row.round_number),
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
    team1Score: row.team1_score === null ? null : Number(row.team1_score),
    team2Score: row.team2_score === null ? null : Number(row.team2_score),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    forfeitTeamId: row.forfeit_team_id === null ? null : Number(row.forfeit_team_id),
    doubleForfeit: row.status === "COMPLETED" && Number(row.double_forfeit ?? 0) === 1,
    decided: row.status === "COMPLETED",
    hasPendingReport: row.status === "AWAITING_CONFIRMATION",
    nextWinnerMatchId: row.next_winner_match_id === null ? null : Number(row.next_winner_match_id),
    nextLoserMatchId: row.next_loser_match_id === null ? null : Number(row.next_loser_match_id),
  }));
}

async function loadEntries(connection: PoolConnection, tournamentId: number): Promise<SeedingEntry[]> {
  const [rows] = await connection.execute<
    (RowDataPacket & { team_id: number; team_name: string; seed: number | null; registered_at: Date })[]
  >(
    `SELECT r.team_id, t.name AS team_name, r.seed, r.registered_at
     FROM bg_tournament_registrations r
     JOIN bg_teams t ON t.id = r.team_id
     WHERE r.tournament_id = ?
     ORDER BY COALESCE(r.seed, 1000000), r.registered_at ASC`,
    [tournamentId],
  );

  // Renumérote à la volée : d'anciennes inscriptions peuvent avoir un seed NULL
  // ou des trous, l'interface a besoin d'un rang continu.
  return rows.map((row, index) => ({
    teamId: Number(row.team_id),
    teamName: row.team_name,
    seed: index + 1,
  }));
}

/**
 * Renumérote les seeds de 1 à N sans changer l'ordre, sur la connexion de
 * l'appelant.
 *
 * Sert au **retrait** d'une inscription (`./registration-removal`) : effacer la
 * troisième ligne d'un plateau de huit laisse la suite en 4, 5, 6, 7, 8. Rien ne
 * s'en casse — tout le moteur lit ces rangs par `ORDER BY`, jamais par leur
 * valeur — mais la colonne cesse de dire ce qu'elle promet, et le prochain
 * réordonnancement la réécrirait en silence. On referme donc le trou tout de
 * suite, ici, où vit la règle d'ordre (`loadEntries`) : le rang affiché à
 * l'écran est celui qui est en base.
 *
 * Ne touche pas `manual_seeding` : refermer un trou n'est pas un ordre choisi
 * par le staff, et le poser ferait basculer un tournoi qui seedait depuis le
 * classement du site vers l'ordre d'inscription, sans que personne ne l'ait
 * demandé.
 */
export async function resequenceSeeds(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  const entries = await loadEntries(connection, tournamentId);
  for (const entry of entries) {
    await connection.execute(
      `UPDATE bg_tournament_registrations
       SET seed = ?
       WHERE tournament_id = ? AND team_id = ?`,
      [entry.seed, tournamentId, entry.teamId],
    );
  }
}

/** État du seeding d'un tournoi : ordre courant et fenêtre d'édition. */
export async function loadSeedingBoard(tournamentId: number): Promise<SeedingBoard | null> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    const tournament = await loadTournamentRow(connection, tournamentId);
    if (!tournament) return null;

    const entries = await loadEntries(connection, tournamentId);
    const matches = toScoreStates(await getMatchRows(connection, tournamentId));

    return {
      entries,
      lockReason: seedingLockReason(tournament.state, matches),
      manualSeeding: Number(tournament.manual_seeding ?? 0) === 1,
    };
  } finally {
    connection.release();
  }
}

/**
 * Nombre de tentatives d'un réordonnancement défait par un interblocage.
 *
 * Aucun ordre de verrous ne l'exclut : les gestes du staff (avancée, retour en
 * arrière, inscription) tiennent le tournoi puis écrivent des matchs, les
 * saisies de score tiennent leur match — voire d'autres, par l'entretien — puis
 * le tournoi dans la réconciliation. Le réordonnancement prend l'ordre des
 * premiers (tournoi, puis matchs). Quand une saisie le croise, InnoDB défait
 * l'une des deux — et pas forcément le réordonnancement, qui tient les verrous
 * de tous les matchs du tournoi. Défait, il **rejoue** sa transaction : il
 * relit les matchs, voit la saisie commitée et refuse en `SEEDING_LOCKED`.
 * Si c'est la saisie qui est défaite, elle échoue en erreur visible (ses
 * chemins ne rejouent pas) et le réordonnancement passe : aucun score n'est
 * perdu en silence.
 */
const REORDER_DEADLOCK_ATTEMPTS = 3;

/**
 * Applique un nouvel ordre de seeding.
 *
 * @throws TOURNAMENT_NOT_FOUND | SEEDING_LOCKED | SEEDING_LOCKED_STARTED | INVALID_SEED_ORDER
 */
export async function reorderSeeding(tournamentId: number, orderedTeamIds: number[]): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await reorderSeedingOnce(tournamentId, orderedTeamIds);
      return;
    } catch (error) {
      if (!isTransactionAborted(error) || attempt >= REORDER_DEADLOCK_ATTEMPTS) throw error;
    }
  }
}

async function reorderSeedingOnce(tournamentId: number, orderedTeamIds: number[]): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Deux verrous, en toute première instruction, avant la moindre lecture
    // ordinaire : sous `REPEATABLE READ`, c'est elle qui fige l'instantané de
    // la transaction (voir `lockTournamentRow`). La fenêtre « jusqu'à la
    // première saisie de score » se juge ensuite sur les matchs relus **après**
    // l'attente. Sans cela, un premier report validé entre ce contrôle et
    // `deleteAllMatches` échappait à l'instantané : le plateau régénéré
    // l'effaçait, et le joueur, qui avait reçu un succès, n'en savait rien.
    // Le verrou du tournoi sérialise les gestes du staff (avancée, retour en
    // arrière, inscription, retrait, autre réordonnancement), celui des matchs
    // les saisies de score (reports, forfaits, arbitrage), qui verrouillent
    // leur match. Tournoi d'abord, comme ces gestes du staff ; l'interblocage
    // possible avec une saisie est rejoué (`REORDER_DEADLOCK_ATTEMPTS`).
    await lockTournamentRow(connection, tournamentId);
    await lockTournamentMatches(connection, tournamentId);

    const tournament = await loadTournamentRow(connection, tournamentId);
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");

    const entries = await loadEntries(connection, tournamentId);
    const matchRows = await getMatchRows(connection, tournamentId);

    const lockReason = seedingLockReason(tournament.state, toScoreStates(matchRows));
    if (lockReason === "STARTED") throw new Error("SEEDING_LOCKED_STARTED");
    if (lockReason !== null) throw new Error("SEEDING_LOCKED");

    if (!isValidSeedOrder(entries.map((entry) => entry.teamId), orderedTeamIds)) {
      throw new Error("INVALID_SEED_ORDER");
    }

    for (let index = 0; index < orderedTeamIds.length; index += 1) {
      await connection.execute(
        `UPDATE bg_tournament_registrations
         SET seed = ?
         WHERE tournament_id = ? AND team_id = ?`,
        [index + 1, tournamentId, orderedTeamIds[index]],
      );
    }

    await connection.execute(`UPDATE bg_tournaments SET manual_seeding = 1 WHERE id = ?`, [tournamentId]);

    // Des matchs déjà générés (tournoi démarré mais vierge de scores) décrivent
    // l'ancien ordre : on les détruit pour que l'orchestration les recrée.
    if (matchRows.length > 0) {
      await deleteAllMatches(connection, tournamentId);
      await resetRegistrationRanks(connection, tournamentId);
      await connection.execute(`UPDATE bg_tournaments SET bracket_size = NULL WHERE id = ?`, [
        tournamentId,
      ]);
      await rebuildStartedTournament(connection, tournamentId, tournament.format);
    }

    await connection.commit();
    // Réordonner un tournoi déjà démarré rejoue son orchestration, qui peut le
    // clore (un plan multi-phases entièrement sauté) et donc réserver une ligne
    // de journal. Sans ce couple flush/discard, l'entrée resterait accrochée à
    // la connexion — que le pool réattribue — et partirait au nom d'une requête
    // sans rapport, voire après un `rollback`.
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}

/**
 * Reconstruit le plateau d'un tournoi déjà démarré après réordonnancement.
 *
 * Les formats à classement s'initialisent normalement lors de la transition
 * REGISTRATION → RUNNING, qui a déjà eu lieu : il faut donc les réamorcer
 * explicitement. Les formats à plateau, eux, sont régénérés par l'entretien de
 * `syncTournamentState` (déclenché par `bracket_size = NULL`).
 */
async function rebuildStartedTournament(
  connection: PoolConnection,
  tournamentId: number,
  format: string,
): Promise<void> {
  if (format === "BG_SURVIE") {
    // Le classement d'endurance porte les seeds : il doit être resemé depuis le
    // nouvel ordre, sans quoi le tournoi resterait figé sur l'ancien.
    const { initializeEnduranceTournament, generateEnduranceRound } = await import("./bg-survie/qualification");
    const { reconcileEndurance } = await import("./bg-survie/reconcile");
    await initializeEnduranceTournament(tournamentId, connection);
    await generateEnduranceRound(tournamentId, connection);
    await reconcileEndurance(tournamentId, connection);
    return;
  }

  if (format === "SWISS") {
    const { initializeSwissTournament, generateSwissRound, reconcileSwiss } = await import("./swiss");
    await initializeSwissTournament(tournamentId, connection);
    await generateSwissRound(tournamentId, connection);
    await reconcileSwiss(tournamentId, connection);
    return;
  }

  if (format === "SURVIVAL") {
    const { initializeSurvivalTournament, generateSurvivalRound, reconcileSurvival } = await import(
      "./survival"
    );
    await initializeSurvivalTournament(tournamentId, connection);
    await generateSurvivalRound(tournamentId, connection);
    await reconcileSurvival(tournamentId, connection);
    return;
  }

  if (format === "MULTI") {
    // `initializeMultiTournament` réamorce la phase 1, mais ne nettoie pas ce
    // que la précédente exécution a laissé : sans cette purge, les équipes de
    // phase de l'ancien ordre subsistent et `startPhase` serait rejoué sur une
    // phase déjà marquée RUNNING.
    await connection.execute(
      `DELETE FROM bg_tournament_phase_teams
       WHERE phase_id IN (SELECT id FROM bg_tournament_phases WHERE tournament_id = ?)`,
      [tournamentId],
    );
    await connection.execute(
      `UPDATE bg_tournament_phases
       SET state = 'PENDING', started_at = NULL, finished_at = NULL,
           entrants = NULL, qualifiers = NULL, max_rounds = NULL, bracket_size = NULL,
           swiss_current_round = 0, survival_current_round = 0, survival_barrage_rounds = 0
       WHERE tournament_id = ?`,
      [tournamentId],
    );
    await connection.execute(
      `DELETE FROM bg_swiss_standings WHERE tournament_id = ?`,
      [tournamentId],
    );
    await connection.execute(
      `DELETE FROM bg_survival_standings WHERE tournament_id = ?`,
      [tournamentId],
    );
    await connection.execute(
      `UPDATE bg_tournaments SET current_phase_id = NULL WHERE id = ?`,
      [tournamentId],
    );

    const { initializeMultiTournament, reconcilePhases } = await import("./phases");
    await initializeMultiTournament(tournamentId, connection);
    await reconcilePhases(tournamentId, connection);
  }
}
