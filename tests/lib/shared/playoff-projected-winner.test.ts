import { describe, expect, it } from "@jest/globals";
import {
  planNextPlayoffRound,
  projectPlayoffGhostEntrants,
  type ProjectablePlayoffMatch,
} from "@/lib/shared/bg-survie/playoffs";

function match(n: number, round: number, over: Partial<ProjectablePlayoffMatch> = {}): ProjectablePlayoffMatch {
  return {
    roundNumber: round,
    matchNumber: n,
    status: "PENDING",
    winnerTeamId: null,
    team1Id: n * 10,
    team2Id: n * 10 + 1,
    team1Name: `T${n * 10}`,
    team2Name: `T${n * 10 + 1}`,
    ...over,
  };
}
const done = (n: number, round = 1, side: 1 | 2 = 1) =>
  match(n, round, { status: "COMPLETED", winnerTeamId: side === 1 ? n * 10 : n * 10 + 1 });
const ghosts = (round: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: -(round * 100 + i + 1), roundNumber: round, matchNumber: i + 1 }));

describe("projectPlayoffGhostEntrants", () => {
  it("places the winner of a completed quarter in its semi slot, top side for odd order", () => {
    const result = projectPlayoffGhostEntrants(
      [done(1), match(2, 1), match(3, 1), match(4, 1)],
      [...ghosts(2, 2), ...ghosts(3, 1)],
    );
    expect(result.get(-201)).toEqual([{ teamId: 10, name: "T10" }, null]);
    expect(result.size).toBe(1);
  });

  it("fills bottom side with the second feeding match and the right slot", () => {
    const result = projectPlayoffGhostEntrants(
      [done(1), done(2, 1, 2), done(3), done(4, 1, 2)],
      [...ghosts(2, 2), ...ghosts(3, 1)],
    );
    expect(result.get(-201)).toEqual([{ teamId: 10, name: "T10" }, { teamId: 21, name: "T21" }]);
    expect(result.get(-202)).toEqual([{ teamId: 30, name: "T30" }, { teamId: 41, name: "T41" }]);
    expect(result.has(-301)).toBe(false);
  });

  it("ignores matches that are not COMPLETED, even with a winner id", () => {
    const result = projectPlayoffGhostEntrants(
      [match(1, 1, { status: "AWAITING_CONFIRMATION", winnerTeamId: 10 }), match(2, 1)],
      ghosts(2, 1),
    );
    expect(result.size).toBe(0);
  });

  it("feeds nobody from a double forfeit", () => {
    const result = projectPlayoffGhostEntrants(
      [match(1, 1, { status: "COMPLETED", doubleForfeit: true }), done(2)],
      ghosts(2, 1),
    );
    expect(result.get(-201)).toEqual([null, { teamId: 20, name: "T20" }]);
  });

  it("handles an odd count: the last winner takes the top of the last slot", () => {
    const result = projectPlayoffGhostEntrants([done(1), done(2), done(3)], ghosts(2, 2));
    expect(result.get(-202)).toEqual([{ teamId: 30, name: "T30" }, null]);
  });

  it("builds the final from completed semis only for the last placed round", () => {
    const result = projectPlayoffGhostEntrants(
      [done(1), done(2), done(3), done(4), done(1, 2, 2), match(2, 2)],
      ghosts(3, 1),
    );
    expect(result.get(-301)).toEqual([{ teamId: 11, name: "T11" }, null]);
  });

  it("returns nothing without ghosts or matches, and no ghost beyond the next round", () => {
    expect(projectPlayoffGhostEntrants([done(1), done(2)], []).size).toBe(0);
    expect(projectPlayoffGhostEntrants([], ghosts(2, 1)).size).toBe(0);
    expect(projectPlayoffGhostEntrants([done(1), done(2)], ghosts(3, 1)).size).toBe(0);
  });

  it("agrees with the engine pairing once the round is complete", () => {
    const matches = [done(1), done(2, 1, 2), done(3), done(4, 1, 2)];
    const projected = projectPlayoffGhostEntrants(matches, ghosts(2, 2));
    const plan = planNextPlayoffRound(
      matches.map((m) => ({ winnerTeamId: m.winnerTeamId, loserTeamId: null })),
    );
    plan.forEach((entry, index) => {
      const sides = projected.get(-(200 + index + 1))!;
      expect([sides[0]?.teamId, sides[1]?.teamId]).toEqual([entry.pairing.teamAId, entry.pairing.teamBId]);
    });
  });
});
