import type { PoolConnection } from "mysql2/promise";
import { nextPowerOfTwo } from "@/lib/server/serialization";
import { TournamentRow } from "./_internal";
import { createMatch } from "./repository";
import {
  createRoundMatches,
  feederSlot,
  linkMatchLoser,
  linkMatchWinner,
  seedAndFinalizeBracket,
  setSlotPlaceholder,
} from "./bracket-writes";

/** Pose la petite finale et y relie les perdants des demi-finales. */
async function createThirdPlaceMatch(
  connection: PoolConnection,
  tournamentId: number,
  semis: number[],
  phaseId: number,
): Promise<void> {
  const thirdPlaceId = await createMatch(connection, tournamentId, "THIRD_PLACE", 1, 1, phaseId);
  for (let i = 0; i < semis.length; i += 1) {
    const slot = (i + 1) as 1 | 2;
    await linkMatchLoser(connection, semis[i], thirdPlaceId, slot);
    await setSlotPlaceholder(connection, thirdPlaceId, slot, `Perdant demi-finale ${slot}`);
  }
}

export async function createSingleEliminationBracket(
  connection: PoolConnection,
  tournament: TournamentRow,
  registeredTeamIds: number[],
  options?: { phaseId?: number; maxRounds?: number | null },
): Promise<void> {
  const phaseId = options?.phaseId ?? 0;
  const bracketSize = nextPowerOfTwo(registeredTeamIds.length);
  const fullRounds = Math.ceil(Math.log2(bracketSize));
  const rounds = options?.maxRounds ? Math.min(fullRounds, options.maxRounds) : fullRounds;
  const upper: number[][] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const matchesCount = bracketSize / 2 ** round;
    upper[round] = await createRoundMatches(connection, tournament.id, "UPPER", round, matchesCount, phaseId);
  }

  // Link winner progression only between generated rounds
  for (let round = 1; round < rounds; round += 1) {
    for (let matchIndex = 0; matchIndex < upper[round].length; matchIndex += 1) {
      const target = upper[round + 1][Math.floor(matchIndex / 2)];
      await linkMatchWinner(connection, upper[round][matchIndex], target, feederSlot(matchIndex));
    }
  }

  // Third place match only when bracket is not truncated
  if (tournament.has_third_place_match && rounds >= 2 && rounds === fullRounds) {
    await createThirdPlaceMatch(connection, tournament.id, upper[rounds - 1], phaseId);
  }

  await seedAndFinalizeBracket(connection, tournament, upper[1], bracketSize, registeredTeamIds, phaseId);
}
