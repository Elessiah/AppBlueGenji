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

async function linkMatchLoserWithPlaceholder(
  connection: PoolConnection,
  sourceMatchId: number,
  targetMatchId: number,
  targetSlot: number,
  sourceRound: number,
  sourceMatchNumber: number,
): Promise<void> {
  await linkMatchLoser(connection, sourceMatchId, targetMatchId, targetSlot);

  const placeholderText = `Perdant match ${sourceMatchNumber} du upper R${sourceRound}`;
  if (targetSlot === 1) {
    await connection.execute(
      `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`,
      [placeholderText, targetMatchId],
    );
  } else {
    await connection.execute(
      `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
      [placeholderText, targetMatchId],
    );
  }
}

export async function createDoubleEliminationBracket(
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

  const lower: number[][] = [];
  let grandFinalMatchId: number | null = null;
  let lowerRoundsCount = 0;

  if (rounds >= 2) {
    lowerRoundsCount = 2 * (rounds - 1);

    for (let lbRound = 1; lbRound <= lowerRoundsCount; lbRound += 1) {
      const matchCount = Math.round(Math.pow(2, rounds - 2 - Math.floor((lbRound - 1) / 2)));

      lower[lbRound] = [];
      for (let matchNumber = 1; matchNumber <= matchCount; matchNumber += 1) {
        const id = await createMatch(connection, tournament.id, "LOWER", lbRound, matchNumber);
        lower[lbRound].push(id);
      }
    }

    grandFinalMatchId = await createMatch(connection, tournament.id, "GRAND", 1, 1);
  }

  // Upper bracket progressions
  for (let round = 1; round <= rounds; round += 1) {
    for (let matchIndex = 0; matchIndex < upper[round].length; matchIndex += 1) {
      const source = upper[round][matchIndex];

      if (round < rounds) {
        const target = upper[round + 1][Math.floor(matchIndex / 2)];
        const slot = matchIndex % 2 === 0 ? 1 : 2;
        await linkMatchWinner(connection, source, target, slot);
      } else if (grandFinalMatchId) {
        await linkMatchWinner(connection, source, grandFinalMatchId, 1);
        await connection.execute(
          `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`,
          [`Gagnant du upper bracket`, grandFinalMatchId],
        );
      }

      if (rounds < 2 || !grandFinalMatchId) {
        continue;
      }

      // Upper to lower bracket connections
      if (round === 1) {
        const target = lower[1][Math.floor(matchIndex / 2)];
        const slot = matchIndex % 2 === 0 ? 1 : 2;
        await linkMatchLoserWithPlaceholder(
          connection,
          source,
          target,
          slot,
          round,
          matchIndex + 1,
        );
      } else {
        const lbTargetRound = 2 * (round - 1);
        const target = lower[lbTargetRound]?.[matchIndex];
        if (target) {
          await linkMatchLoserWithPlaceholder(
            connection,
            source,
            target,
            2,
            round,
            matchIndex + 1,
          );
        }
      }
    }
  }

  // Lower bracket internal progressions
  if (rounds >= 2 && grandFinalMatchId) {
    for (let lbRound = 1; lbRound < lowerRoundsCount; lbRound += 1) {
      for (let matchIndex = 0; matchIndex < lower[lbRound].length; matchIndex += 1) {
        const source = lower[lbRound][matchIndex];
        const placeholder = `Gagnant match ${matchIndex + 1} du lower R${lbRound}`;

        if (lbRound % 2 === 1) {
          const target = lower[lbRound + 1]?.[matchIndex];
          if (target) {
            await linkMatchWinner(connection, source, target, 1);
            await connection.execute(
              `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`,
              [placeholder, target],
            );
          }
        } else {
          const targetIdx = Math.floor(matchIndex / 2);
          const slot = matchIndex % 2 === 0 ? 1 : 2;
          const target = lower[lbRound + 1]?.[targetIdx];
          if (target) {
            await linkMatchWinner(connection, source, target, slot);
            if (slot === 1) {
              await connection.execute(
                `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`,
                [placeholder, target],
              );
            } else {
              await connection.execute(
                `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
                [placeholder, target],
              );
            }
          }
        }
      }
    }

    // Final lower → grand final
    if (lower[lowerRoundsCount]?.length > 0 && grandFinalMatchId) {
      await linkMatchWinner(connection, lower[lowerRoundsCount][0], grandFinalMatchId, 2);
      await connection.execute(
        `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
        [`Gagnant du lower bracket`, grandFinalMatchId],
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
