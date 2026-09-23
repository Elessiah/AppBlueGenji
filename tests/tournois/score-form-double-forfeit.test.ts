import { describe, expect, it } from "@jest/globals";
import {
  decideScoreForm,
  isUntouched,
  scoreBlockerMessage,
  scoreFormStateFor,
  storedResultSignature,
} from "@/app/(secured)/tournois/[id]/_lib/score-form";
import { mapError } from "@/app/(secured)/tournois/[id]/_lib/error-map";
import { formatMatchResultLog } from "@/lib/shared/bot-logs";
import type { BracketMatch } from "@/lib/shared/types";

function match(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 7,
    roundNumber: 1,
    status: "READY",
    team1Id: 10,
    team2Id: 20,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    doubleForfeit: false,
    ...overrides,
  } as unknown as BracketMatch;
}

describe("formulaire d'arbitrage — double forfait", () => {
  it("se valide sans score, et ne s'enregistre pas comme un avancement", () => {
    const decision = decideScoreForm(
      { score1: "", score2: "", doubleForfeit: true },
      { format: null, decided: false },
    );
    expect(decision).toMatchObject({
      scores: null,
      canResolve: true,
      canSave: false,
      saveBlocker: "DOUBLE_FORFEIT",
      resolveBlocker: null,
    });
    expect(scoreBlockerMessage("DOUBLE_FORFEIT", null)).toContain("Valider le résultat");
  });

  it("rouvre le dialogue sur le double forfait enregistré", () => {
    const stored = match({ status: "COMPLETED", doubleForfeit: true });
    expect(scoreFormStateFor(stored)).toEqual({
      score1: "",
      score2: "",
      forfeitTeamId: undefined,
      doubleForfeit: true,
    });
    expect(isUntouched({ score1: "", score2: "", doubleForfeit: true }, stored)).toBe(true);
    expect(isUntouched({ score1: "", score2: "" }, stored)).toBe(false);
  });

  it("n'est pas une saisie sur un match vierge tant qu'il n'est pas coché", () => {
    expect(isUntouched({ score1: "", score2: "", doubleForfeit: undefined }, match())).toBe(true);
    expect(isUntouched({ score1: "", score2: "", doubleForfeit: true }, match())).toBe(false);
  });

  it("change l'empreinte du résultat enregistré (flux SSE)", () => {
    const before = storedResultSignature(match({ status: "COMPLETED" }));
    const after = storedResultSignature(match({ status: "COMPLETED", doubleForfeit: true }));
    expect(before).not.toBe(after);
  });

  it("nomme les refus du serveur en français", () => {
    expect(mapError("DOUBLE_FORFEIT_EXCLUSIVE")).toMatch(/double forfait/i);
    expect(mapError("DOUBLE_FORFEIT_RESOLVE_ONLY")).toMatch(/Valider le résultat/);
  });
});

describe("journal Discord — double forfait", () => {
  it("dit le double forfait plutôt qu'un résultat manquant", () => {
    const line = formatMatchResultLog({
      tournament: { id: 3, name: "Coupe" },
      bracket: "UPPER",
      roundNumber: 2,
      team1: { name: "Alpha", participantType: "TEAM" },
      team2: { name: "Bravo", participantType: "TEAM" },
      team1Score: null,
      team2Score: null,
      doubleForfeit: true,
    });
    expect(line).toContain("Alpha vs Bravo");
    expect(line).toContain("double forfait");
    expect(line).not.toContain("0–0");
  });
});
