import { describe, expect, it } from "@jest/globals";
import {
  PROJECTED_BYE,
  planNextPlayoffRound,
  projectPlayoffGhostEntrants,
  type ProjectablePlayoffMatch,
  type ProjectedSide,
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
const doubleForfeit = (n: number, round = 1) => match(n, round, { status: "COMPLETED", doubleForfeit: true });
const ghosts = (round: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: -(round * 100 + i + 1), roundNumber: round, matchNumber: i + 1 }));

/** Identifiant d'un côté projeté, tel que le moteur l'écrit : `null` pour une exemption comme pour un inconnu. */
const sideTeamId = (side: ProjectedSide): number | null =>
  side === null || side === PROJECTED_BYE ? null : side.teamId;

describe("projectPlayoffGhostEntrants", () => {
  it("places the winner of a completed quarter in its semi slot, top side for odd order", () => {
    const result = projectPlayoffGhostEntrants(
      [done(1), match(2, 1), match(3, 1), match(4, 1)],
      [...ghosts(2, 2), ...ghosts(3, 1)],
    );
    expect(result.get(-201)).toEqual([{ teamId: 10, name: "T10" }, null]);
    expect(result.size).toBe(1);
  });

  it("keeps the second match of a pair on the bottom while the first is still open", () => {
    const result = projectPlayoffGhostEntrants([match(1, 1), done(2)], ghosts(2, 1));
    expect(result.get(-201)).toEqual([null, { teamId: 20, name: "T20" }]);
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

  it("moves the survivor to the top with a bye when the first match of the pair is a double forfeit", () => {
    const result = projectPlayoffGhostEntrants([doubleForfeit(1), done(2)], ghosts(2, 1));
    expect(result.get(-201)).toEqual([{ teamId: 20, name: "T20" }, PROJECTED_BYE]);
  });

  it("gives the first winner a bye when the second match of the pair is a double forfeit", () => {
    const result = projectPlayoffGhostEntrants([done(1), doubleForfeit(2)], ghosts(2, 1));
    expect(result.get(-201)).toEqual([{ teamId: 10, name: "T10" }, PROJECTED_BYE]);
  });

  it("announces the bye as soon as one side is vacated, even with the neighbour still open", () => {
    const result = projectPlayoffGhostEntrants([doubleForfeit(1), match(2, 1)], ghosts(2, 1));
    expect(result.get(-201)).toEqual([null, PROJECTED_BYE]);
  });

  it("ignores a double-forfeit flag on a match that is not closed", () => {
    const result = projectPlayoffGhostEntrants([match(1, 1, { doubleForfeit: true }), done(2)], ghosts(2, 1));
    expect(result.get(-201)).toEqual([null, { teamId: 20, name: "T20" }]);
  });

  it("gives the last winner of an odd round a bye", () => {
    const result = projectPlayoffGhostEntrants([done(1), done(2), done(3)], ghosts(2, 2));
    expect(result.get(-202)).toEqual([{ teamId: 30, name: "T30" }, PROJECTED_BYE]);
  });

  it("announces the bye of an odd round before its last match is played", () => {
    const result = projectPlayoffGhostEntrants([done(1), done(2), match(3, 1)], ghosts(2, 2));
    expect(result.get(-202)).toEqual([null, PROJECTED_BYE]);
  });

  it("shifts the following pairs up when both matches of a pair are double forfeits", () => {
    const result = projectPlayoffGhostEntrants(
      [doubleForfeit(1), doubleForfeit(2), done(3), match(4, 1)],
      ghosts(2, 2),
    );
    expect(result.get(-201)).toEqual([{ teamId: 30, name: "T30" }, null]);
    expect(result.has(-202)).toBe(false);
  });

  it("leaves the name unknown when the winner is neither side of the match", () => {
    const result = projectPlayoffGhostEntrants(
      [match(1, 1, { status: "COMPLETED", winnerTeamId: 999 }), match(2, 1)],
      ghosts(2, 1),
    );
    expect(result.get(-201)).toEqual([{ teamId: 999, name: null }, null]);
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

  // La projection n'a de valeur que si elle annonce ce que le moteur posera :
  // chaque forme de tour complet est comparée au plan du moteur, pas à une
  // attente écrite à la main.
  it.each<[string, ProjectablePlayoffMatch[]]>([
    ["four clean wins", [done(1), done(2, 1, 2), done(3), done(4, 1, 2)]],
    ["a double forfeit first in its pair", [doubleForfeit(1), done(2), done(3), done(4)]],
    ["a double forfeit second in its pair", [done(1), done(2), done(3), doubleForfeit(4)]],
    ["an odd count", [done(1), done(2), done(3)]],
    ["a pair emptied by two double forfeits", [doubleForfeit(1), doubleForfeit(2), done(3), done(4)]],
    ["an odd count ending on a double forfeit", [done(1), done(2), doubleForfeit(3)]],
  ])("agrees with the engine pairing once the round is complete: %s", (_label, matches) => {
    const slots = ghosts(2, Math.ceil(matches.length / 2));
    const projected = projectPlayoffGhostEntrants(matches, slots);
    const plan = planNextPlayoffRound(
      matches.map((m) => ({ winnerTeamId: m.winnerTeamId, loserTeamId: null, doubleForfeit: m.doubleForfeit })),
    ).filter((entry) => entry.bracket === "UPPER");

    const shown = slots
      .filter((slot) => projected.has(slot.id))
      .map((slot) => projected.get(slot.id)!.map(sideTeamId));
    expect(shown).toEqual(plan.map((entry) => [entry.pairing.teamAId, entry.pairing.teamBId]));
  });
});
