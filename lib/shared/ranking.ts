/**
 * Barème **et assiette** uniques du classement des équipes du site.
 *
 * Il sert au leaderboard de la landing, à l'annuaire `/equipes`, au bloc de
 * statistiques des fiches **et** au seeding des tournois à classement (Survie,
 * Suisse, Multi, aperçu du plateau) : les calculs vivaient auparavant chacun
 * dans leur requête SQL, avec des formules différentes (et de signe opposé sur
 * les défaites), ce qui faisait seeder une équipe perdante devant une équipe
 * gagnante — puis afficher sur l'annuaire un total de points sans rapport avec
 * celui de la fiche.
 *
 * Deux choses doivent être partagées pour que deux vues ne puissent pas
 * diverger, et elles le sont toutes les deux ici :
 *
 * 1. le **barème** — combien vaut une victoire, combien coûte une défaite ;
 * 2. l'**assiette** — quels matchs comptent, et ce qu'est une défaite.
 *
 * Un barème partagé posé sur deux assiettes différentes donne encore deux
 * nombres différents : c'est exactement ce qui s'était produit entre l'annuaire
 * (qui comptait byes et matchs fantômes) et les fiches.
 *
 * Les fragments SQL n'interpolent que des constantes de ce module et les
 * expressions fournies par le code appelant — jamais une entrée utilisateur.
 */

export const RANKING_POINTS_PER_WIN = 100;
export const RANKING_POINTS_PER_LOSS = -20;

/** Points de classement d'une équipe. Une défaite coûte des points. */
export function rankingPoints(wins: number, losses: number): number {
  return wins * RANKING_POINTS_PER_WIN + losses * RANKING_POINTS_PER_LOSS;
}

/**
 * Même barème, en SQL, à partir de deux expressions déjà agrégées. Les seules
 * valeurs interpolées sont les constantes numériques ci-dessus — les
 * expressions passées doivent venir du code appelant, jamais d'une entrée
 * utilisateur.
 */
export function rankingPointsSql(winsExpr: string, lossesExpr: string): string {
  return `((${winsExpr}) * ${RANKING_POINTS_PER_WIN} + (${lossesExpr}) * ${RANKING_POINTS_PER_LOSS})`;
}

/**
 * Assiette du classement : les matchs qui comptent réellement. Terminés, avec
 * un vainqueur et deux équipes réelles — byes (`is_bye`) et matchs fantômes
 * (une équipe manquante) écartés, leur score étant posé par le moteur de
 * tournoi et non joué.
 *
 * `match` est l'alias de `bg_matches` dans la requête appelante.
 */
export function playedMatchSql(match = "m"): string {
  return `${match}.status = 'COMPLETED'
       AND ${match}.is_bye = 0
       AND ${match}.team1_id IS NOT NULL
       AND ${match}.team2_id IS NOT NULL
       AND ${match}.winner_team_id IS NOT NULL`;
}

/** L'assiette par défaut, pour les requêtes qui aliasent `bg_matches` en `m`. */
export const PLAYED_MATCH_SQL = playedMatchSql();

/**
 * Condition de jointure entre une équipe et ses matchs comptés au classement.
 * `teamExpr` désigne l'identifiant d'équipe (`t.id`, `r.team_id`, …).
 *
 * En `LEFT JOIN`, une équipe sans match donne une ligne entièrement `NULL` :
 * ses victoires et ses défaites valent alors 0, pas `NULL`.
 */
export function rankingMatchJoinSql(teamExpr: string, match = "m"): string {
  return `(${match}.team1_id = ${teamExpr} OR ${match}.team2_id = ${teamExpr})
      AND ${playedMatchSql(match)}`;
}

/** Victoires d'une équipe, agrégées sur les matchs joints par `rankingMatchJoinSql`. */
export function rankingWinsSql(teamExpr: string, match = "m"): string {
  return `COALESCE(SUM(CASE WHEN ${match}.winner_team_id = ${teamExpr} THEN 1 ELSE 0 END), 0)`;
}

/**
 * Défaites d'une équipe : **avoir joué la rencontre sans la gagner**.
 *
 * S'appuyer sur `bg_matches.loser_team_id` laissait filer les matchs où le
 * moteur pose un vainqueur sans renseigner le perdant — le classement se
 * calculait alors sur un total différent des points affichés sur la fiche.
 */
export function rankingLossesSql(teamExpr: string, match = "m"): string {
  return `COALESCE(SUM(CASE WHEN ${match}.winner_team_id IS NOT NULL AND ${match}.winner_team_id <> ${teamExpr} THEN 1 ELSE 0 END), 0)`;
}

/** Points de classement d'une équipe, directement en SQL (barème × assiette). */
export function rankingPointsForTeamSql(teamExpr: string, match = "m"): string {
  return rankingPointsSql(rankingWinsSql(teamExpr, match), rankingLossesSql(teamExpr, match));
}

/**
 * Ordre du classement du site, appliqué **en mémoire** pour que toutes les vues
 * trient à l'identique : points, puis victoires, puis nom.
 *
 * Le tri final se fait ici et non en SQL — la collation MySQL et
 * `localeCompare("fr")` ne départagent pas les noms de la même façon, et deux
 * vues triées chacune de son côté finiraient par afficher deux ordres.
 */
export function compareRankedTeams(
  a: { points: number; wins: number; name: string },
  b: { points: number; wins: number; name: string },
): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  return a.name.localeCompare(b.name, "fr");
}

/** Intitulé du total de points, partout où il s'affiche. */
export const RANKING_POINTS_LABEL = "Points de classement";

/**
 * Le barème en toutes lettres, dérivé des constantes plutôt que réécrit à la
 * main : une refonte du barème corrige d'elle-même la légende qui l'annonce.
 */
export const RANKING_POINTS_HINT = `${RANKING_POINTS_PER_WIN} par victoire, −${Math.abs(
  RANKING_POINTS_PER_LOSS,
)} par défaite`;
