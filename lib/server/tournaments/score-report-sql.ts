/**
 * Prédicats SQL des reports de score expirés (alias `m` pour `bg_matches`),
 * partagés par le balayage passif (`./sync-scope`), la lecture de l'instantané
 * (`./snapshot`) et la résolution elle-même (`./finalization`) : trois copies
 * auraient divergé au premier cas ajouté. Module feuille, sans dépendance
 * interne, pour que ses constantes soient prêtes quel que soit l'ordre de
 * chargement des modules qui s'importent entre eux.
 */
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";

/** Clé de réservation de l'escalade « délai dépassé, toujours pas tranché ». */
export const STALLED_ALERT_KEY = "SCORE_REPORT_STALLED";

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
 * Un report expiré que la résolution peut **faire avancer** : un report unique,
 * qu'elle valide d'office, ou un litige dont l'escalade à l'arbitrage est due
 * et pas encore réservée (`bg_referee_alerts`). Un litige déjà escaladé attend
 * un arbitre, rien d'autre — et, la saisie des joueurs étant verrouillée
 * (`docs/features/SCORE_DISPUTE_LOCK.md`), il peut attendre des heures : le
 * retenir ouvrait une transaction d'entretien pour rien à chaque lecture du
 * tournoi et à chaque balayage, jusqu'à l'arbitrage.
 *
 * Constantes de module seulement, jamais une entrée : rien d'externe n'atteint
 * ces interpolations.
 */
export const ACTIONABLE_EXPIRED_REPORT_SQL = `(m.status = 'AWAITING_CONFIRMATION'
  AND m.score_deadline_at IS NOT NULL
  AND m.score_deadline_at <= NOW()
  AND m.winner_team_id IS NULL
  AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
  AND (${SINGLE_REPORT_SQL}
       OR (${BOTH_REPORTED_SQL}
           AND m.score_deadline_at <= NOW() - INTERVAL ${SCORE_REPORT_TIMEOUT_MINUTES} MINUTE
           AND NOT EXISTS (SELECT 1 FROM bg_referee_alerts a
                           WHERE a.match_id = m.id
                             AND a.alert_key = '${STALLED_ALERT_KEY}'))))`;
