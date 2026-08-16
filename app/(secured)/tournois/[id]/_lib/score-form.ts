import type { BracketMatch } from "@/lib/shared/types";

export interface ScoreFormState {
  score1: string;
  score2: string;
  forfeitTeamId?: number;
}

/**
 * Valeurs d'ouverture du dialogue d'édition : le score **du match ouvert**, et
 * 0-0 quand il n'a jamais été saisi. Isolé du hook pour rester testable — c'est
 * la source du remplissage, le hook se chargeant de le rejouer à chaque
 * changement de match (sans quoi le dialogue rouvrait sur le match précédent).
 */
export function scoreFormStateFor(match: BracketMatch | null): ScoreFormState {
  return {
    score1: String(match?.team1Score ?? 0),
    score2: String(match?.team2Score ?? 0),
    forfeitTeamId: match?.forfeitTeamId ?? undefined,
  };
}
