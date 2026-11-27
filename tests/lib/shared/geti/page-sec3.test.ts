import { describe, expect, it } from "@jest/globals";
import { getiCodeRanges, getiWithoutSpoilers } from "@/lib/shared/geti/normalize";
import { getiPostBodyText } from "@/lib/shared/geti/page";
import { parseGetiText } from "@/tests/helpers/geti";

/** Revue sécurité 3 : passages masqués au contact du code, règle de Discord pour `||||`, code rendu tel quel, marques restées seules. */

const LABELS = { member: "@membre", role: "@rôle", channel: "#salon", spoiler: "[masqué]" };

/** Cas `[nom, entrée, attendu]` : un tableau typé, pas `as const`. */
type Case = [name: string, input: string, expected: string];

const SPOILER_CASES: Case[] = [
  ["barsInsideInlineCode_codeIgnoredAndRealSpoilerHidden", "use `||` then ||secret||", "use `||` then #"],
  ["codeInsideSpoiler_wholePassageHidden", "||a `b` c|| d", "# d"],
  ["onlyBarsInCode_unchanged", "`||x||`", "`||x||`"],
  ["fourBarsAlone_keptLiteral", "||||", "||||"],
  ["threeBarsThenText_hidesBarAndText", "|||a|| fin", "# fin"],
];

describe("getiWithoutSpoilers — code et barres", () => {
  it.each(SPOILER_CASES)("getiWithoutSpoilers_%s", (_name, input, expected) => {
    expect(getiWithoutSpoilers(input, "#")).toBe(expected);
  });
});

describe("getiCodeRanges", () => {
  it("getiCodeRanges_noBacktick_empty", () => {
    expect(getiCodeRanges("LFT tank")).toEqual([]);
  });

  it("getiCodeRanges_inlineAndFence_rangesInOrder", () => {
    expect(getiCodeRanges("a `b` c ```d```")).toEqual([
      [2, 5],
      [8, 15],
    ]);
  });
});

const BODY_CASES: Case[] = [
  ["spoilerAfterCodeBars_neverShown", "use `||` then ||secret 17 ans||", "use || then [masqué]"],
  ["headingAndQuoteInsideFence_keptVerbatim", "```\n# config\n> note\n```", "# config\n> note"],
  ["hashAfterInlineCode_notStrippedAsHeading", "`x` # hi", "x # hi"],
  ["powerBetweenDigits_kept", "score 5**2", "score 5**2"],
  ["separatorBetweenSpaces_kept", "a ~~~ b", "a ~~~ b"],
  ["separatorAloneOnLine_kept", "LFT\n~~~~\nEU", "LFT\n~~~~\nEU"],
];

describe("getiPostBodyText — sécurité 3", () => {
  it.each(BODY_CASES)("getiPostBodyText_%s", (_name, input, expected) => {
    expect(getiPostBodyText(input, LABELS)).toBe(expected);
  });
});

describe("parseGetiPost — passage masqué après du code", () => {
  it("parseGetiPost_ageInClear_read", () => {
    expect(parseGetiText("LFT tank +18 team SecretSquad").minAge).toBe(18);
  });

  it("parseGetiPost_ageInSpoilerAfterCodeBars_noAgeChip", () => {
    const parsed = parseGetiText("LFT tank `||` ||+18 team SecretSquad||");

    expect(parsed.minAge).toBeNull();
    expect(parsed.teamName).toBeNull();
  });

  it("parseGetiPost_plusEighteenInsideSpoiler_noAgeChip", () => {
    expect(parseGetiText("LFT tank ||+18, team SecretSquad||").minAge).toBeNull();
  });
});
