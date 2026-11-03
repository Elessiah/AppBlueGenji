/**
 * Gardes d'arbitrage qui ne lisent rien (`docs/features/SCORE_DISPUTE_LOCK.md`),
 * à part d'`./admin` : la couche publique d'« Enregistrer » (`./index`) les
 * joue sur sa lecture préalable, avant la transaction et le verrou du tournoi,
 * et le moteur les rejoue sous verrou.
 */

import type { AdminMapEntry, AdminResolveEntry, AdminScoreEntry } from "./admin";

type MatchEntrants = { team1_id: number | null; team2_id: number | null };

/**
 * Un match qu'« Enregistrer » peut noter : ses deux engagés en place, et pas
 * encore tranché (sur le **statut** : un match nul est terminé sans vainqueur).
 * Une seule règle pour la lecture préalable, hors transaction
 * (`adminSaveMatchScoresPublic`), et pour la lecture sous verrou.
 *
 * @throws `MATCH_NOT_READY`, `MATCH_ALREADY_COMPLETED`
 */
export function assertMatchSavable(match: MatchEntrants & { status: string }): void {
  if (match.team1_id === null || match.team2_id === null) throw new Error("MATCH_NOT_READY");
  if (match.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
}

export function assertForfeitBelongsToMatch(match: MatchEntrants, forfeitTeamId: number): void {
  if (forfeitTeamId !== Number(match.team1_id) && forfeitTeamId !== Number(match.team2_id)) {
    throw new Error("INVALID_FORFEIT_TEAM_ID");
  }
}

/**
 * Les maps d'une saisie, ou `INVALID_REQUEST` : le type ferme la porte aux
 * appelants TypeScript, la garde la ferme à tous (corps non typé, conversion).
 */
export function mapEntryOf(entry: AdminResolveEntry): AdminMapEntry {
  if ("maps" in entry && Array.isArray(entry.maps) && Number.isInteger(entry.userId)) return entry;
  throw new Error("INVALID_REQUEST");
}

/**
 * La saisie d'« Enregistrer » tient-elle sur ce match, sans rien lire : forfait
 * d'une des deux engagées, ou détail map par map bien formé. Le contrôle des
 * maps contre le format et la fenêtre de saisie lisent les règles du tournoi :
 * ils restent sous verrou (`checkAdminMaps`), une seule lecture par saisie.
 *
 * @throws `INVALID_FORFEIT_TEAM_ID`, `INVALID_REQUEST`
 */
export function assertSaveEntryFits(match: MatchEntrants, entry: AdminScoreEntry): void {
  if ("forfeitTeamId" in entry) assertForfeitBelongsToMatch(match, entry.forfeitTeamId);
  else mapEntryOf(entry);
}
