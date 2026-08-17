/**
 * Barème unique du classement des équipes du site.
 *
 * Il sert au leaderboard de la landing **et** au seeding du mode Survie : les
 * deux calculs vivaient auparavant chacun dans leur requête SQL, avec des
 * formules différentes (et de signe opposé sur les défaites), ce qui faisait
 * seeder une équipe perdante devant une équipe gagnante. Passer par ce module
 * garantit qu'ils ne peuvent plus diverger.
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
