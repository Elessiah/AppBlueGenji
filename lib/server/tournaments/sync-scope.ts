/**
 * Quels tournois l'entretien de fond doit-il réellement visiter ?
 *
 * `syncVisibleTournaments` repassait sur **tous** les tournois non terminés à
 * chaque balayage, et `syncTournamentState` refaisait pour chacun le tour de
 * son entretien : plateau à créer, byes, reports expirés, clôture. Sur une base
 * de démonstration (76 tournois, dont 46 en cours), une passe demandait des
 * minutes — et, comme elle était **attendue** par la lecture de la liste, elle
 * y ajoutait son temps entier, en tenant au passage une transaction sur
 * `bg_tournaments` derrière laquelle toute écriture patientait.
 *
 * Ce module ramène la passe aux tournois qui ont **quelque chose à faire**. La
 * question se pose en deux temps, parce qu'elle a deux natures :
 *
 * 1. **Un jalon de calendrier est franchi** — l'état stocké ne dit plus la même
 *    chose que les dates. Le test est celui de `computeTournamentState`, la
 *    règle partagée : le réécrire en SQL en ferait une deuxième, et les deux
 *    finiraient par se contredire. On lit donc les seules colonnes de date des
 *    tournois non terminés (table courte, une lecture) et on tranche en
 *    mémoire.
 * 2. **Un entretien de tournoi en cours est dû** — chacune des quatre tâches de
 *    la branche `RUNNING` de `syncTournamentState` a une précondition qui
 *    s'écrit, elle, en SQL, et qui ne coûte qu'un `EXISTS` indexé.
 *
 * Ce que le filtre n'a pas à couvrir : la **reconstruction** d'un plateau dont
 * l'effectif aurait changé. Les inscriptions sont closes avant le coup d'envoi
 * et aucune n'est retirée ensuite (seule la suppression du tournoi les efface) ;
 * un plateau à refaire se signale donc toujours par un `bracket_size` remis à
 * `NULL` — c'est d'ailleurs exactement ce que fait le réordonnancement du
 * seeding pour demander sa régénération.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { MIN_ENTRANTS_FOR_MATCHES } from "@/lib/shared/constants";
import { computeTournamentState } from "./state";
import type { TournamentRow } from "./_internal";

type ScheduleRow = RowDataPacket &
  Pick<
    TournamentRow,
    "id" | "state" | "finished_at" | "registration_open_at" | "registration_close_at" | "start_at"
  >;

/**
 * Tournois dont l'état stocké ne correspond plus à leurs dates : ouverture des
 * inscriptions, clôture, coup d'envoi.
 */
async function findCrossedMilestones(connection: PoolConnection): Promise<number[]> {
  const [rows] = await connection.execute<ScheduleRow[]>(
    `SELECT id, state, finished_at, registration_open_at, registration_close_at, start_at
     FROM bg_tournaments
     WHERE state <> 'FINISHED'`,
  );

  return rows
    .filter((row) => computeTournamentState(row) !== row.state)
    .map((row) => Number(row.id));
}

/**
 * Tournois en cours dont l'entretien passif a quelque chose à faire.
 *
 * Une condition par tâche de la branche `RUNNING` de `syncTournamentState`, dans
 * le même ordre :
 *
 * - plateau d'élimination absent (`createBracketIfMissing`) ;
 * - report de score dont le délai a expiré (`resolveExpiredScoreReports`) ;
 * - bye ou match fantôme encore ouvert (`tryAutoResolveByes`) ;
 * - élimination dont toutes les rencontres sont jouées : la clôture reste à
 *   prononcer (`finalizeTournamentIfDone`) ;
 * - plateau sans adversaires resté « en cours » (`finalizeUnderfilledTournament`,
 *   qui s'applique aussi à un tournoi *déjà* `RUNNING`).
 */
async function findDueMaintenance(connection: PoolConnection): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    // `MIN_ENTRANTS_FOR_MATCHES` est une constante du module, jamais une
    // entrée : rien d'externe n'atteint cette interpolation.
    `SELECT t.id
     FROM bg_tournaments t
     WHERE t.state = 'RUNNING'
       AND (
         (t.format IN ('SINGLE', 'DOUBLE')
          AND (t.bracket_size IS NULL
               OR NOT EXISTS (SELECT 1 FROM bg_matches m
                              WHERE m.tournament_id = t.id AND m.phase_id = 0)))
         OR EXISTS (SELECT 1 FROM bg_matches m
                    WHERE m.tournament_id = t.id
                      AND m.status = 'AWAITING_CONFIRMATION'
                      AND m.score_deadline_at IS NOT NULL
                      AND m.score_deadline_at <= NOW()
                      AND m.winner_team_id IS NULL)
         OR EXISTS (SELECT 1 FROM bg_matches m
                    WHERE m.tournament_id = t.id AND m.phase_id = 0
                      AND m.status <> 'COMPLETED'
                      AND m.winner_team_id IS NULL
                      AND (m.team1_id IS NULL OR m.team2_id IS NULL))
         OR (t.format IN ('SINGLE', 'DOUBLE')
             AND EXISTS (SELECT 1 FROM bg_matches m
                         WHERE m.tournament_id = t.id AND m.phase_id = 0)
             AND NOT EXISTS (SELECT 1 FROM bg_matches m
                             WHERE m.tournament_id = t.id AND m.phase_id = 0
                               AND m.winner_team_id IS NULL
                               AND (m.team1_id IS NOT NULL OR m.team2_id IS NOT NULL)))
         OR (SELECT COUNT(*) FROM bg_tournament_registrations r
             WHERE r.tournament_id = t.id) < ${MIN_ENTRANTS_FOR_MATCHES}
       )`,
  );

  return rows.map((row) => Number(row.id));
}

/**
 * Identifiants des tournois que le prochain balayage doit visiter, sans doublon
 * et dans l'ordre croissant — un ordre stable rend la passe reproductible d'une
 * exécution à l'autre, ce qu'un `Set` ne garantit pas.
 */
export async function findTournamentsNeedingSync(
  connection: PoolConnection,
): Promise<number[]> {
  // En série : les deux lectures partagent la connexion de l'appelant, qui ne
  // sert qu'une requête à la fois.
  const milestones = await findCrossedMilestones(connection);
  const maintenance = await findDueMaintenance(connection);

  return [...new Set([...milestones, ...maintenance])].sort((a, b) => a - b);
}
