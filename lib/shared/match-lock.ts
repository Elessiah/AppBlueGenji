import type { BracketMatch, TournamentFormat } from "./types";

/**
 * Verrouillage de l'édition d'un score.
 *
 * Règle : dès qu'un match dépendant (la « manche suivante ») porte la moindre
 * saisie de score, le match amont n'est plus modifiable — **y compris par un
 * admin**. Corriger un résultat amont réécrirait en effet les participants d'un
 * match déjà entamé, laissant des scores attribués aux mauvaises équipes.
 *
 * Le module est volontairement pur pour que le serveur (garde-fou réel, dans
 * `lib/server/tournaments/admin.ts`) et l'interface (masquage du bouton
 * « Éditer le score ») appliquent exactement la même règle.
 */

/** Vue minimale d'un match, commune aux lignes SQL et au type `BracketMatch`. */
export interface MatchScoreState {
  id: number;
  roundNumber: number;
  team1Id: number | null;
  team2Id: number | null;
  team1Score: number | null;
  team2Score: number | null;
  winnerTeamId: number | null;
  forfeitTeamId: number | null;
  /** Au moins une équipe a saisi un score en attente de confirmation. */
  hasPendingReport: boolean;
  nextWinnerMatchId: number | null;
  nextLoserMatchId: number | null;
}

/**
 * Adapte un match tel que servi à l'interface. Le détail public n'expose pas les
 * horodatages de report : le statut `AWAITING_CONFIRMATION` signale exactement la
 * même chose (au moins une équipe a saisi un score).
 */
export function fromBracketMatch(match: BracketMatch): MatchScoreState {
  return {
    id: match.id,
    roundNumber: match.roundNumber,
    team1Id: match.team1Id,
    team2Id: match.team2Id,
    team1Score: match.team1Score,
    team2Score: match.team2Score,
    winnerTeamId: match.winnerTeamId,
    forfeitTeamId: match.forfeitTeamId,
    hasPendingReport: match.status === "AWAITING_CONFIRMATION",
    nextWinnerMatchId: match.nextWinnerMatchId,
    nextLoserMatchId: match.nextLoserMatchId,
  };
}

/**
 * Un match porte-t-il une saisie de score ? Compte comme saisie : un score (même
 * 0), un vainqueur, un forfait, ou un report en attente de confirmation.
 *
 * Les matchs à une seule équipe (bye) ou sans équipe (match fantôme) sont exclus :
 * leur score est posé automatiquement par le moteur (1-0, 0-0), personne ne l'a
 * saisi — les bloquer figerait tout un bracket à trous.
 */
export function hasScoreInput(match: MatchScoreState): boolean {
  if (match.team1Id === null || match.team2Id === null) return false;
  return (
    match.team1Score !== null ||
    match.team2Score !== null ||
    match.winnerTeamId !== null ||
    match.forfeitTeamId !== null ||
    match.hasPendingReport
  );
}

/**
 * Matchs dont le contenu dépend du résultat de `match`.
 *
 * · Élimination simple / double : les matchs cibles du vainqueur et du perdant.
 * · Survie / ronde suisse : pas de liens de bracket — les appariements du round
 *   suivant sont recalculés à partir du classement, donc tout round ultérieur
 *   dépend du résultat.
 */
export function dependentMatches(
  match: MatchScoreState,
  allMatches: MatchScoreState[],
  format: TournamentFormat,
): MatchScoreState[] {
  if (format === "SURVIVAL" || format === "SWISS") {
    return allMatches.filter((m) => m.roundNumber > match.roundNumber);
  }

  const targets = [match.nextWinnerMatchId, match.nextLoserMatchId].filter(
    (id): id is number => id !== null,
  );
  if (targets.length === 0) return [];
  return allMatches.filter((m) => targets.includes(m.id));
}

/**
 * Le score de ce match est-il verrouillé ? Un match encore indécis reste
 * toujours modifiable : rien n'a été propagé, c'est la première saisie.
 */
export function isScoreEditLocked(
  match: MatchScoreState,
  allMatches: MatchScoreState[],
  format: TournamentFormat,
): boolean {
  if (match.winnerTeamId === null) return false;
  return dependentMatches(match, allMatches, format).some(hasScoreInput);
}
