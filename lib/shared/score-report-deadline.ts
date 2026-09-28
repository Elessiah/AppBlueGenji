import { SCORE_REPORT_TIMEOUT_MINUTES } from "./constants";
import { DEFAULT_MATCH_FORMAT, type MatchFormat, matchMaxMaps } from "./match-format";

/**
 * Durée **minimale** qu'on prête à une map jouée, en minutes.
 *
 * Une map d'Overwatch ou de Marvel Rivals dure rarement moins d'un quart
 * d'heure, préparation comprise : la valeur est volontairement basse — elle ne
 * doit jamais retarder un résultat réel, seulement interdire qu'un score
 * « joué » en deux minutes fasse foi pendant que l'adversaire joue encore.
 */
export const MIN_MINUTES_PER_REPORTED_MAP = 15;

/**
 * Plafond de maps prêté à une série, en maps décisives : celui du format de la
 * manche, ou celui du format par défaut du site (un BO5) en saisie libre.
 *
 * Sans plafond, un score libre fixait l'échéance à sa guise — « 99-98 » la
 * repoussait de deux jours, laissant la manche ouverte (et la ronde suivante
 * jamais posée) tant que l'adversaire ne répondait pas, et reculant d'autant
 * l'escalade à l'arbitrage si un conflit suivait.
 */
export function plausibleSeriesMapCap(format: MatchFormat | null): number {
  return matchMaxMaps(format ?? DEFAULT_MATCH_FORMAT);
}

/**
 * Durée plausible de la série qu'un report **affirme** avoir été jouée : le
 * nombre de maps décisives qu'il annonce (au moins une — un 0-0 nul reste une
 * rencontre, et au plus `plausibleSeriesMapCap`), chacune à
 * `MIN_MINUTES_PER_REPORTED_MAP`.
 *
 * Le délai de confirmation d'un report unilatéral ne court qu'**après** cette
 * fin de série plausible, comptée depuis le lancement du match : sans elle, un
 * engagé déclarait « 3-0 pour nous » à la seconde du lancement et l'emportait
 * dix minutes plus tard, l'adversaire étant encore en train de jouer sa série.
 */
export function plausibleSeriesMinutes(
  myScore: number,
  opponentScore: number,
  format: MatchFormat | null,
): number {
  const claimed = Math.max(1, Math.trunc(myScore) + Math.trunc(opponentScore));
  return Math.min(claimed, plausibleSeriesMapCap(format)) * MIN_MINUTES_PER_REPORTED_MAP;
}

/**
 * Échéance d'un report unilatéral (ms), en pur — la même règle que l'`UPDATE`
 * de `reportMatchScore`, qui la calcule en SQL pour rester dans le référentiel
 * d'horloge de la base : `max(maintenant, lancement + série plausible)` plus
 * `SCORE_REPORT_TIMEOUT_MINUTES`. Sans lancement connu, la série court depuis
 * maintenant.
 */
export function scoreReportDeadline(input: {
  now: number;
  launchedAt: number | null;
  myScore: number;
  opponentScore: number;
  format: MatchFormat | null;
}): number {
  const series = plausibleSeriesMinutes(input.myScore, input.opponentScore, input.format) * 60_000;
  const plausibleEnd = (input.launchedAt ?? input.now) + series;
  return Math.max(input.now, plausibleEnd) + SCORE_REPORT_TIMEOUT_MINUTES * 60_000;
}
