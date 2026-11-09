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

let noticesAvailable = true;

/**
 * La table des annonces a-t-elle pu être créée ? Posé par les migrations
 * (`database/schema/notifications.ts`). Sans elle, les rappels et « Match
 * programmé » ne l'attendent pas (`newMatchPendingSql`, `newMatchToldSql`
 * rendent faux) : seule l'annonce se tait.
 */
export function setNewMatchNoticesAvailable(available: boolean): void {
  noticesAvailable = available;
}

/** Une réservation existe-t-elle pour la place et l'affiche du match (`extra` : condition de plus sur `n`) ? */
function noticeAtPlaceSql(extra = ""): string {
  return `EXISTS (SELECT 1 FROM bg_new_match_notices n
   WHERE n.tournament_id = m.tournament_id AND n.phase_id = m.phase_id AND n.bracket = m.bracket
     AND n.round_number = m.round_number AND n.match_number = m.match_number AND n.pairing = ${PAIRING_SQL}${extra})`;
}

/** Le match a-t-il déjà une marque (envoyée ou `skipped`) pour cette place et cette affiche ? */
export const MARKED_SQL = noticeAtPlaceSql();

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

/** Âge au-delà duquel le pouls du balayage des annonces ne retient plus les rappels. */
export const NEW_MATCH_HEARTBEAT_MINUTES = 5;

/**
 * Le match attend encore son annonce (à annoncer, sans marque) **et** le
 * balayage des annonces est vivant (pouls `new_match_sweep_at` de moins de
 * {@link NEW_MATCH_HEARTBEAT_MINUTES} minutes, posé seulement après la mise en
 * service). Balayage en panne ou pas encore en service : les rappels partent
 * comme avant. Un match qui échoue d'affilée est marqué `skipped`
 * (`new-match-notices.ts`) : il ne retient pas ses rappels non plus.
 *
 * @param now `NOW()` (horloge de la base), ou `?` quand l'appelant lit à son
 *            propre instant (le balayage des rappels) — le `?` revient alors
 *            **deux fois**.
 */
export function newMatchPendingSql(now: "NOW()" | "?"): string {
  // Table absente : faux, en gardant le nombre de `?` attendu par l'appelant.
  if (!noticesAvailable) return now === "?" ? "(? IS NULL AND ? IS NULL AND FALSE)" : "FALSE";
  return `(${announceableSql(now)} AND NOT ${MARKED_SQL}
  AND EXISTS (SELECT 1 FROM bg_settings hb WHERE hb.setting_key = 'new_match_sweep_at'
    AND hb.setting_value >= DATE_FORMAT(${now} - INTERVAL ${NEW_MATCH_HEARTBEAT_MINUTES} MINUTE, '%Y-%m-%d %H:%i:%s')))`;
}

/**
 * L'annonce de nouveau match envoyée pour cette affiche portait déjà l'horaire
 * actuel du match : « Match programmé » ne la double pas.
 */
export function newMatchToldSql(): string {
  return noticesAvailable ? noticeAtPlaceSql(" AND n.skipped = 0 AND n.start_at <=> m.start_at") : "FALSE";
}
