/**
 * Lecture du corps des deux routes d'arbitrage d'un score — « Enregistrer »
 * (`PATCH .../scores`) et « Valider le résultat » (`POST .../resolve`).
 *
 * Les deux routes acceptent la même alternative : un **forfait nominatif**
 * (`forfeitTeamId`), ou **deux scores**. `null` vaut absence. Le forfait
 * l'emporte quand il est présent ; sans lui, il faut les deux scores, entiers
 * entre 0 et 99. Ce qui dépend du match (format, engagées) se juge dans le
 * service, une fois le match chargé.
 */

/** Plus haut score accepté sur une manche. */
export const ADMIN_SCORE_MAX = 99;

export interface AdminScoreBody {
  team1Score?: unknown;
  team2Score?: unknown;
  forfeitTeamId?: unknown;
}

export interface AdminScoreInput {
  team1Score: number | undefined;
  team2Score: number | undefined;
  forfeitTeamId: number | undefined;
}

export type AdminScoreError = "INVALID_FORFEIT_TEAM_ID" | "INVALID_SCORES" | "MISSING_SCORES_OR_FORFEIT";

export type AdminScoreParse = { ok: true; value: AdminScoreInput } | { ok: false; error: AdminScoreError };

function optionalNumber(value: unknown): number | undefined {
  return value !== undefined && value !== null ? Number(value) : undefined;
}

function isValidScore(score: number): boolean {
  return Number.isInteger(score) && score >= 0 && score <= ADMIN_SCORE_MAX;
}

/** Valide le corps d'une saisie d'arbitrage ; voir l'en-tête du module. */
export function parseAdminScoreBody(body: AdminScoreBody): AdminScoreParse {
  const value: AdminScoreInput = {
    forfeitTeamId: optionalNumber(body.forfeitTeamId),
    team1Score: optionalNumber(body.team1Score),
    team2Score: optionalNumber(body.team2Score),
  };
  const { forfeitTeamId, team1Score, team2Score } = value;

  if (forfeitTeamId !== undefined) {
    return Number.isInteger(forfeitTeamId) && forfeitTeamId > 0
      ? { ok: true, value }
      : { ok: false, error: "INVALID_FORFEIT_TEAM_ID" };
  }
  if (team1Score === undefined || team2Score === undefined) {
    return { ok: false, error: "MISSING_SCORES_OR_FORFEIT" };
  }
  if (!isValidScore(team1Score) || !isValidScore(team2Score)) {
    return { ok: false, error: "INVALID_SCORES" };
  }
  return { ok: true, value };
}
