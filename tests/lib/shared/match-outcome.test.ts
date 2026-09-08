import { describe, expect, it } from "@jest/globals";
import { isMatchDrawn, isMatchPlayed, type MatchOutcomeShape } from "@/lib/shared/match-outcome";
import { playedMatchSql } from "@/lib/shared/ranking";

function match(overrides: Partial<MatchOutcomeShape> = {}): MatchOutcomeShape {
  return {
    status: "READY",
    winnerTeamId: null,
    forfeitTeamId: null,
    team1Id: 10,
    team2Id: 20,
    ...overrides,
  };
}

describe("isMatchPlayed", () => {
  it("se lit sur le statut, pas sur la présence d'un vainqueur", () => {
    // Le point du module : un match nul n'a pas de vainqueur et est pourtant
    // terminé. `winnerTeamId !== null` disait « pas encore joué » d'un 2-2, ce
    // qui faisait annoncer « 5/6 jouées » à une manche complète.
    expect(isMatchPlayed(match({ status: "COMPLETED", winnerTeamId: null }))).toBe(true);
    expect(isMatchPlayed(match({ status: "COMPLETED", winnerTeamId: 10 }))).toBe(true);
  });

  it("dit non de tout ce qui n'est pas terminé", () => {
    for (const status of ["PENDING", "READY", "AWAITING_CONFIRMATION"] as const) {
      expect(isMatchPlayed(match({ status }))).toBe(false);
    }
  });
});

describe("isMatchDrawn", () => {
  it("reconnaît une rencontre close sans vainqueur", () => {
    expect(isMatchDrawn(match({ status: "COMPLETED" }))).toBe(true);
  });

  it("écarte une rencontre gagnée", () => {
    expect(isMatchDrawn(match({ status: "COMPLETED", winnerTeamId: 10 }))).toBe(false);
  });

  it("écarte un forfait, qui désigne bien un vainqueur", () => {
    expect(isMatchDrawn(match({ status: "COMPLETED", forfeitTeamId: 20 }))).toBe(false);
  });

  it("écarte un score noté pendant que la rencontre se joue", () => {
    // L'arbitrage peut enregistrer un 1-1 sans trancher : ce n'est pas un nul,
    // c'est un match en cours.
    expect(isMatchDrawn(match({ status: "AWAITING_CONFIRMATION" }))).toBe(false);
    expect(isMatchDrawn(match({ status: "READY" }))).toBe(false);
  });

  it("écarte byes et matchs fantômes, dont le score est posé par le moteur", () => {
    expect(isMatchDrawn(match({ status: "COMPLETED", team2Id: null }))).toBe(false);
    expect(isMatchDrawn(match({ status: "COMPLETED", team1Id: null, team2Id: null }))).toBe(false);
  });
});

describe("le nul du rejeu et celui du classement disent la même chose", () => {
  it("exige les mêmes traits que `playedMatchSql`", () => {
    // Le SQL du classement reconnaît un nul à : clos, sans vainqueur, et deux
    // scores non nuls **égaux**. `isMatchDrawn` doit s'aligner — sinon la même
    // rencontre est jouée sur la page du tournoi et inexistante sur les fiches.
    const sql = playedMatchSql();

    expect(sql).toContain("m.team1_score = m.team2_score");
    expect(sql).toContain("m.team1_score IS NOT NULL");
    expect(sql).toContain("m.team2_score IS NOT NULL");
  });
});
