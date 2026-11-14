/**
 * Compteur des bascules de l'option « Check-in des matchs » validées **dans ce
 * processus** (`docs/features/MATCH_CHECK_IN_SETTING.md`). Une relecture de
 * l'option partagée entre envois (`readCheckInState`, `./match-reminders`) n'est
 * rejointe que si aucune bascule n'a été validée depuis son départ : un envoi
 * lancé après une bascule ne reprend jamais une lecture partie avant elle.
 * Module à part : ni le service de bascule ni le balayage n'importent l'autre.
 */
let toggleEpoch = 0;

/** Époque courante : avance à chaque bascule validée. */
export function checkInToggleEpoch(): number {
  return toggleEpoch;
}

/** Note une bascule validée, aussitôt la transaction close. */
export function noteCheckInToggle(): void {
  toggleEpoch += 1;
}
