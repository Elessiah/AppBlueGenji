/**
 * Libellés d'attente d'un créneau de double élimination (« Perdant match 2 du
 * tableau principal, manche 1 »), affichés à la place d'une équipe tant que la
 * rencontre qui l'alimente n'est pas jouée.
 *
 * Ils sont **écrits en base** à la génération du tableau
 * (`bg_matches.team{1,2}_placeholder`) : les tournois générés avant la
 * traduction portent encore les libellés anglais (« upper bracket », « lower
 * R2 »). `localizeBracketPlaceholder` les traduit **à la lecture**, si bien
 * qu'aucune migration de données n'est nécessaire et qu'un tableau ancien se
 * lit dans la même langue qu'un tableau neuf.
 */

export const UPPER_FINAL_WINNER_PLACEHOLDER = "Vainqueur du tableau principal";
export const LOWER_FINAL_WINNER_PLACEHOLDER = "Vainqueur du tableau perdants";

/** Perdant d'une rencontre du tableau principal, qui tombe au tableau perdants. */
export function upperLoserPlaceholder(round: number, matchNumber: number): string {
  return `Perdant match ${matchNumber} du tableau principal, manche ${round}`;
}

/** Vainqueur d'une rencontre du tableau perdants. */
export function lowerWinnerPlaceholder(round: number, matchNumber: number): string {
  return `Gagnant match ${matchNumber} du tableau perdants, manche ${round}`;
}

const LEGACY_UPPER_LOSER = /^Perdant match (\d+) du upper R(\d+)$/;
const LEGACY_LOWER_WINNER = /^Gagnant match (\d+) du lower R(\d+)$/;

/**
 * Rend un libellé d'attente en français. Les anciens libellés anglais sont
 * traduits ; tout autre texte (libellés déjà français, « Perdant demi-finale 1 »)
 * est rendu tel quel.
 */
export function localizeBracketPlaceholder(text: string): string;
export function localizeBracketPlaceholder(text: string | null): string | null;
export function localizeBracketPlaceholder(text: string | null): string | null {
  if (text === null) return null;
  if (text === "Gagnant du upper bracket") return UPPER_FINAL_WINNER_PLACEHOLDER;
  if (text === "Gagnant du lower bracket") return LOWER_FINAL_WINNER_PLACEHOLDER;
  const upper = LEGACY_UPPER_LOSER.exec(text);
  if (upper) return upperLoserPlaceholder(Number(upper[2]), Number(upper[1]));
  const lower = LEGACY_LOWER_WINNER.exec(text);
  if (lower) return lowerWinnerPlaceholder(Number(lower[2]), Number(lower[1]));
  return text;
}
