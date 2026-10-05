import { describe, expect, it } from "@jest/globals";
import {
  canOpenPlayerScoreDialog,
  pendingReportNotice,
  playerReportInitialScores,
  playerReportView,
  playerScoreButtonLabel,
  sameReportedScore,
  toReporterScores,
} from "@/lib/shared/player-score-report";
import type { MatchScoreReport } from "@/lib/shared/types";
import { bracketMatch } from "../../helpers/bracket-match";

const report = (team1Score: number, team2Score: number): MatchScoreReport => ({
  team1Score,
  team2Score,
  reportedAt: "2026-09-28T20:00:00.000Z",
  maps: [],
});

const base = bracketMatch({
  status: "READY",
  team1Id: 10,
  team2Id: 20,
  team1Name: "Alpha",
  team2Name: "Bravo",
});

describe("playerReportView", () => {
  it("rend null à un spectateur ou à un lecteur sans engagé", () => {
    expect(playerReportView(base, null)).toBeNull();
    expect(playerReportView(base, 99)).toBeNull();
  });

  it("NONE tant que personne n'a proposé", () => {
    expect(playerReportView(base, 10)).toEqual({ phase: "NONE", mine: null, theirs: null });
  });

  it("MINE_PENDING pour qui a proposé, THEIRS_PENDING pour son adversaire", () => {
    const match = { ...base, team1Report: report(2, 1), status: "AWAITING_CONFIRMATION" as const };
    expect(playerReportView(match, 10)).toMatchObject({ phase: "MINE_PENDING", theirs: null });
    expect(playerReportView(match, 20)).toMatchObject({ phase: "THEIRS_PENDING", mine: null });
  });

  it("vu de l'équipe 2, sa proposition est la sienne", () => {
    const match = { ...base, team2Report: report(0, 2) };
    const view = playerReportView(match, 20)!;
    expect(view.mine).toEqual(report(0, 2));
    expect(view.theirs).toBeNull();
  });

  it("CONFLICT quand les deux propositions se contredisent", () => {
    const match = { ...base, team1Report: report(2, 0), team2Report: report(1, 2) };
    expect(playerReportView(match, 10)?.phase).toBe("CONFLICT");
    expect(playerReportView(match, 20)?.phase).toBe("CONFLICT");
  });

  it("deux propositions concordantes ne sont pas un conflit (course avec la clôture)", () => {
    const match = { ...base, team1Report: report(2, 1), team2Report: report(2, 1) };
    expect(playerReportView(match, 10)?.phase).toBe("MINE_PENDING");
  });
});

describe("playerReportInitialScores", () => {
  it("champs vides sans proposition — jamais un 0 – 0 inventé", () => {
    expect(playerReportInitialScores(null)).toEqual({ score1: "", score2: "" });
    expect(playerReportInitialScores(playerReportView(base, 10))).toEqual({ score1: "", score2: "" });
  });

  it("reprend sa propre proposition en priorité, sinon celle de l'adversaire", () => {
    const both = { ...base, team1Report: report(2, 0), team2Report: report(1, 2) };
    expect(playerReportInitialScores(playerReportView(both, 10))).toEqual({ score1: "2", score2: "0" });
    expect(playerReportInitialScores(playerReportView(both, 20))).toEqual({ score1: "1", score2: "2" });

    const theirs = { ...base, team1Report: report(2, 1) };
    expect(playerReportInitialScores(playerReportView(theirs, 20))).toEqual({ score1: "2", score2: "1" });
  });
});

describe("toReporterScores", () => {
  it("parle depuis l'engagé, quel que soit son côté", () => {
    expect(toReporterScores(true, 2, 1)).toEqual({ myScore: 2, opponentScore: 1 });
    expect(toReporterScores(false, 2, 1)).toEqual({ myScore: 1, opponentScore: 2 });
  });
});

describe("sameReportedScore", () => {
  it("compare les deux scores, pas l'horodatage", () => {
    expect(sameReportedScore(report(2, 1), { team1Score: 2, team2Score: 1 })).toBe(true);
    expect(sameReportedScore(report(2, 1), report(1, 2))).toBe(false);
  });
});

describe("canOpenPlayerScoreDialog", () => {
  const input = {
    match: base,
    myTeamId: 10,
    canReportScore: true,
    canActForEntrant: false,
    frozen: false,
  };

  it("s'ouvre sur le match du lecteur une fois lancé", () => {
    expect(canOpenPlayerScoreDialog(input)).toBe(true);
  });

  it("s'ouvre avant le lancement pour qui peut déclarer forfait, et seulement lui", () => {
    expect(canOpenPlayerScoreDialog({ ...input, canReportScore: false })).toBe(false);
    expect(
      canOpenPlayerScoreDialog({ ...input, canReportScore: false, canActForEntrant: true }),
    ).toBe(true);
  });

  it("reste fermé hors de son match, sur une case vide, sur un match joué ou un plateau figé", () => {
    expect(canOpenPlayerScoreDialog({ ...input, myTeamId: 99 })).toBe(false);
    expect(canOpenPlayerScoreDialog({ ...input, myTeamId: null })).toBe(false);
    expect(canOpenPlayerScoreDialog({ ...input, match: { ...base, team2Id: null } })).toBe(false);
    expect(canOpenPlayerScoreDialog({ ...input, match: { ...base, status: "COMPLETED" } })).toBe(false);
    expect(canOpenPlayerScoreDialog({ ...input, frozen: true })).toBe(false);
  });

  it("reste ouvert pendant l'attente de confirmation", () => {
    expect(
      canOpenPlayerScoreDialog({ ...input, match: { ...base, status: "AWAITING_CONFIRMATION" } }),
    ).toBe(true);
  });
});

describe("playerScoreButtonLabel", () => {
  it("annonce le geste attendu du lecteur", () => {
    expect(playerScoreButtonLabel(playerReportView(base, 10), true)).toBe("Saisir le score");
    const pending = { ...base, team1Report: report(2, 1) };
    expect(playerScoreButtonLabel(playerReportView(pending, 10), true)).toBe("Modifier mon score");
    expect(playerScoreButtonLabel(playerReportView(pending, 20), true)).toBe("Confirmer le score");
    const conflict = { ...pending, team2Report: report(0, 2) };
    expect(playerScoreButtonLabel(playerReportView(conflict, 10), true)).toBe("Revoir le score");
  });

  it("n'offre que le forfait tant que le match n'est pas lancé", () => {
    expect(playerScoreButtonLabel(playerReportView(base, 10), false)).toBe("Déclarer forfait");
  });
});

describe("pendingReportNotice", () => {
  it("se tait sans proposition, et sur un match joué", () => {
    expect(pendingReportNotice(base)).toBeNull();
    expect(
      pendingReportNotice({ ...base, status: "COMPLETED", team1Report: report(2, 1) }),
    ).toBeNull();
  });

  it("nomme le score et l'équipe qui l'a proposé", () => {
    expect(pendingReportNotice({ ...base, team2Report: report(0, 2) })).toBe(
      "0 – 2 proposé par Bravo · à confirmer",
    );
  });

  it("retombe sur « Équipe N » sans nom", () => {
    expect(pendingReportNotice({ ...base, team1Name: null, team1Report: report(2, 1) })).toBe(
      "2 – 1 proposé par Équipe 1 · à confirmer",
    );
  });

  it("annonce un désaccord sans prendre parti", () => {
    expect(
      pendingReportNotice({ ...base, team1Report: report(2, 0), team2Report: report(0, 2) }),
    ).toBe("Scores contradictoires · arbitrage alerté");
  });
});
