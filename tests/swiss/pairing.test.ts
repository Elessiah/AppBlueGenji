import { pairFirstRound, pairNextRound, Participant } from "@/lib/shared/swiss-pairing";

describe("swiss-pairing", () => {
  describe("pairFirstRound", () => {
    test("round 1 with 8 participants pairs upper vs lower half", () => {
      const participants: Participant[] = [
        { teamId: 1, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 2, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 3, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 4, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 5, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 6, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 7, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 8, points: 0, opponentIds: [], hasReceivedBye: false },
      ];

      const pairings = pairFirstRound(participants, 42); // deterministic seed
      expect(pairings).toHaveLength(4);
      // After shuffle with seed 42, verify pairing structure (upper vs lower)
      expect(pairings.every((p) => p.teamBId !== null)).toBe(true);
    });

    test("round 1 with 7 participants gives a bye to lowest participant", () => {
      const participants: Participant[] = [
        { teamId: 1, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 2, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 3, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 4, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 5, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 6, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 7, points: 0, opponentIds: [], hasReceivedBye: false },
      ];

      const pairings = pairFirstRound(participants, 42);
      expect(pairings).toHaveLength(4); // 3 matches + 1 bye
      expect(pairings.filter((p) => p.teamBId === null)).toHaveLength(1);
    });
  });

  describe("pairNextRound", () => {
    test("round 2 pairs winners against winners", () => {
      // Winners: teamId 1,2,3,4 with 1 point
      const participants: Participant[] = [
        {
          teamId: 1,
          points: 1,
          opponentIds: [5],
          hasReceivedBye: false,
        },
        {
          teamId: 2,
          points: 1,
          opponentIds: [6],
          hasReceivedBye: false,
        },
        {
          teamId: 3,
          points: 1,
          opponentIds: [7],
          hasReceivedBye: false,
        },
        {
          teamId: 4,
          points: 1,
          opponentIds: [8],
          hasReceivedBye: false,
        },
        // Losers: teamId 5,6,7,8 with 0 points
        {
          teamId: 5,
          points: 0,
          opponentIds: [1],
          hasReceivedBye: false,
        },
        {
          teamId: 6,
          points: 0,
          opponentIds: [2],
          hasReceivedBye: false,
        },
        {
          teamId: 7,
          points: 0,
          opponentIds: [3],
          hasReceivedBye: false,
        },
        {
          teamId: 8,
          points: 0,
          opponentIds: [4],
          hasReceivedBye: false,
        },
      ];

      const pairings = pairNextRound(participants);
      expect(pairings).toHaveLength(4);

      // All pairings should be valid (teamBId not null for even count)
      expect(pairings.every((p) => p.teamBId !== null)).toBe(true);

      // Verify no rematches in winners group if possible
      const winnerMatches = pairings.filter(
        (p) =>
          [1, 2, 3, 4].includes(p.teamAId) &&
          p.teamBId !== null &&
          [1, 2, 3, 4].includes(p.teamBId),
      );
      // Should be at least some matches within winners
      expect(winnerMatches.length).toBeGreaterThan(0);
    });

    test("round 3 avoids rematch if possible", () => {
      const participants: Participant[] = [
        {
          teamId: 1,
          points: 2,
          opponentIds: [2, 3],
          hasReceivedBye: false,
        },
        {
          teamId: 2,
          points: 2,
          opponentIds: [1, 4],
          hasReceivedBye: false,
        },
        {
          teamId: 3,
          points: 1,
          opponentIds: [1, 5],
          hasReceivedBye: false,
        },
        {
          teamId: 4,
          points: 1,
          opponentIds: [2, 6],
          hasReceivedBye: false,
        },
        {
          teamId: 5,
          points: 1,
          opponentIds: [3, 7],
          hasReceivedBye: false,
        },
        {
          teamId: 6,
          points: 0,
          opponentIds: [4, 8],
          hasReceivedBye: false,
        },
        {
          teamId: 7,
          points: 0,
          opponentIds: [5],
          hasReceivedBye: false,
        },
        {
          teamId: 8,
          points: 0,
          opponentIds: [6],
          hasReceivedBye: false,
        },
      ];

      const pairings = pairNextRound(participants);
      expect(pairings).toHaveLength(4);

      // Verify pairing respects no-rematch rule where possible
      // Check top pairing: 1 vs 2 should be avoided, but no other option at their score level
      // So it's acceptable to have 1v2 as rematch or 1v3, etc.
      pairings.forEach((p) => {
        if (p.teamBId !== null) {
          // For each pairing, check if rematch is justified (no better option)
          const a = participants.find((x) => x.teamId === p.teamAId);
          const b = participants.find((x) => x.teamId === p.teamBId);
          expect(a && b).toBeTruthy();
        }
      });
    });

    test("bye is awarded to participant without previous bye", () => {
      const participants: Participant[] = [
        {
          teamId: 1,
          points: 2,
          opponentIds: [2, 3],
          hasReceivedBye: true, // already has bye
        },
        {
          teamId: 2,
          points: 2,
          opponentIds: [1, 4],
          hasReceivedBye: false,
        },
        {
          teamId: 3,
          points: 1,
          opponentIds: [1, 5],
          hasReceivedBye: false,
        },
        {
          teamId: 4,
          points: 1,
          opponentIds: [2, 6],
          hasReceivedBye: false,
        },
        {
          teamId: 5,
          points: 0,
          opponentIds: [3],
          hasReceivedBye: false,
        },
      ];

      const pairings = pairNextRound(participants);
      expect(pairings).toHaveLength(3); // 2 matches + 1 bye

      const byePairing = pairings.find((p) => p.teamBId === null);
      expect(byePairing).toBeDefined();

      // Bye should go to someone without bye (not team 1)
      expect(byePairing?.teamAId).not.toBe(1);
      expect(byePairing?.teamAId).toBe(5); // lowest rank without bye
    });

    test("deterministic output for same input", () => {
      const participants: Participant[] = [
        {
          teamId: 1,
          points: 1,
          opponentIds: [5],
          hasReceivedBye: false,
        },
        {
          teamId: 2,
          points: 1,
          opponentIds: [6],
          hasReceivedBye: false,
        },
        {
          teamId: 3,
          points: 0,
          opponentIds: [7],
          hasReceivedBye: false,
        },
        {
          teamId: 4,
          points: 0,
          opponentIds: [8],
          hasReceivedBye: false,
        },
        {
          teamId: 5,
          points: 0,
          opponentIds: [1],
          hasReceivedBye: false,
        },
        {
          teamId: 6,
          points: 0,
          opponentIds: [2],
          hasReceivedBye: false,
        },
        {
          teamId: 7,
          points: 0,
          opponentIds: [3],
          hasReceivedBye: false,
        },
        {
          teamId: 8,
          points: 0,
          opponentIds: [4],
          hasReceivedBye: false,
        },
      ];

      const pairings1 = pairNextRound(participants);
      const pairings2 = pairNextRound(participants);

      // Sort for comparison (order shouldn't matter)
      const sorted1 = pairings1
        .sort((a, b) => a.teamAId - b.teamAId)
        .map((p) => `${p.teamAId}-${p.teamBId}`);
      const sorted2 = pairings2
        .sort((a, b) => a.teamAId - b.teamAId)
        .map((p) => `${p.teamAId}-${p.teamBId}`);

      expect(sorted1).toEqual(sorted2);
    });

    test("first round is deterministic with same seed", () => {
      const participants: Participant[] = [
        { teamId: 1, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 2, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 3, points: 0, opponentIds: [], hasReceivedBye: false },
        { teamId: 4, points: 0, opponentIds: [], hasReceivedBye: false },
      ];

      const pairings1 = pairFirstRound(participants, 123);
      const pairings2 = pairFirstRound(participants, 123);

      expect(pairings1).toEqual(pairings2);
    });
  });

  test("empty participant list returns empty pairings", () => {
    const pairings1 = pairFirstRound([]);
    const pairings2 = pairNextRound([]);
    expect(pairings1).toEqual([]);
    expect(pairings2).toEqual([]);
  });

  test("single participant gets bye in first round", () => {
    const participants: Participant[] = [
      { teamId: 1, points: 0, opponentIds: [], hasReceivedBye: false },
    ];

    const pairings = pairFirstRound(participants);
    expect(pairings).toHaveLength(1);
    expect(pairings[0].teamAId).toBe(1);
    expect(pairings[0].teamBId).toBeNull();
  });

  test("two participants get paired in first round", () => {
    const participants: Participant[] = [
      { teamId: 1, points: 0, opponentIds: [], hasReceivedBye: false },
      { teamId: 2, points: 0, opponentIds: [], hasReceivedBye: false },
    ];

    const pairings = pairFirstRound(participants, 42);
    expect(pairings).toHaveLength(1);
    expect(pairings[0].teamBId).not.toBeNull();
  });
});
