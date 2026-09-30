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
import { MIN_ENTRANTS_FOR_MATCHES, SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { LAUNCH_AUTO_DELAY_MINUTES } from "@/lib/shared/match-launch";
import { RESOLVABLE_BYE_SQL, RESOLVABLE_GHOST_SQL } from "./byes";
import { STALLED_ALERT_KEY } from "./bot-logs";
import { computeTournamentState } from "./state";
import type { TournamentRow } from "./_internal";

/** Le report d'un engagé est complet quand ses deux scores sont posés. */
const TEAM1_REPORTED_SQL =
  "(m.team1_report_score IS NOT NULL AND m.team1_report_opponent_score IS NOT NULL)";
const TEAM2_REPORTED_SQL =
  "(m.team2_report_score IS NOT NULL AND m.team2_report_opponent_score IS NOT NULL)";

/** Un seul des deux engagés a reporté : le délai expiré fait foi. */
export const SINGLE_REPORT_SQL = `(${TEAM1_REPORTED_SQL} <> ${TEAM2_REPORTED_SQL})`;

/** Les deux ont reporté (et se contredisent, sans quoi la manche serait close). */
export const BOTH_REPORTED_SQL = `(${TEAM1_REPORTED_SQL} AND ${TEAM2_REPORTED_SQL})`;

/**
 * Un lancement est **dû** sur ce match (alias `m`, tournoi `t`) : jouable,
 * heure atteinte ou absente — jamais un match **à planifier** —, et soit son
 * appariement a changé, soit son lancement n'est pas ouvert, soit le délai du
 * lancement d'office est écoulé (`maintainMatchLaunches`). Partagé par le
 * balayage passif et par la lecture de l'instantané (`./snapshot`) : deux
 * copies auraient divergé au premier cas ajouté.
 */
export const DUE_LAUNCH_SQL = `(m.status = 'READY'
  AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
  AND (m.start_at IS NULL OR m.start_at <= NOW())
  AND (m.start_at IS NOT NULL OR t.referee_scheduling = 0)
  AND (NOT (m.launch_pairing <=> CONCAT(m.team1_id, ':', m.team2_id))
       OR (m.launched_at IS NULL
           AND (m.lobby_opened_at IS NULL
                OR m.lobby_opened_at <= NOW() - INTERVAL ${LAUNCH_AUTO_DELAY_MINUTES} MINUTE))))`;

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
 * - report de score dont le délai a expiré (`resolveExpiredScoreReports`) —
 *   **seulement ce que la résolution peut faire avancer** : un report unique,
 *   qu'elle clôt, ou un conflit dont l'escalade à l'arbitrage est due et pas
 *   encore réservée (`bg_referee_alerts`). Un conflit déjà escaladé attend un
 *   arbitre, rien d'autre : le retenir faisait entretenir son tournoi à chaque
 *   balayage, pour rien, jusqu'à l'arbitrage ;
 * - bye ou match fantôme **résolvable** (`tryAutoResolveByes`) — la condition
 *   même de la résolution, et non « une case est vide » : une case qui attend
 *   le vainqueur d'un match non joué est l'état normal de tout arbre en cours,
 *   et la retenir faisait entretenir à chaque balayage des tournois où la
 *   résolution n'avait rien à faire ;
 * - match entré en lancement sans que son délai ait été ouvert, ou dont le
 *   délai de lancement d'office est écoulé (`maintainMatchLaunches`) — jamais
 *   un match **à planifier** (option `referee_scheduling`, sans date) : rien ne
 *   s'y entretient avant que l'arbitrage pose l'horaire, et le retenir ferait
 *   entretenir son tournoi à chaque balayage jusqu'à la planification ;
 * - élimination dont toutes les rencontres sont jouées : la clôture reste à
 *   prononcer (`finalizeTournamentIfDone`) — un double forfait est joué sans
 *   vainqueur, même exception que `isEliminationPhaseComplete` ;
 * - plateau sans adversaires resté « en cours » (`finalizeUnderfilledTournament`,
 *   qui s'applique aussi à un tournoi *déjà* `RUNNING`).
 */
async function findDueMaintenance(connection: PoolConnection): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    // `MIN_ENTRANTS_FOR_MATCHES`, `LAUNCH_AUTO_DELAY_MINUTES`,
    // `SCORE_REPORT_TIMEOUT_MINUTES`, `STALLED_ALERT_KEY`, les prédicats de
    // report et les deux
    // prédicats de `./byes` sont des constantes de module, jamais une entrée : rien d'externe n'atteint ces
    // interpolations.
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
                      AND m.winner_team_id IS NULL
                      AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
                      AND (${SINGLE_REPORT_SQL}
                           OR (${BOTH_REPORTED_SQL}
                               AND m.score_deadline_at <= NOW() - INTERVAL ${SCORE_REPORT_TIMEOUT_MINUTES} MINUTE
                               AND NOT EXISTS (SELECT 1 FROM bg_referee_alerts a
                                               WHERE a.match_id = m.id
                                                 AND a.alert_key = '${STALLED_ALERT_KEY}'))))
         OR EXISTS (SELECT 1 FROM bg_matches m
                    WHERE m.tournament_id = t.id AND ${DUE_LAUNCH_SQL})
         OR EXISTS (SELECT 1 FROM bg_matches m
                    WHERE m.tournament_id = t.id AND m.phase_id = 0
                      AND (${RESOLVABLE_BYE_SQL} OR ${RESOLVABLE_GHOST_SQL}))
         OR (t.format IN ('SINGLE', 'DOUBLE')
             AND EXISTS (SELECT 1 FROM bg_matches m
                         WHERE m.tournament_id = t.id AND m.phase_id = 0)
             AND NOT EXISTS (SELECT 1 FROM bg_matches m
                             WHERE m.tournament_id = t.id AND m.phase_id = 0
                               AND m.winner_team_id IS NULL
                               AND NOT (m.status = 'COMPLETED' AND m.double_forfeit = 1)
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
