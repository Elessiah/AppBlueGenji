import { describe, expect, it } from "@jest/globals";

import { matchSideViews } from "@/app/(secured)/tournois/[id]/_lib/match-row-sides";

const base = {
  team1Id: 1,
  team2Id: 2,
  team1Score: null,
  team2Score: null,
  winnerTeamId: null,
  forfeitTeamId: null,
} as const;

describe("matchSideViews", () => {
  it("match à venir : pas de vainqueur, scores en tiret", () => {
    const [a, b] = matchSideViews(base, 2, false);
    expect(a).toEqual({ win: false, forfeits: false, score: "-", emptyLabel: "TBD" });
    expect(b).toEqual({ win: false, forfeits: false, score: "-", emptyLabel: "TBD" });
  });

  it("vainqueur et scores posés", () => {
    const [a, b] = matchSideViews({ ...base, team1Score: 3, team2Score: 1, winnerTeamId: 1 }, 1, false);
    expect(a).toMatchObject({ win: true, score: 3 });
    expect(b).toMatchObject({ win: false, score: 1 });
  });

  it("forfait nominatif : FF du seul côté forfait", () => {
    const [a, b] = matchSideViews({ ...base, team1Score: 0, team2Score: 3, forfeitTeamId: 1 }, 1, false);
    expect(a).toMatchObject({ forfeits: true, score: "FF" });
    expect(b).toMatchObject({ forfeits: false, score: 3 });
  });

  it("double forfait : FF des deux côtés", () => {
    const [a, b] = matchSideViews(base, 1, true);
    expect(a.score).toBe("FF");
    expect(b.score).toBe("FF");
  });

  it("exemption : jamais de forfait, BYE au premier tour seulement", () => {
    const bye = { ...base, team2Id: null, winnerTeamId: 1, forfeitTeamId: null };
    const [a, b] = matchSideViews(bye, 1, true);
    expect(a).toMatchObject({ win: true, forfeits: false, emptyLabel: "TBD" });
    expect(b).toMatchObject({ forfeits: false, emptyLabel: "BYE" });
    expect(matchSideViews(bye, 2, false)[1].emptyLabel).toBe("TBD");
  });

  it("deux cases vides : TBD des deux côtés", () => {
    const [a, b] = matchSideViews({ ...base, team1Id: null, team2Id: null }, 1, false);
    expect(a.emptyLabel).toBe("TBD");
    expect(b.emptyLabel).toBe("TBD");
  });

  it("matchSideViews_playoffRoundOneSideEmpty_labelsBye", () => {
    const bye = { ...base, team2Id: null, winnerTeamId: 1 };
    expect(matchSideViews(bye, 1001, false)[1].emptyLabel).toBe("BYE");
    expect(matchSideViews(bye, 1001, false)[0].emptyLabel).toBe("TBD");
  });

  it("matchSideViews_playoffRoundBothEmpty_labelsTbd", () => {
    const [a, b] = matchSideViews({ ...base, team1Id: null, team2Id: null }, 1001, false);
    expect(a.emptyLabel).toBe("TBD");
    expect(b.emptyLabel).toBe("TBD");
  });

  it("matchSideViews_qualificationRoundTwoEmptySide_labelsTbd", () => {
    expect(matchSideViews({ ...base, team2Id: null }, 2, false)[1].emptyLabel).toBe("TBD");
  });
});

describe("matchSideViews — match sur une seule carte", () => {
  it("matchSideViews_displayScore_showsTheMapScore", () => {
    const match = { ...base, team1Score: 1, team2Score: 0, winnerTeamId: 1, displayScore: { team1: 5, team2: 3 } };

    const [a, b] = matchSideViews(match, 1, false);

    expect(a).toMatchObject({ win: true, score: 5 });
    expect(b).toMatchObject({ win: false, score: 3 });
  });

  it("matchSideViews_noDisplayScore_keepsTheMatchScore", () => {
    const [a, b] = matchSideViews({ ...base, team1Score: 1, team2Score: 0, winnerTeamId: 1, displayScore: null }, 1, false);

    expect(a.score).toBe(1);
    expect(b.score).toBe(0);
  });

  it("matchSideViews_displayScoreOnForfeit_keepsFf", () => {
    const match = { ...base, team1Score: 0, team2Score: 1, forfeitTeamId: 1, displayScore: { team1: 5, team2: 3 } };

    expect(matchSideViews(match, 1, false)[0].score).toBe("FF");
  });
});
