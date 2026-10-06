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

/**
 * Les pastilles, dans l'ordre d'affichage — les mêmes que le leaderboard de
 * l'accueil. Leur libellé est un message (`ranking.board.filter.<id>`), dans la
 * langue de la page.
 */
export const RANKING_GAME_FILTERS: readonly { id: RankingGameFilter }[] = [{ id: "all" }, { id: "ow" }, { id: "mr" }];

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

/** Lignes affichées d'entrée, puis ajoutées par chaque « Afficher plus ». */
export const RANKING_PAGE_SIZE = 50;

/**
 * Plafond de `?n=` : au-delà, une adresse forgée ferait rendre des milliers de
 * lignes d'un coup. Le lien « Afficher plus » disparaît une fois ce nombre atteint.
 */
export const RANKING_MAX_SHOWN = 1000;

/**
 * Lit `?n=` (nombre de lignes affichées) : un entier positif, arrondi au
 * multiple de {@link RANKING_PAGE_SIZE} supérieur, borné à
 * [`RANKING_PAGE_SIZE`, `RANKING_MAX_SHOWN`]. Toute autre valeur (absente,
 * répétée, négative, décimale, non numérique) rend la première page.
 */
export function parseRankingShown(value: string | string[] | undefined): number {
  if (typeof value !== "string") return RANKING_PAGE_SIZE;
  const trimmed = value.trim();
  if (!/^\d{1,7}$/.test(trimmed)) return RANKING_PAGE_SIZE;
  const pages = Math.ceil(Number(trimmed) / RANKING_PAGE_SIZE);
  return Math.min(RANKING_MAX_SHOWN, Math.max(RANKING_PAGE_SIZE, pages * RANKING_PAGE_SIZE));
}

/**
 * Adresse d'une pastille ou d'une page : le général n'a pas de `jeu`, la
 * première page pas de `n`. Changer de jeu repart de la première page.
 */
export function rankingFilterHref(filter: RankingGameFilter, shown: number = RANKING_PAGE_SIZE): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("jeu", filter);
  if (shown > RANKING_PAGE_SIZE) params.set("n", String(shown));
  const query = params.toString();
  return query ? `/classement?${query}` : "/classement";
}

/** Ancre d'une ligne du tableau — cible du lien « Afficher plus » sans JavaScript. */
export function rankingRowId(rank: number): string {
  return `rang-${rank}`;
}

/**
 * Lien « Afficher plus » : la page suivante, ancrée sur sa première ligne (sans
 * JavaScript, le navigateur y descend). `null` quand le plafond est atteint.
 */
export function rankingMoreHref(filter: RankingGameFilter, shown: number): string | null {
  if (shown >= RANKING_MAX_SHOWN) return null;
  const next = Math.min(RANKING_MAX_SHOWN, shown + RANKING_PAGE_SIZE);
  return `${rankingFilterHref(filter, next)}#${rankingRowId(shown + 1)}`;
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

/** Nombre de résultats de forme montrés par ligne. */
export const RANKING_FORM_LENGTH = 5;

/** Places tenues par le podium — dès qu'il y a de quoi le remplir. */
export const RANKING_PODIUM_SIZE = 3;

/**
 * Partage les lignes affichées entre le podium et le tableau : avec au moins
 * trois équipes, les trois premières montent sur le podium et le tableau
 * **commence à la 4e place** — sans répéter le podium. En dessous, pas de
 * podium et tout reste au tableau.
 *
 * `?n=` compte toujours des **rangs** (podium compris) : la première page montre
 * les rangs 1 à 50 (podium + tableau 4 à 50), « Afficher plus » ajoute 51 à
 * 100, et les ancres `rang-<n>` restent celles des rangs absolus.
 */
export function splitRankingPodium<Row>(rows: readonly Row[]): {
  podium: readonly Row[];
  table: readonly Row[];
} {
  if (rows.length < RANKING_PODIUM_SIZE) return { podium: [], table: rows };
  return { podium: rows.slice(0, RANKING_PODIUM_SIZE), table: rows.slice(RANKING_PODIUM_SIZE) };
}
