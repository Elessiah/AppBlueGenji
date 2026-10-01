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
import {
  LOWER_FINAL_WINNER_PLACEHOLDER,
  UPPER_FINAL_WINNER_PLACEHOLDER,
  lowerWinnerPlaceholder,
  upperLoserPlaceholder,
} from "@/lib/shared/bracket-placeholders";

/** Rencontres créées d'un plateau à double élimination, tour par tour (index 1). */
type DoubleBracketMatches = {
  rounds: number;
  upper: number[][];
  lower: number[][];
  lowerRoundsCount: number;
  grandFinalMatchId: number | null;
};

async function linkMatchLoserWithPlaceholder(
  connection: PoolConnection,
  sourceMatchId: number,
  targetMatchId: number,
  targetSlot: number,
  sourceRound: number,
  sourceMatchNumber: number,
): Promise<void> {
  await linkMatchLoser(connection, sourceMatchId, targetMatchId, targetSlot);

  const placeholderText = upperLoserPlaceholder(sourceRound, sourceMatchNumber);
  await setSlotPlaceholder(connection, targetMatchId, targetSlot, placeholderText);
}

/**
 * Crée toutes les rencontres : tableau principal, puis (dès deux tours)
 * tableau de repêchage et grande finale.
 */
async function createDoubleBracketMatches(
  connection: PoolConnection,
  tournamentId: number,
  bracketSize: number,
  phaseId: number,
): Promise<DoubleBracketMatches> {
  const rounds = Math.ceil(Math.log2(bracketSize));
  const upper: number[][] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const matchesCount = bracketSize / 2 ** round;
    upper[round] = await createRoundMatches(connection, tournamentId, "UPPER", round, matchesCount, phaseId);
  }

  const lower: number[][] = [];
  let grandFinalMatchId: number | null = null;
  let lowerRoundsCount = 0;

  if (rounds >= 2) {
    lowerRoundsCount = 2 * (rounds - 1);

    for (let lbRound = 1; lbRound <= lowerRoundsCount; lbRound += 1) {
      const matchCount = Math.round(Math.pow(2, rounds - 2 - Math.floor((lbRound - 1) / 2)));
      lower[lbRound] = await createRoundMatches(connection, tournamentId, "LOWER", lbRound, matchCount, phaseId);
    }

    grandFinalMatchId = await createMatch(connection, tournamentId, "GRAND", 1, 1, phaseId);
  }

  return { rounds, upper, lower, lowerRoundsCount, grandFinalMatchId };
}

/** Relie une rencontre du tableau principal : vainqueur, puis perdant au repêchage. */
async function linkUpperMatch(
  connection: PoolConnection,
  bracket: DoubleBracketMatches,
  round: number,
  matchIndex: number,
): Promise<void> {
  const { rounds, upper, lower, grandFinalMatchId } = bracket;
  const source = upper[round][matchIndex];

  if (round < rounds) {
    const target = upper[round + 1][Math.floor(matchIndex / 2)];
    await linkMatchWinner(connection, source, target, feederSlot(matchIndex));
  } else if (grandFinalMatchId) {
    await linkMatchWinner(connection, source, grandFinalMatchId, 1);
    await setSlotPlaceholder(connection, grandFinalMatchId, 1, UPPER_FINAL_WINNER_PLACEHOLDER);
  }

  if (rounds < 2 || !grandFinalMatchId) {
    return;
  }

  // Upper to lower bracket connections
  if (round === 1) {
    const target = lower[1][Math.floor(matchIndex / 2)];
    await linkMatchLoserWithPlaceholder(
      connection,
      source,
      target,
      feederSlot(matchIndex),
      round,
      matchIndex + 1,
    );
    return;
  }

  const lbTargetRound = 2 * (round - 1);
  const target = lower[lbTargetRound]?.[matchIndex];
  if (target) {
    await linkMatchLoserWithPlaceholder(connection, source, target, 2, round, matchIndex + 1);
  }
}

/**
 * Relie une rencontre du repêchage au tour suivant : un tour impair alimente
 * le créneau 1 de la rencontre de même rang, un tour pair fusionne deux
 * rencontres en une.
 */
async function linkLowerMatch(
  connection: PoolConnection,
  lower: number[][],
  lbRound: number,
  matchIndex: number,
): Promise<void> {
  const source = lower[lbRound][matchIndex];
  const placeholder = lowerWinnerPlaceholder(lbRound, matchIndex + 1);
  const odd = lbRound % 2 === 1;
  const slot = odd ? 1 : feederSlot(matchIndex);
  const target = lower[lbRound + 1]?.[odd ? matchIndex : Math.floor(matchIndex / 2)];
  if (target) {
    await linkMatchWinner(connection, source, target, slot);
    await setSlotPlaceholder(connection, target, slot, placeholder);
  }
}

async function linkLowerBracket(
  connection: PoolConnection,
  bracket: DoubleBracketMatches,
  grandFinalMatchId: number,
): Promise<void> {
  const { lower, lowerRoundsCount } = bracket;
  for (let lbRound = 1; lbRound < lowerRoundsCount; lbRound += 1) {
    for (let matchIndex = 0; matchIndex < lower[lbRound].length; matchIndex += 1) {
      await linkLowerMatch(connection, lower, lbRound, matchIndex);
    }
  }

  // Final lower → grand final
  if (lower[lowerRoundsCount]?.length > 0) {
    await linkMatchWinner(connection, lower[lowerRoundsCount][0], grandFinalMatchId, 2);
    await setSlotPlaceholder(connection, grandFinalMatchId, 2, LOWER_FINAL_WINNER_PLACEHOLDER);
  }
}

export async function createDoubleEliminationBracket(
  connection: PoolConnection,
  tournament: TournamentRow,
  registeredTeamIds: number[],
  options?: { phaseId?: number },
): Promise<void> {
  // DOUBLE élimination n'est autorisée que comme phase finale.
  // Les phases intermédiaires doivent filtrer les équipes via SINGLE ou SWISS.
  const phaseId = options?.phaseId ?? 0;
  const bracketSize = nextPowerOfTwo(registeredTeamIds.length);
  const bracket = await createDoubleBracketMatches(connection, tournament.id, bracketSize, phaseId);
  const { rounds, upper, grandFinalMatchId } = bracket;

  // Upper bracket progressions
  for (let round = 1; round <= rounds; round += 1) {
    for (let matchIndex = 0; matchIndex < upper[round].length; matchIndex += 1) {
      await linkUpperMatch(connection, bracket, round, matchIndex);
    }
  }

  // Lower bracket internal progressions
  if (rounds >= 2 && grandFinalMatchId) {
    await linkLowerBracket(connection, bracket, grandFinalMatchId);
  }

  await seedAndFinalizeBracket(connection, tournament, upper[1], bracketSize, registeredTeamIds, phaseId);
}
