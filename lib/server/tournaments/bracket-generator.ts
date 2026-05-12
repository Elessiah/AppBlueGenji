import type { PoolConnection } from "mysql2/promise";
import { nextPowerOfTwo } from "@/lib/server/serialization";
import { TournamentRow } from "./_internal";
import {
  loadRegisteredTeamIds,
  hasExistingMatches,
  deleteAllMatches,
} from "./repository";
import { createSingleEliminationBracket } from "./bracket-single";
import { createDoubleEliminationBracket } from "./bracket-double";
import { publishUpdatedEvent } from "./notifications";

export async function createBracketIfMissing(
  connection: PoolConnection,
  tournament: TournamentRow,
): Promise<void> {
  const registeredTeamIds = await loadRegisteredTeamIds(connection, tournament.id);
  const expectedBracketSize = nextPowerOfTwo(registeredTeamIds.length);

  const hasExisting = await hasExistingMatches(connection, tournament.id);
  const bracketSizeChanged = tournament.bracket_size !== expectedBracketSize;

  if (hasExisting && !bracketSizeChanged) {
    return;
  }

  if (hasExisting && bracketSizeChanged) {
    await deleteAllMatches(connection, tournament.id);
  }

  // Handle single or zero teams
  if (registeredTeamIds.length <= 1) {
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

    return;
  }

  // Create appropriate bracket type
  if (tournament.format === "DOUBLE") {
    await createDoubleEliminationBracket(connection, tournament, registeredTeamIds);
  } else {
    await createSingleEliminationBracket(connection, tournament, registeredTeamIds);
  }

  publishUpdatedEvent(tournament.id);
}
