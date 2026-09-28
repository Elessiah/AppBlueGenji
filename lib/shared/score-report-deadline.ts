import { SCORE_REPORT_TIMEOUT_MINUTES } from "./constants";
import { DEFAULT_MATCH_FORMAT, type MatchFormat, matchMaxMaps } from "./match-format";

/**
 * Durée **minimale** qu'on prête à une map jouée, en minutes.
 *
 * Une map d'Overwatch ou de Marvel Rivals dure rarement moins d'un quart
 * d'heure, préparation comprise : la valeur est volontairement basse — elle ne
 * doit pas retarder démesurément un résultat réel, seulement interdire qu'un
 * score « joué » en deux minutes fasse foi pendant que l'adversaire joue encore.
 */
export const MIN_MINUTES_PER_REPORTED_MAP = 15;

/**
 * Plafond de maps de la série, en maps décisives : celui du format de la
 * manche, ou celui du format par défaut du site (un BO5) en saisie libre.
 */
export function plausibleSeriesMapCap(format: MatchFormat | null): number {
  return matchMaxMaps(format ?? DEFAULT_MATCH_FORMAT);
}

/**
 * Durée plausible d'une série **complète** au format de la manche : son
 * plafond de maps, chacune à `MIN_MINUTES_PER_REPORTED_MAP`.
 *
 * Le délai de confirmation d'un report unilatéral ne court qu'**après** cette
 * fin de série plausible, comptée depuis le lancement du match : sans elle, un
 * engagé déclarait « 3-0 pour nous » à la seconde du lancement et l'emportait
 * dix minutes plus tard, l'adversaire étant encore en train de jouer sa série.
 *
 * La durée se lit sur le **format**, jamais sur le score déclaré. Lue sur le
 * score, elle était à la main du déclarant dans les deux sens : un « 1-0 » (ou
 * un « 0-0 » là où le nul est permis) raccourcissait l'attente à une seule map,
 * un « 99-98 » en saisie libre la repoussait de deux jours — et, l'échéance
 * devant alors suivre le report en vigueur, chaque resaisie la recalculait. Le
 * prix est connu et assumé : un résultat réellement acquis en trois maps attend
 * la série entière avant de valoir seul — la confirmation de l'adversaire, elle,
 * le clôt sur-le-champ.
 */
export function plausibleSeriesMinutes(format: MatchFormat | null): number {
  return plausibleSeriesMapCap(format) * MIN_MINUTES_PER_REPORTED_MAP;
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
  format: MatchFormat | null;
}): number {
  const series = plausibleSeriesMinutes(input.format) * 60_000;
  const plausibleEnd = (input.launchedAt ?? input.now) + series;
  return Math.max(input.now, plausibleEnd) + SCORE_REPORT_TIMEOUT_MINUTES * 60_000;
}
