import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { nextPowerOfTwo } from "@/lib/server/serialization";
import { TournamentRow } from "./_internal";
import {
  loadRegisteredTeamIds,
  hasExistingMatches,
  deleteAllMatches,
  deletePhaseMatches,
} from "./repository";
import { createSingleEliminationBracket } from "./bracket-single";
import { createDoubleEliminationBracket } from "./bracket-double";
import { publishUpdatedEvent } from "./notifications";

export async function createBracketIfMissing(
  connection: PoolConnection,
  tournament: TournamentRow,
  options?: { phaseId?: number; maxRounds?: number | null },
): Promise<{ finished: boolean }> {
  const phaseId = options?.phaseId ?? 0;
  const registeredTeamIds = await loadRegisteredTeamIds(connection, tournament.id);
  const expectedBracketSize = nextPowerOfTwo(registeredTeamIds.length);

  let hasExisting: boolean;
  if (phaseId > 0) {
    const [rows] = await connection.execute<(RowDataPacket & { c: number })[]>(
      `SELECT COUNT(*) AS c FROM bg_matches WHERE tournament_id = ? AND phase_id = ?`,
      [tournament.id, phaseId],
    );
    hasExisting = Number(rows[0]?.c ?? 0) > 0;
  } else {
    hasExisting = await hasExistingMatches(connection, tournament.id);
  }

  const bracketSizeChanged = tournament.bracket_size !== expectedBracketSize;

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

  // Create appropriate bracket type
  if (tournament.format === "DOUBLE") {
    await createDoubleEliminationBracket(connection, tournament, registeredTeamIds, options);
  } else {
    await createSingleEliminationBracket(connection, tournament, registeredTeamIds, options);
  }

  publishUpdatedEvent(tournament.id);
  return { finished: false };
}
