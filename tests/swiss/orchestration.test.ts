import { describe, it, expect } from "@jest/globals";
import { computeRecommendedRounds } from "@/lib/shared/swiss";
import { pairFirstRound, pairNextRound } from "@/lib/shared/swiss-pairing";
import type { Participant } from "@/lib/shared/swiss-pairing";

describe("Swiss Tournament Orchestration", () => {
  it("computes 4 rounds for 8 teams", () => {
    const rounds = computeRecommendedRounds(8);
    expect(rounds).toBe(4);
  });

  it("computes 4 rounds for 7 teams", () => {
    const rounds = computeRecommendedRounds(7);
    expect(rounds).toBe(4);
  });

  it("generates first round pairings for 8 teams (no byes)", () => {
    const participants: Participant[] = Array.from({ length: 8 }, (_, i) => ({
      teamId: i + 1,
      points: 0,
      opponentIds: [],
      hasReceivedBye: false,
    }));

    const pairings = pairFirstRound(participants);

    // 8 teams should result in 4 matches
    expect(pairings.length).toBe(4);
    // No byes
    expect(pairings.every((p) => p.teamBId !== null)).toBe(true);
  });

  it("generates first round pairings for 7 teams (with bye)", () => {
    const participants: Participant[] = Array.from({ length: 7 }, (_, i) => ({
      teamId: i + 1,
      points: 0,
      opponentIds: [],
      hasReceivedBye: false,
    }));

    const pairings = pairFirstRound(participants);

    // 7 teams should result in 4 pairings (3 matches + 1 bye)
    expect(pairings.length).toBe(4);
    // Exactly one bye
    const byeCount = pairings.filter((p) => p.teamBId === null).length;
    expect(byeCount).toBe(1);
  });

  it("generates next round pairings avoiding rematches", () => {
    const participants: Participant[] = [
      { teamId: 1, points: 3, opponentIds: [2], hasReceivedBye: false },
      { teamId: 2, points: 0, opponentIds: [1], hasReceivedBye: false },
      { teamId: 3, points: 3, opponentIds: [4], hasReceivedBye: false },
      { teamId: 4, points: 0, opponentIds: [3], hasReceivedBye: false },
    ];

    const pairings = pairNextRound(participants);

    // Should avoid rematches
    expect(pairings.length).toBe(2);
    // Team 1 (highest points) should not play team 2 (already played)
    const team1Pairing = pairings.find((p) => p.teamAId === 1);
    expect(team1Pairing?.teamBId).not.toBe(2);
    expect(team1Pairing?.teamBId).toBe(3);
  });

  it("awards bye to lowest-ranked team without bye", () => {
    const participants: Participant[] = [
      { teamId: 1, points: 6, opponentIds: [2, 3], hasReceivedBye: true },
      { teamId: 2, points: 3, opponentIds: [1, 3], hasReceivedBye: false },
      { teamId: 3, points: 3, opponentIds: [1, 2], hasReceivedBye: false },
      { teamId: 4, points: 0, opponentIds: [], hasReceivedBye: false },
      { teamId: 5, points: 0, opponentIds: [], hasReceivedBye: false },
    ];

    const pairings = pairNextRound(participants);

    // With 5 teams (odd), one should get bye
    const byePairing = pairings.find((p) => p.teamBId === null);
    expect(byePairing).toBeDefined();
    // Team 5 (lowest without bye) should get bye
    expect(byePairing?.teamAId).toBe(5);
  });

  it("Swiss tournament with no rematches when possible", () => {
    const participants: Participant[] = [
      { teamId: 1, points: 6, opponentIds: [2], hasReceivedBye: false },
      { teamId: 2, points: 3, opponentIds: [1], hasReceivedBye: false },
      { teamId: 3, points: 3, opponentIds: [4], hasReceivedBye: false },
      { teamId: 4, points: 0, opponentIds: [3], hasReceivedBye: false },
    ];

    const pairings = pairNextRound(participants);

    expect(pairings.length).toBe(2);
    // Verify no rematches
    for (const pairing of pairings) {
      if (pairing.teamBId !== null) {
        const teamA = participants.find((p) => p.teamId === pairing.teamAId);
        const teamB = participants.find((p) => p.teamId === pairing.teamBId);
        const hasPlayedBefore =
          teamA && teamB && teamA.opponentIds.includes(teamB.teamId);
        expect(hasPlayedBefore).toBe(false);
      }
    }
  });
});
