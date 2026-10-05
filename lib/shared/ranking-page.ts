/**
 * Logique pure de la page `/classement` : filtre par jeu lu dans l'adresse,
 * liens des pastilles, écart de points d'un rang à l'autre.
 *
 * Le filtre vit dans l'adresse (`?jeu=ow`) et non dans un état client : les
 * pastilles sont des liens, la page se rend côté serveur, et un classement
 * filtré se partage tel quel — sans JavaScript.
 *
 * Voir `docs/features/RANKING_PAGE.md`.
 */

import type { TournamentGame } from "./types";

export type RankingGameFilter = "all" | "ow" | "mr";

/** Les pastilles, dans l'ordre d'affichage — les mêmes que le leaderboard de l'accueil. */
export const RANKING_GAME_FILTERS: readonly { id: RankingGameFilter; label: string }[] = [
  { id: "all", label: "Général" },
  { id: "ow", label: "Overwatch" },
  { id: "mr", label: "Marvel Rivals" },
];

/**
 * Lit `?jeu=` : `ow` / `mr`, sans égard à la casse ni aux espaces. Toute autre
 * valeur (absente, inconnue, répétée) rend le classement général — un lien
 * abîmé ne doit pas casser la page.
 */
export function parseRankingFilter(value: string | string[] | undefined): RankingGameFilter {
  if (typeof value !== "string") return "all";
  const normalized = value.trim().toLowerCase();
  return normalized === "ow" || normalized === "mr" ? normalized : "all";
}

/** Le jeu que rejoue le classement pour ce filtre — `undefined` = tous les jeux. */
export function rankingFilterGame(filter: RankingGameFilter): TournamentGame | undefined {
  if (filter === "ow") return "OW";
  if (filter === "mr") return "MR";
  return undefined;
}

/** Adresse d'une pastille : le général n'a pas de paramètre. */
export function rankingFilterHref(filter: RankingGameFilter): string {
  return filter === "all" ? "/classement" : `/classement?jeu=${filter}`;
}

/**
 * Points qui séparent une ligne de celle qui la précède — `null` pour la
 * première. Jamais négatif : le tri du classement range la cote en premier
 * (`compareRankedTeams`), une ligne ne peut donc pas devancer une cote plus
 * haute.
 */
export function pointsBehind(rows: readonly { points: number }[], index: number): number | null {
  if (index <= 0 || index >= rows.length) return null;
  return Math.max(0, rows[index - 1].points - rows[index].points);
}

/** Lettre d'un résultat de forme, telle qu'affichée (Victoire, Défaite, Nul). */
export const FORM_LETTERS: Record<"w" | "l" | "d", string> = { w: "V", l: "D", d: "N" };

/** Nombre de résultats de forme montrés par ligne. */
export const RANKING_FORM_LENGTH = 5;
