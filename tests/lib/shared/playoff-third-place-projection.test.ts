import { describe, expect, it } from "@jest/globals";
import {
  PROJECTED_BYE,
  planNextPlayoffRound,
  projectThirdPlaceEntrants,
  type ProjectablePlayoffMatch,
} from "@/lib/shared/bg-survie/playoffs";

/** Demi-finale `n` : équipes `n0` (haut) et `n1` (bas). */
function semi(n: number, over: Partial<ProjectablePlayoffMatch> = {}): ProjectablePlayoffMatch {
  return {
    roundNumber: 1001,
    matchNumber: n,
    status: "READY",
    winnerTeamId: null,
    team1Id: n * 10,
    team2Id: n * 10 + 1,
    team1Name: `T${n * 10}`,
    team2Name: `T${n * 10 + 1}`,
    ...over,
  };
}
/** Demi-finale close, gagnée par l'équipe du haut (`side` 1) ou du bas (2). */
const won = (n: number, side: 1 | 2 = 1) =>
  semi(n, { status: "COMPLETED", winnerTeamId: side === 1 ? n * 10 : n * 10 + 1 });
const doubleForfeit = (n: number) => semi(n, { status: "COMPLETED", doubleForfeit: true });

describe("projectThirdPlaceEntrants", () => {
  it("shows an empty card while no semi-final is closed", () => {
    expect(projectThirdPlaceEntrants([semi(1), semi(2)])).toEqual([null, null]);
  });

  it("puts the loser of the first semi-final on top", () => {
    expect(projectThirdPlaceEntrants([won(1), semi(2)])).toEqual([{ teamId: 11, name: "T11" }, null]);
  });

  it("puts the loser of the second semi-final on the bottom", () => {
    expect(projectThirdPlaceEntrants([semi(1), won(2, 2)])).toEqual([null, { teamId: 20, name: "T20" }]);
  });

  it("reads the semi-finals in match-number order, not list order", () => {
    expect(projectThirdPlaceEntrants([won(2), won(1)])).toEqual([
      { teamId: 11, name: "T11" },
      { teamId: 21, name: "T21" },
    ]);
  });

  it("matches the engine's third-place pairing once both semi-finals are closed", () => {
    const plan = planNextPlayoffRound([
      { winnerTeamId: 10, loserTeamId: 11 },
      { winnerTeamId: 21, loserTeamId: 20 },
    ]);
    const thirdPlace = plan.find((entry) => entry.bracket === "THIRD_PLACE")!;

    expect(projectThirdPlaceEntrants([won(1), won(2, 2)])).toEqual([
      { teamId: thirdPlace.pairing.teamAId, name: "T11" },
      { teamId: thirdPlace.pairing.teamBId, name: "T20" },
    ]);
  });

  it("gives the only loser a bye when the other semi-final is a double forfeit, like the engine", () => {
    const plan = planNextPlayoffRound([
      { winnerTeamId: null, loserTeamId: null, doubleForfeit: true },
      { winnerTeamId: 20, loserTeamId: 21 },
    ]);
    const thirdPlace = plan.find((entry) => entry.bracket === "THIRD_PLACE")!;
    expect(thirdPlace.pairing).toEqual({ teamAId: 21, teamBId: null });

    expect(projectThirdPlaceEntrants([doubleForfeit(1), won(2)])).toEqual([
      { teamId: 21, name: "T21" },
      PROJECTED_BYE,
    ]);
  });

  it("announces the bye while the other semi-final is still open", () => {
    expect(projectThirdPlaceEntrants([semi(1), doubleForfeit(2)])).toEqual([null, PROJECTED_BYE]);
  });

  it("plans no third-place match after two double forfeits", () => {
    expect(projectThirdPlaceEntrants([doubleForfeit(1), doubleForfeit(2)])).toBeNull();
  });

  it("plans no third-place match when a semi-final is a bye", () => {
    const bye = semi(2, { status: "COMPLETED", team2Id: null, team2Name: null, winnerTeamId: 20 });
    expect(projectThirdPlaceEntrants([won(1), bye])).toBeNull();
  });

  it("plans no third-place match outside a two-match round", () => {
    expect(projectThirdPlaceEntrants([won(1)])).toBeNull();
    expect(projectThirdPlaceEntrants([won(1), won(2), won(3)])).toBeNull();
  });

  it("does not name a loser before the result is confirmed", () => {
    const awaiting = semi(1, { status: "AWAITING_CONFIRMATION", winnerTeamId: 10 });
    expect(projectThirdPlaceEntrants([awaiting, semi(2)])).toEqual([null, null]);
  });

  it("names nobody when the winner is neither side of the semi-final", () => {
    const foreign = semi(1, { status: "COMPLETED", winnerTeamId: 999 });
    expect(projectThirdPlaceEntrants([foreign, semi(2)])).toEqual([null, null]);
  });
});
