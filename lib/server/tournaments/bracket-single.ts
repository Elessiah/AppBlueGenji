import type { PoolConnection } from "mysql2/promise";
import { generateSeedOrder, nextPowerOfTwo } from "@/lib/server/serialization";
import { TournamentRow } from "./_internal";
import {
  createMatch,
  setMatchParticipants,
  updateTournamentBracketSize,
} from "./repository";
import { statusFromTeams } from "./_internal";
import { tryAutoResolveByes } from "./byes";

async function linkMatchWinner(
  connection: PoolConnection,
  matchId: number,
  targetMatchId: number,
  targetSlot: number,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_matches
     SET next_winner_match_id = ?,
         next_winner_slot = ?
     WHERE id = ?`,
    [targetMatchId, targetSlot, matchId],
  );
}

async function linkMatchLoser(
  connection: PoolConnection,
  matchId: number,
  targetMatchId: number,
  targetSlot: number,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_matches
     SET next_loser_match_id = ?,
         next_loser_slot = ?
     WHERE id = ?`,
    [targetMatchId, targetSlot, matchId],
  );
}

export async function createSingleEliminationBracket(
  connection: PoolConnection,
  tournament: TournamentRow,
  registeredTeamIds: number[],
): Promise<void> {
  const bracketSize = nextPowerOfTwo(registeredTeamIds.length);
  const rounds = Math.ceil(Math.log2(bracketSize));
  const upper: number[][] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const matchesCount = bracketSize / 2 ** round;
    upper[round] = [];
    for (let matchNumber = 1; matchNumber <= matchesCount; matchNumber += 1) {
      const id = await createMatch(connection, tournament.id, "UPPER", round, matchNumber);
      upper[round].push(id);
    }
  }

  // Link winner progression
  for (let round = 1; round < rounds; round += 1) {
    for (let matchIndex = 0; matchIndex < upper[round].length; matchIndex += 1) {
      const source = upper[round][matchIndex];
      const target = upper[round + 1][Math.floor(matchIndex / 2)];
      const slot = matchIndex % 2 === 0 ? 1 : 2;
      await linkMatchWinner(connection, source, target, slot);
    }
  }

  // Third place match if applicable
  if (tournament.has_third_place_match && rounds >= 2) {
    const thirdPlaceId = await createMatch(connection, tournament.id, "THIRD_PLACE", 1, 1);
    const semis = upper[rounds - 1];
    for (let i = 0; i < semis.length; i += 1) {
      const slot = (i + 1) as 1 | 2;
      await linkMatchLoser(connection, semis[i], thirdPlaceId, slot);
      const placeholder = `Perdant demi-finale ${slot}`;
      await connection.execute(
        slot === 1
          ? `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`
          : `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
        [placeholder, thirdPlaceId],
      );
    }
  }

  // Seed and place teams
  const seedOrder = generateSeedOrder(bracketSize);
  const seedToPosition = new Map<number, number>();
  seedOrder.forEach((seed, index) => seedToPosition.set(seed, index));

  const slots = new Array<number | null>(bracketSize).fill(null);
  for (let i = 0; i < registeredTeamIds.length; i += 1) {
    const seed = i + 1;
    const position = seedToPosition.get(seed);
    if (position !== undefined) {
      slots[position] = registeredTeamIds[i];
    }
  }

  for (let matchIndex = 0; matchIndex < upper[1].length; matchIndex += 1) {
    const team1Id = slots[matchIndex * 2] ?? null;
    const team2Id = slots[matchIndex * 2 + 1] ?? null;
    const status = statusFromTeams(team1Id, team2Id);
    await setMatchParticipants(connection, upper[1][matchIndex], team1Id, team2Id, status);
  }

  await updateTournamentBracketSize(connection, tournament.id, bracketSize);
  await tryAutoResolveByes(connection, tournament.id);
}
