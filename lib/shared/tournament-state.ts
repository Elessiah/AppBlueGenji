/**
 * État d'un tournoi déduit de ses dates.
 *
 * L'état stocké en base (`bg_tournaments.state`) n'est qu'un cache : la vérité
 * est dans les dates d'ouverture, de clôture des inscriptions et de début. Le
 * serveur recale la colonne au fil de l'eau, mais **le client peut faire le même
 * calcul tout seul** — c'est ce qui permet à une carte de passer de
 * « Prochainement » à « Inscriptions » à la seconde dite, sans la moindre
 * requête. Il n'y a là aucune donnée sensible : l'horaire est public, et le
 * serveur reste seul juge de ce qu'il autorise réellement.
 *
 * Module pur, partagé serveur/client, pour que les deux ne divergent jamais.
 * `lib/server/tournaments/state.ts` s'en sert pour la synchronisation en base.
 */
import type { TournamentState } from "./types";

/**
 * Dates nécessaires au calcul, sous forme neutre. Le serveur y adapte ses
 * lignes SQL (`snake_case`), le client sa `TournamentCard` (`camelCase`).
 */
export type TournamentStateInput = {
  /** État stocké. Seul `FINISHED` fait autorité : un tournoi fini le reste. */
  state: TournamentState;
  /** Date de clôture effective, si le tournoi a été finalisé. */
  finishedAt?: string | Date | null;
  registrationOpenAt: string | Date;
  registrationCloseAt: string | Date;
  startAt: string | Date;
};

function timeOf(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * État réel du tournoi à l'instant `now`.
 *
 * Entre la clôture des inscriptions et l'heure de début, le tournoi retourne à
 * `UPCOMING` : les inscriptions sont closes, mais rien n'a encore commencé.
 */
export function computeTournamentState(
  input: TournamentStateInput,
  now: number = Date.now(),
): TournamentState {
  if (input.state === "FINISHED" || input.finishedAt) return "FINISHED";

  const openAt = timeOf(input.registrationOpenAt);
  const closeAt = timeOf(input.registrationCloseAt);
  const startAt = timeOf(input.startAt);

  if (now < openAt) return "UPCOMING";
  if (now >= openAt && now <= closeAt) return "REGISTRATION";
  if (now >= startAt) return "RUNNING";
  return "UPCOMING";
}

/**
 * Instant du prochain changement d'état, ou `null` s'il n'y en a plus (tournoi
 * terminé, ou déjà en cours).
 *
 * Sert à programmer un unique `setTimeout` côté client : au lieu de sonder le
 * serveur pour savoir si les inscriptions ont ouvert, on se réveille à
 * l'horaire exact. Les dates invalides sont ignorées plutôt que de produire un
 * `NaN` qui figerait le minuteur.
 */
export function nextTournamentStateChangeAt(
  input: TournamentStateInput,
  now: number = Date.now(),
): number | null {
  if (input.state === "FINISHED" || input.finishedAt) return null;

  const current = computeTournamentState(input, now);

  // La sortie des inscriptions se joue à `closeAt + 1 ms` : le calcul ci-dessus
  // garde le tournoi ouvert tant que `now <= closeAt`.
  const candidates = [
    timeOf(input.registrationOpenAt),
    timeOf(input.registrationCloseAt) + 1,
    timeOf(input.startAt),
  ]
    .filter((time) => Number.isFinite(time) && time > now)
    .sort((a, b) => a - b);

  for (const time of candidates) {
    if (computeTournamentState(input, time) !== current) return time;
  }

  return null;
}
