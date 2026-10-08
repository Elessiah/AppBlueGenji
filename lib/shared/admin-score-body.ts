/**
 * Lecture du corps des deux routes d'arbitrage d'un score — « Enregistrer »
 * (`PATCH .../scores`) et « Valider le résultat » (`POST .../resolve`).
 *
 * Les deux routes acceptent la même alternative : un **forfait nominatif**
 * (`forfeitTeamId`), ou le **détail map par map** (`maps`), dont le score se
 * dérive (`docs/features/MAP_SCORES.md`). Il n'y a plus de score posé à la
 * main : un corps `team1Score` / `team2Score` sans maps se refuse comme une
 * liste vide. `null` vaut absence. Le forfait l'emporte quand il est présent.
 * Ce qui dépend du match (format, jeu, engagées) se juge dans le service, une
 * fois le match chargé.
 */

import { parseMapListBody, type MatchMapInput } from "./match-maps";

export interface AdminScoreBody {
  forfeitTeamId?: unknown;
  maps?: unknown;
}

export type AdminScoreInput = { forfeitTeamId: number } | { maps: MatchMapInput[] };

export type AdminScoreError = "INVALID_FORFEIT_TEAM_ID" | "INVALID_MAPS" | "MAP_LIST_EMPTY";

export type AdminScoreParse = { ok: true; value: AdminScoreInput } | { ok: false; error: AdminScoreError };

/** Valide le corps d'une saisie d'arbitrage ; voir l'en-tête du module. */
export function parseAdminScoreBody(body: AdminScoreBody): AdminScoreParse {
  if (body.forfeitTeamId !== undefined && body.forfeitTeamId !== null) {
    const forfeitTeamId = Number(body.forfeitTeamId);
    return Number.isInteger(forfeitTeamId) && forfeitTeamId > 0
      ? { ok: true, value: { forfeitTeamId } }
      : { ok: false, error: "INVALID_FORFEIT_TEAM_ID" };
  }
  if (body.maps === undefined || body.maps === null) return { ok: false, error: "MAP_LIST_EMPTY" };
  const maps = parseMapListBody(body.maps);
  if (maps === null) return { ok: false, error: "INVALID_MAPS" };
  if (maps.length === 0) return { ok: false, error: "MAP_LIST_EMPTY" };
  return { ok: true, value: { maps } };
}
