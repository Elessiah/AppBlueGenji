import { describe, expect, it } from "@jest/globals";
import { messagesFor } from "@/lib/server/i18n-messages";
import { planningRoundMessages, planningRoundText, planningRoundTextOf } from "@/lib/shared/planning-round";
import { entryView } from "../../helpers/planning";

/** Nom du tour d'une entrée du planning : celui de la fiche (CAST_PLANNING.md). */
const FR = planningRoundTextOf("fr", planningRoundMessages(messagesFor("fr")));
const EN = planningRoundTextOf("en", planningRoundMessages(messagesFor("en")));

describe("planningRoundText", () => {
  it("planningRoundText_tournamentEntry_returnsNull", () => {
    expect(planningRoundText(FR, entryView({ kind: "TOURNAMENT", matchId: null, roundNumber: null }))).toBeNull();
  });

  it("planningRoundText_singleFinal_returnsFinale", () => {
    const entry = entryView({ round: { kind: "stage", stage: "final", lower: false, round: 3 }, roundNumber: 3 });

    expect(planningRoundText(FR, entry)).toBe("Finale");
    expect(planningRoundText(EN, entry)).toBe("Final");
  });

  it("planningRoundText_semiFinalAndQuarter_returnNamedStage", () => {
    const semi = entryView({ round: { kind: "stage", stage: "semis", lower: false, round: 2 }, roundNumber: 2, matchNumber: 2 });
    const quarter = entryView({ round: { kind: "stage", stage: "quarters", lower: false, round: 1 }, roundNumber: 1, matchNumber: 3 });

    expect(planningRoundText(FR, semi)).toContain("Demi-finale");
    expect(planningRoundText(FR, quarter)).toContain("Quart de finale");
  });

  it("planningRoundText_earlyRound_returnsRoundAndMatchNumber", () => {
    const entry = entryView({ round: { kind: "stage", stage: "early", lower: false, round: 1 }, roundNumber: 1, matchNumber: 4 });

    expect(planningRoundText(FR, entry)).toBe("Manche 1 · Match 4");
  });

  it("planningRoundText_doubleLowerBracket_prefixesLowerBracket", () => {
    const entry = entryView({ round: { kind: "stage", stage: "semis", lower: true, round: 2 }, roundNumber: 2 });

    expect(planningRoundText(FR, entry)).toMatch(/^Tableau perdants · /);
  });

  it("planningRoundText_swissRound_returnsRondeAndMatch", () => {
    const entry = entryView({ round: { kind: "numbered", noun: "swiss", number: 3 }, roundNumber: 3, matchNumber: 2 });

    expect(planningRoundText(FR, entry)).toBe("Ronde 3 · Match 2");
  });

  it("planningRoundText_unknownRound_fallsBackToRawNumber", () => {
    const entry = entryView({ round: null, roundNumber: 2, matchNumber: 5 });

    expect(planningRoundText(FR, entry)).toBe("Manche 2 · Match 5");
  });

  it("planningRoundText_noMatchNumber_defaultsToOne", () => {
    const entry = entryView({ round: null, roundNumber: 2, matchNumber: null });

    expect(planningRoundText(FR, entry)).toBe("Manche 2 · Match 1");
  });
});
