import { describe, expect, it } from "@jest/globals";
import { tickerItemText, tickerOutcomes, tickerScores, type TickerMatchOutcomeInput } from "@/lib/shared/ticker-items";

/** Issue des camps d'un résultat du bandeau, lue sur le résultat enregistré (TICKER_RESULTS.md). */
function match(overrides: Partial<TickerMatchOutcomeInput> = {}): TickerMatchOutcomeInput {
  return { team1Id: 1, team2Id: 2, winnerTeamId: 1, forfeitTeamId: null, doubleForfeit: false, ...overrides };
}

describe("tickerOutcomes", () => {
  it("match tranché : vainqueur et perdant, dans l'ordre du match", () => {
    expect(tickerOutcomes(match())).toEqual(["win", "loss"]);
    expect(tickerOutcomes(match({ winnerTeamId: 2 }))).toEqual(["loss", "win"]);
  });

  it("forfait : le camp forfait n'est pas un perdant", () => {
    expect(tickerOutcomes(match({ winnerTeamId: 2, forfeitTeamId: 1 }))).toEqual(["forfeit", "win"]);
  });

  it("forfait sans vainqueur enregistré, ou avec un vainqueur étranger : l'adversaire du forfait l'emporte", () => {
    expect(tickerOutcomes(match({ winnerTeamId: null, forfeitTeamId: 1 }))).toEqual(["forfeit", "win"]);
    expect(tickerOutcomes(match({ winnerTeamId: 9, forfeitTeamId: 2 }))).toEqual(["win", "forfeit"]);
  });

  it("double forfait : deux camps forfaits, même avec un vainqueur résiduel", () => {
    expect(tickerOutcomes(match({ doubleForfeit: true, winnerTeamId: null }))).toEqual(["forfeit", "forfeit"]);
    expect(tickerOutcomes(match({ doubleForfeit: true }))).toEqual(["forfeit", "forfeit"]);
  });

  it("sans vainqueur enregistré : nul, sans deviner d'après les scores", () => {
    expect(tickerOutcomes(match({ winnerTeamId: null }))).toEqual(["none", "none"]);
  });

  it("vainqueur étranger au match ou camp absent : ni faux vainqueur, ni faux perdant", () => {
    expect(tickerOutcomes(match({ winnerTeamId: 9 }))).toEqual(["none", "none"]);
    expect(tickerOutcomes(match({ team2Id: null }))).toEqual(["win", "none"]);
    expect(tickerOutcomes(match({ team1Id: null, team2Id: null, winnerTeamId: null }))).toEqual(["none", "none"]);
  });
});

describe("tickerScores", () => {
  const scored = (overrides: Partial<Parameters<typeof tickerScores>[0]> = {}) =>
    tickerScores({ ...match(), score1: 2, score2: 1, format: { type: "FT", value: 3 }, ...overrides });

  it("match tranché ou nul : les colonnes", () => {
    expect(scored()).toEqual([2, 1]);
    expect(scored({ winnerTeamId: null, score1: 1, score2: 1 })).toEqual([1, 1]);
  });

  it("double forfait : aucun score, même si la ligne garde un 0-0", () => {
    expect(scored({ doubleForfeit: true, winnerTeamId: null, score1: 0, score2: 0 })).toEqual([null, null]);
    expect(scored({ doubleForfeit: true, winnerTeamId: null, score1: null, score2: null })).toEqual([null, null]);
  });

  it("forfait : score plein du format, même sans score en colonnes (forfaits antérieurs à la règle)", () => {
    expect(scored({ winnerTeamId: 2, forfeitTeamId: 1, score1: null, score2: null })).toEqual([0, 3]);
    expect(scored({ winnerTeamId: 1, forfeitTeamId: 2, score1: 0, score2: 0 })).toEqual([3, 0]);
    expect(scored({ winnerTeamId: 1, forfeitTeamId: 2, score1: null, score2: null, format: null })).toEqual([1, 0]);
  });
});

describe("tickerItemText", () => {
  it("rend la phrase telle qu'elle se lit, pour chaque sorte d'entrée", () => {
    expect(tickerItemText("NEWS · Saison")).toBe("NEWS · Saison");
    expect(tickerItemText({ kind: "champion", lead: "VAINQUEUR · Cup ·", name: "Alpha", known: true })).toBe("VAINQUEUR · Cup · Alpha");
    expect(
      tickerItemText({
        kind: "result",
        lead: "RÉSULTAT · Cup ·",
        sides: [
          { name: "Alpha", score: "2", outcome: "win", sr: "vainqueur" },
          { name: "Beta", score: "1", outcome: "loss", sr: "perdant" },
        ],
        sr: null,
      }),
    ).toBe("RÉSULTAT · Cup · Alpha 2 — Beta 1");
    expect(
      tickerItemText({
        kind: "result",
        lead: "RÉSULTAT · Cup ·",
        sides: [
          { name: "Alpha", score: null, outcome: "forfeit", sr: "forfait" },
          { name: "Beta", score: null, outcome: "forfeit", sr: "forfait" },
        ],
        sr: null,
      }),
    ).toBe("RÉSULTAT · Cup · Alpha — Beta");
  });
});
