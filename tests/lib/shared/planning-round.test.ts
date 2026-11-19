import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { messagesFor } from "@/lib/server/i18n-messages";
import { planningRoundMessages, planningRoundText, planningRoundTextOf } from "@/lib/shared/planning-round";
import type { StageKey } from "@/lib/shared/bracket-stage";
import type { ShareRound, ShareRoundNoun } from "@/lib/shared/share-round";
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

  it("planningRoundText_noMatchNumber_returnsRoundWithoutInventedMatch", () => {
    const entry = entryView({ round: null, roundNumber: 2, matchNumber: null });

    expect(planningRoundText(FR, entry)).toBe("Manche 2");
    expect(planningRoundText(EN, entry)).toBe("Round 2");
  });

  it("planningRoundText_playoffRoundUnknownMatchNumber_returnsFinalPhaseRank", () => {
    const entry = entryView({ round: null, roundNumber: 1001, matchNumber: null });

    expect(planningRoundText(FR, entry)).toMatch(/· Manche 2$/);
  });

  it("planningRoundText_everyRoundShape_neverRendersRawKey", () => {
    const stages: StageKey[] = ["grandFinal", "thirdPlace", "lowerFinal", "final", "semis", "quarters", "roundOf16", "early"];
    const nouns: ShareRoundNoun[] = ["swiss", "survival", "round"];
    const rounds: (ShareRound | null)[] = [
      ...stages.flatMap((stage) => [false, true].map((lower) => ({ kind: "stage" as const, stage, lower, round: 2 }))),
      ...nouns.map((noun) => ({ kind: "numbered" as const, noun, number: 3 })),
      null,
    ];

    const texts = [FR, EN].flatMap((text) =>
      rounds.flatMap((round) => [
        planningRoundText(text, entryView({ round, roundNumber: 1002, matchNumber: 2 })),
        planningRoundText(text, entryView({ round, roundNumber: 2, matchNumber: null })),
      ]),
    );

    expect(texts.filter((label) => label === null || /bracket\.|page\./.test(label))).toEqual([]);
  });
});

/** Le planning n'embarque pas le français de la fiche (`tournament.json` en valeur) : il importe le noyau. */
describe("planning client bundle", () => {
  const importsOf = (file: string): string[] =>
    [...readFileSync(path.join(process.cwd(), file), "utf8").matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

  it.each(["lib/shared/planning-round.ts", "lib/shared/share-round.ts", "lib/shared/bracket-stage-text.ts"])(
    "planningRoundChain_%s_neverImportsTheFrenchSheetModule",
    (file) => {
      expect(importsOf(file).filter((source) => /tournament-page-text$/.test(source))).toEqual([]);
    },
  );

  it("tournamentPageTextCore_never_importsTheFrenchJsonAsValue", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/shared/tournament-page-text-core.ts"), "utf8");

    expect(source).not.toMatch(/^import frTournament /m);
  });
});
