import { describe, expect, it } from "@jest/globals";
import {
  decideScoreForm,
  isUntouched,
  pendingProposalSignature,
  pendingScoreProposal,
  scoreFormStateFor,
  storedResultSignature,
} from "@/app/(secured)/tournois/[id]/_lib/score-form";
import type { BracketMatch, MatchScoreReport } from "@/lib/shared/types";
import type { MatchFormat } from "@/lib/shared/match-format";
import { bracketMatch } from "../helpers/bracket-match";

const BO3: MatchFormat = { type: "BO", value: 3 };

function report(team1Score: number, team2Score: number): MatchScoreReport {
  return { team1Score, team2Score, reportedAt: "2026-09-28T18:00:00.000Z" };
}

function match(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return bracketMatch({
    status: "AWAITING_CONFIRMATION",
    team1Id: 10,
    team2Id: 20,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    doubleForfeit: false,
    team1Report: null,
    team2Report: null,
    ...overrides,
  });
}

describe("pendingScoreProposal — proposition seule en attente", () => {
  it("rend la proposition de l'équipe 1 (adversaire fantôme qui ne confirmera jamais)", () => {
    expect(pendingScoreProposal(match({ team1Report: report(2, 1) }))).toEqual({
      team1Score: 2,
      team2Score: 1,
      proposedBy: "team1",
    });
  });

  it("rend la proposition de l'équipe 2, dans l'orientation du plateau", () => {
    expect(pendingScoreProposal(match({ team2Report: report(0, 2) }))).toEqual({
      team1Score: 0,
      team2Score: 2,
      proposedBy: "team2",
    });
  });

  it("ne rend rien sans proposition, ni sans match", () => {
    expect(pendingScoreProposal(match())).toBeNull();
    expect(pendingScoreProposal(null)).toBeNull();
  });

  it("ne tranche pas un désaccord : deux propositions → rien", () => {
    expect(
      pendingScoreProposal(match({ team1Report: report(2, 1), team2Report: report(1, 2) })),
    ).toBeNull();
  });

  it("s'efface devant ce qui est en base", () => {
    const withReport = { team1Report: report(2, 1) };
    expect(pendingScoreProposal(match({ ...withReport, team1Score: 1, team2Score: 0 }))).toBeNull();
    expect(pendingScoreProposal(match({ ...withReport, forfeitTeamId: 20 }))).toBeNull();
    expect(pendingScoreProposal(match({ ...withReport, doubleForfeit: true }))).toBeNull();
    expect(
      pendingScoreProposal(
        match({ ...withReport, status: "COMPLETED", team1Score: 2, team2Score: 1, winnerTeamId: 10 }),
      ),
    ).toBeNull();
  });
});

describe("scoreFormStateFor — ouverture sur la proposition", () => {
  it("pré-remplit les champs avec le score proposé", () => {
    const state = scoreFormStateFor(match({ team1Report: report(2, 1) }));
    expect(state.score1).toBe("2");
    expect(state.score2).toBe("1");
    expect(state.forfeitTeamId).toBeUndefined();
  });

  it("permet de valider directement, sans ressaisie", () => {
    const opened = match({ team1Report: report(2, 1) });
    const decision = decideScoreForm(scoreFormStateFor(opened), { format: BO3, decided: false });
    expect(decision.canResolve).toBe(true);
    expect(decision.scores).toEqual({ team1: 2, team2: 1 });
  });

  it("considère le formulaire pré-rempli comme intact", () => {
    const opened = match({ team2Report: report(1, 2) });
    expect(isUntouched(scoreFormStateFor(opened), opened)).toBe(true);
  });

  it("reste vide en cas de désaccord", () => {
    const state = scoreFormStateFor(match({ team1Report: report(2, 1), team2Report: report(1, 2) }));
    expect(state.score1).toBe("");
    expect(state.score2).toBe("");
  });
});

describe("signatures — proposition et résultat enregistré sont distincts", () => {
  it("une proposition change la signature des propositions, pas celle du résultat", () => {
    const before = match();
    const after = match({ team1Report: report(2, 0) });
    expect(storedResultSignature(after)).toBe(storedResultSignature(before));
    expect(pendingProposalSignature(after)).not.toBe(pendingProposalSignature(before));
  });

  it("suit un changement de score proposé", () => {
    expect(pendingProposalSignature(match({ team1Report: report(2, 0) }))).not.toBe(
      pendingProposalSignature(match({ team1Report: report(2, 1) })),
    );
  });
});
