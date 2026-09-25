/**
 * Libellés français d'un tournoi : son format, son jeu.
 *
 * Sortis de l'en-tête de la fiche tournoi (`app/(secured)/tournois/[id]/_lib/
 * header-meta.ts`, qui les réexporte) le jour où le serveur en a eu besoin lui
 * aussi, pour rédiger le journal Discord : deux tables séparées, c'est la
 * garantie qu'un mode ajouté d'un côté manquera de l'autre — exactement la
 * panne que `FORMAT_LABELS` avait été créée pour clore.
 *
 * Module pur, importable partout (`lib/shared`).
 */
import type { TournamentFormat, TournamentGame, TournamentState } from "./types";

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  SINGLE: "Simple élimination",
  DOUBLE: "Double élimination",
  SWISS: "Ronde suisse",
  SURVIVAL: "Survie",
  MULTI: "Multi-phases",
  BG_SURVIE: "BlueGenji Survie",
};

export const GAME_LABELS: Record<TournamentGame, string> = {
  OW: "Overwatch",
  MR: "Marvel Rivals",
};

/**
 * Libellés d'état compacts, pour une pastille de carte — distincts de
 * `STATE_SHARE_LABELS` (`lib/shared/share-metadata.ts`), rédigés en phrase
 * pour un encart de partage plutôt qu'un badge étroit.
 */
export const TOURNAMENT_STATE_LABELS: Record<TournamentState, string> = {
  UPCOMING: "Prochainement",
  REGISTRATION: "Inscriptions ouvertes",
  RUNNING: "En cours",
  FINISHED: "Terminé",
};

/** Libellé d'un format, ou la valeur brute si elle vient d'ailleurs. */
export function formatLabel(format: TournamentFormat | string): string {
  return FORMAT_LABELS[format as TournamentFormat] ?? String(format);
}

/** Libellé d'un jeu, ou la valeur brute si elle vient d'ailleurs. */
export function gameLabel(game: TournamentGame | string): string {
  return GAME_LABELS[game as TournamentGame] ?? String(game);
}

/** Libellé d'un état, ou la valeur brute si elle vient d'ailleurs. */
export function tournamentStateLabel(state: TournamentState | string): string {
  return TOURNAMENT_STATE_LABELS[state as TournamentState] ?? String(state);
}

/**
 * Action proposée sur un tournoi **en cours**, selon ce que son format sait
 * montrer : un arbre pour les éliminations, un classement pour les formats qui
 * n'en ont pas (Suisse, Survie, BlueGenji Survie), et une destination neutre
 * pour le multi-phases, qui peut être dans l'un ou l'autre selon sa phase.
 */
export function runningTournamentActionLabel(format: TournamentFormat | string): string {
  if (format === "SINGLE" || format === "DOUBLE") return "Voir le bracket";
  if (format === "SWISS" || format === "SURVIVAL" || format === "BG_SURVIE") return "Voir le classement";
  return "Voir le tournoi";
}
