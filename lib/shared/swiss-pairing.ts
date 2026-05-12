export type Participant = {
  teamId: number;
  points: number;
  opponentIds: number[];
  hasReceivedBye: boolean;
};

export type Pairing = {
  teamAId: number;
  teamBId: number | null;
};

export function pairFirstRound(
  participants: Participant[],
  seed?: number,
): Pairing[] {
  if (participants.length === 0) return [];

  let sorted = [...participants];

  // If seed provided, shuffle using seeded PRNG; otherwise use default seed
  const actualSeed = seed ?? 0;
  sorted = shuffleWithSeed(sorted, actualSeed);

  const pairings: Pairing[] = [];
  const mid = Math.floor(sorted.length / 2);

  // Pair upper half vs lower half: 0-mid, 1-(mid+1), etc.
  for (let i = 0; i < mid; i++) {
    pairings.push({
      teamAId: sorted[i].teamId,
      teamBId: sorted[mid + i].teamId,
    });
  }

  // If odd number, last participant gets bye
  if (sorted.length % 2 === 1) {
    pairings.push({
      teamAId: sorted[sorted.length - 1].teamId,
      teamBId: null,
    });
  }

  return pairings;
}

export function pairNextRound(participants: Participant[]): Pairing[] {
  if (participants.length === 0) return [];

  // Sort by points descending, then by teamId ascending for determinism
  const sorted = [...participants].sort(
    (a, b) => b.points - a.points || a.teamId - b.teamId,
  );

  const remaining = [...sorted];
  const pairings: Pairing[] = [];

  // Handle bye for odd number of participants
  if (remaining.length % 2 === 1) {
    const byeIndex = pickByeIndex(remaining);
    const [byeParticipant] = remaining.splice(byeIndex, 1);
    pairings.push({ teamAId: byeParticipant.teamId, teamBId: null });
  }

  // Greedy pairing with swap to avoid rematches
  while (remaining.length > 0) {
    const a = remaining.shift()!;
    // Find first opponent not yet played against
    const candidateIdx = remaining.findIndex(
      (b) => !a.opponentIds.includes(b.teamId),
    );
    // If all have been played, accept rematch (edge case)
    const idx = candidateIdx === -1 ? 0 : candidateIdx;
    const [b] = remaining.splice(idx, 1);
    pairings.push({ teamAId: a.teamId, teamBId: b.teamId });
  }

  return pairings;
}

function pickByeIndex(participants: Participant[]): number {
  // Award bye to lowest-ranked participant without bye
  for (let i = participants.length - 1; i >= 0; i--) {
    if (!participants[i].hasReceivedBye) return i;
  }
  // Fallback: award to lowest rank
  return participants.length - 1;
}

function shuffleWithSeed(arr: Participant[], seed: number): Participant[] {
  const result = [...arr];
  const random = seededRandom(seed);
  // Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function seededRandom(seed: number): () => number {
  // Linear congruential generator (simple but deterministic)
  const m = 2147483647; // 2^31 - 1
  const a = 16807;
  let state = seed ? seed % (m - 1) : 1;

  return () => {
    state = (a * state) % m;
    return (state - 1) / (m - 1);
  };
}
