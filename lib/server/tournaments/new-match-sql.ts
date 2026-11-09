/**
 * Fragments SQL de l'annonce d'un nouveau match (`./new-match-notices`,
 * `docs/features/NEW_MATCH_NOTICE.md`), partagés avec le balayage des rappels
 * (`./match-reminders`) : tant qu'un match attend son annonce, « Match
 * programmé » ne part pas — l'annonce porte déjà l'horaire.
 *
 * Alias attendus : `m` (bg_matches), `t` (bg_tournaments).
 */

/** L'affiche d'un match : ses deux engagées, sans ordre (`5:7`). */
export const PAIRING_SQL = "CONCAT(LEAST(m.team1_id, m.team2_id), ':', GREATEST(m.team1_id, m.team2_id))";

/** Le match a-t-il déjà une marque (envoyée ou `skipped`) pour cette place et cette affiche ? */
export const MARKED_SQL = `EXISTS (SELECT 1 FROM bg_new_match_notices n
   WHERE n.tournament_id = m.tournament_id AND n.phase_id = m.phase_id AND n.bracket = m.bracket
     AND n.round_number = m.round_number AND n.match_number = m.match_number AND n.pairing = ${PAIRING_SQL})`;

/**
 * Un match à annoncer : tournoi en cours et publié, deux engagées connues et
 * distinctes, ni exempt, ni joué, ni lancé (un horaire dépassé par une manche en
 * retard s'annonce quand même : c'est là qu'il presse). Lu pour les candidats
 * **et** dans la réservation.
 */
function announceableSql(now: string): string {
  return `t.state = 'RUNNING' AND t.start_visibility_at <= ${now}
  AND m.is_bye = 0 AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL AND m.team1_id <> m.team2_id
  AND m.status IN ('PENDING', 'READY') AND m.team1_score IS NULL AND m.team2_score IS NULL
  AND m.launched_at IS NULL`;
}

export const ANNOUNCEABLE_SQL = announceableSql("NOW()");

/**
 * Le match attend encore son annonce (à annoncer, sans marque). Un seul `?` :
 * l'instant de lecture (le balayage des rappels passe le sien, pas `NOW()`).
 */
export const NEW_MATCH_PENDING_SQL = `(${announceableSql("?")} AND NOT ${MARKED_SQL})`;
