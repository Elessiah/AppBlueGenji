/**
 * État de la relecture légère des pseudos d'arbitre (`refreshRefereeNames`,
 * `useTournamentLive`) : un seul objet, créé une fois par page et remis à zéro
 * d'un seul geste au changement de tournoi — plutôt que neuf refs à garder
 * cohérentes une à une.
 */
export type RefereeNamesReader = {
  /** Dernier ensemble d'empreintes manquantes essayé (`refereeNamesAttempt`). */
  attempt: string;
  /** Minuteur d'étalement (ou d'attente après un échec) en cours. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Lecture en vol, annulée au changement de tournoi. */
  abort: AbortController | null;
  /** Instant avant lequel aucune reprise ne part après un échec. */
  retryAt: number;
  /** Ensemble manquant que l'attente et le compte de reprises concernent. */
  retryKey: string;
  /** Relecture différée tant que personne ne regarde. */
  deferred: boolean;
  /** Relecture à relancer à la fin de celle en vol. */
  pending: boolean;
  /** Reprises d'office d'affilée. */
  retries: number;
};

/** État vierge : rien d'essayé, rien en attente. */
export function createRefereeNamesReader(): RefereeNamesReader {
  return { attempt: "", timer: null, abort: null, retryAt: 0, retryKey: "", deferred: false, pending: false, retries: 0 };
}

/**
 * Annule le minuteur en attente, s'il y en a un, **et oublie l'essai** : la
 * relecture qui l'a rendu inutile (le contexte REST) n'a pas forcément apporté
 * les pseudos — l'ensemble encore manquant doit pouvoir se relire.
 * Rend `true` si un minuteur a été annulé.
 */
export function cancelScheduledNamesRead(reader: RefereeNamesReader): boolean {
  if (reader.timer === null) return false;
  clearTimeout(reader.timer);
  reader.timer = null;
  reader.attempt = "";
  return true;
}

/** Changement de tournoi ou démontage : minuteur vidé, lecture annulée, tout remis à zéro. */
export function resetRefereeNamesReader(reader: RefereeNamesReader): void {
  if (reader.timer !== null) clearTimeout(reader.timer);
  reader.abort?.abort();
  Object.assign(reader, createRefereeNamesReader());
}

/**
 * Statut d'échec de `/referee-names` qui se reprend : refus de quota et panne
 * passagère. Un 401 (session expirée), 403 ou 404 (tournoi masqué) ne guérit
 * pas en relisant : l'essai reste posé, le même ensemble ne se relit plus.
 */
export function refereeNamesFailureRetries(status: number): boolean {
  return status === 429 || status >= 500;
}
