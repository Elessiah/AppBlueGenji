import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { nextPowerOfTwo } from "@/lib/server/serialization";
import { TournamentRow } from "./_internal";
import {
  loadRegisteredTeamIds,
  hasExistingMatches,
  deleteAllMatches,
  deletePhaseMatches,
} from "./repository";
import { loadPhaseTeamIds } from "./phases-repository";
import { createSingleEliminationBracket } from "./bracket-single";
import { createDoubleEliminationBracket } from "./bracket-double";
import { publishUpdatedEvent } from "./notifications";

export async function createBracketIfMissing(
  connection: PoolConnection,
  tournament: TournamentRow,
  options?: {
    phaseId?: number;
    maxRounds?: number | null;
    /** Format de la phase — prioritaire sur celui du tournoi, qui vaut « MULTI ». */
    format?: "SINGLE" | "DOUBLE";
    hasThirdPlaceMatch?: boolean;
  },
): Promise<{ finished: boolean }> {
  const phaseId = options?.phaseId ?? 0;

  // Dans une phase, le plateau est celui de la phase (les qualifiées de la phase
  // précédente), pas l'ensemble des inscrites au tournoi.
  const registeredTeamIds =
    phaseId > 0
      ? await loadPhaseTeamIds(connection, phaseId)
      : await loadRegisteredTeamIds(connection, tournament.id);
  const expectedBracketSize = nextPowerOfTwo(registeredTeamIds.length);

  let hasExisting: boolean;
  let currentBracketSize: number | null;
  if (phaseId > 0) {
    const [rows] = await connection.execute<
      (RowDataPacket & { c: number; bracket_size: number | null })[]
    >(
      `SELECT
        (SELECT COUNT(*) FROM bg_matches WHERE tournament_id = ? AND phase_id = ?) AS c,
        (SELECT bracket_size FROM bg_tournament_phases WHERE id = ?) AS bracket_size`,
      [tournament.id, phaseId, phaseId],
    );
    hasExisting = Number(rows[0]?.c ?? 0) > 0;
    // La taille du bracket d'une phase est stockée sur la phase : comparer celle
    // du tournoi (toujours NULL en MULTI) rendrait la reconstruction systématique.
    currentBracketSize = rows[0]?.bracket_size === null ? null : Number(rows[0]?.bracket_size);
  } else {
    hasExisting = await hasExistingMatches(connection, tournament.id);
    currentBracketSize = tournament.bracket_size;
  }

  const bracketSizeChanged = currentBracketSize !== expectedBracketSize;

  if (hasExisting && !bracketSizeChanged) {
    return { finished: false };
  }

  if (hasExisting && bracketSizeChanged) {
    if (phaseId > 0) {
      await deletePhaseMatches(connection, tournament.id, phaseId);
    } else {
      await deleteAllMatches(connection, tournament.id);
    }
  }

  // Handle single or zero teams (do not finish tournament inside a phase)
  if (registeredTeamIds.length <= 1) {
    if (phaseId > 0) {
      return { finished: false };
    }

    if (registeredTeamIds.length === 1) {
      await connection.execute(
        `UPDATE bg_tournament_registrations
         SET final_rank = 1
         WHERE tournament_id = ? AND team_id = ?`,
        [tournament.id, registeredTeamIds[0]],
      );
    }

    await connection.execute(
      `UPDATE bg_tournaments
       SET state = 'FINISHED', finished_at = NOW(), bracket_size = ?
       WHERE id = ?`,
      [registeredTeamIds.length, tournament.id],
    );

    return { finished: true };
  }

  // Le format d'une phase prime sur celui du tournoi : ce dernier vaut « MULTI »
  // et ne décrit aucun bracket. Sans cela, une phase finale en double élimination
  // serait silencieusement générée en élimination simple.
  const effectiveFormat = options?.format ?? tournament.format;
  const bracketTournament =
    options?.hasThirdPlaceMatch === undefined
      ? tournament
      : { ...tournament, has_third_place_match: options.hasThirdPlaceMatch ? 1 : 0 };

  if (effectiveFormat === "DOUBLE") {
    await createDoubleEliminationBracket(connection, bracketTournament, registeredTeamIds, options);
  } else {
    await createSingleEliminationBracket(connection, bracketTournament, registeredTeamIds, options);
  }

  publishUpdatedEvent(tournament.id);
  return { finished: false };
}
