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
import type { TournamentFormat, TournamentGame } from "./types";

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  SINGLE: "Simple élimination",
  DOUBLE: "Double élimination",
  SWISS: "Ronde suisse",
  SURVIVAL: "Survie",
  MULTI: "Multi-phases",
  BG_SURVIE: "BlueGenji Survie",
};

export const GAME_LABELS: Record<TournamentGame, string> = {
  OW2: "Overwatch 2",
  MR: "Marvel Rivals",
};

/** Libellé d'un format, ou la valeur brute si elle vient d'ailleurs. */
export function formatLabel(format: TournamentFormat | string): string {
  return FORMAT_LABELS[format as TournamentFormat] ?? String(format);
}

/** Libellé d'un jeu, ou la valeur brute si elle vient d'ailleurs. */
export function gameLabel(game: TournamentGame | string): string {
  return GAME_LABELS[game as TournamentGame] ?? String(game);
}
