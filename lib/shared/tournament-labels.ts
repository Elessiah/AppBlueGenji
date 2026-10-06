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
import type frLabels from "@/messages/fr/labels.json";
import type { TournamentFormat, TournamentGame } from "./types";

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  SINGLE: "Simple élimination",
  DOUBLE: "Double élimination",
  SWISS: "Ronde suisse",
  SURVIVAL: "Survie par coupes",
  MULTI: "Multi-phases",
  BG_SURVIE: "BlueGenji Survie",
};

export const GAME_LABELS: Record<TournamentGame, string> = {
  OW: "Overwatch",
  MR: "Marvel Rivals",
};

/** Libellé d'un format, ou la valeur brute si elle vient d'ailleurs. */
export function formatLabel(format: TournamentFormat | string): string { // NOSONAR typescript:S6571 — l'union documente les valeurs attendues ; une valeur brute venue d'ailleurs est rendue telle quelle
  return FORMAT_LABELS[format as TournamentFormat] ?? String(format);
}

/** Libellé d'un jeu, ou la valeur brute si elle vient d'ailleurs. */
export function gameLabel(game: TournamentGame | string): string { // NOSONAR typescript:S6571 — l'union documente les valeurs attendues ; une valeur brute venue d'ailleurs est rendue telle quelle
  return GAME_LABELS[game as TournamentGame] ?? String(game);
}

/**
 * Les mêmes libellés **dans une langue** : espace de messages `labels`
 * (`messages/<langue>/labels.json`, lot 4 de la traduction). Les tables
 * françaises ci-dessus restent celles des écrans pas encore traduits et du
 * journal Discord (D6) ; un test vérifie que le français des messages les égale
 * mot pour mot. Un écran traduit reçoit les messages de sa langue
 * (`messagesFor(locale).labels`, ou en prop pour un composant client) et lit
 * par code — jamais par le libellé français.
 */
export type TournamentLabelMessages = typeof frLabels;
export type TournamentLabelTable = keyof TournamentLabelMessages;

/** Libellé d'un code (`SINGLE`, `OW`, `RUNNING`…) dans une table, ou le code tel quel. */
export function localizedTournamentLabel<T extends TournamentLabelTable>(
  messages: Pick<TournamentLabelMessages, T>,
  table: T,
  code: string,
): string {
  return (messages[table] as Readonly<Record<string, string>>)[code] ?? code;
}
