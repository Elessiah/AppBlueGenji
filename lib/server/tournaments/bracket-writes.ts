import type { PoolConnection } from "mysql2/promise";
import { generateSeedOrder } from "@/lib/server/serialization";
import { statusFromTeams, TournamentRow } from "./_internal";
import { createMatch, setMatchParticipants, updateTournamentBracketSize } from "./repository";
import { tryAutoResolveByes } from "./byes";

/**
 * Écritures communes aux générateurs de plateaux à élimination
 * (`bracket-single.ts`, `bracket-double.ts`) : création d'un tour, liens de
 * progression, libellés d'attente, placement des têtes de série et taille du
 * plateau. Les deux générateurs les écrivaient chacun en double.
 */

type Bracket = "UPPER" | "LOWER" | "GRAND" | "THIRD_PLACE";

/** Crée les `count` rencontres d'un tour, numérotées à partir de 1. */
export async function createRoundMatches(
  connection: PoolConnection,
  tournamentId: number,
  bracket: Bracket,
  round: number,
  count: number,
  phaseId: number,
): Promise<number[]> {
  const ids: number[] = [];
  for (let matchNumber = 1; matchNumber <= count; matchNumber += 1) {
    ids.push(await createMatch(connection, tournamentId, bracket, round, matchNumber, phaseId));
  }
  return ids;
}

export async function linkMatchWinner(
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

export async function linkMatchLoser(
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

/** Pose le libellé d'attente d'un créneau (`slot` 1 ou 2) d'une rencontre. */
export async function setSlotPlaceholder(
  connection: PoolConnection,
  matchId: number,
  slot: number,
  placeholder: string,
): Promise<void> {
  await connection.execute(
    slot === 1
      ? `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`
      : `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
    [placeholder, matchId],
  );
}

/** Créneau de la rencontre cible pour la `matchIndex`-ième rencontre d'un tour. */
export function feederSlot(matchIndex: number): 1 | 2 {
  return matchIndex % 2 === 0 ? 1 : 2;
}

/** Engagées rangées par position du premier tour, d'après l'ordre des têtes de série. */
function seededSlots(bracketSize: number, registeredTeamIds: number[]): (number | null)[] {
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
  return slots;
}

/**
 * Place les engagées au premier tour, enregistre la taille du plateau (sur la
 * phase ou sur le tournoi) puis résout les exemptions.
 */
export async function seedAndFinalizeBracket(
  connection: PoolConnection,
  tournament: TournamentRow,
  firstRound: number[],
  bracketSize: number,
  registeredTeamIds: number[],
  phaseId: number,
): Promise<void> {
  const slots = seededSlots(bracketSize, registeredTeamIds);

  for (let matchIndex = 0; matchIndex < firstRound.length; matchIndex += 1) {
    const team1Id = slots[matchIndex * 2] ?? null;
    const team2Id = slots[matchIndex * 2 + 1] ?? null;
    const status = statusFromTeams(team1Id, team2Id);
    await setMatchParticipants(connection, firstRound[matchIndex], team1Id, team2Id, status);
  }

  if (phaseId > 0) {
    await connection.execute(
      `UPDATE bg_tournament_phases SET bracket_size = ? WHERE id = ?`,
      [bracketSize, phaseId],
    );
  } else {
    await updateTournamentBracketSize(connection, tournament.id, bracketSize);
  }
  await tryAutoResolveByes(connection, tournament.id, phaseId);
}
