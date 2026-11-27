import { describe, expect, it } from "@jest/globals";
import { getiCodeRanges, getiWithoutSpoilers } from "@/lib/shared/geti/normalize";
import { getiPostBodyText } from "@/lib/shared/geti/page";
import { parseGetiText } from "@/tests/helpers/geti";

/** Revue sécurité 3 : passages masqués au contact du code, règle de Discord pour `||||`, code rendu tel quel, marques restées seules. */

const LABELS = { member: "@membre", role: "@rôle", channel: "#salon", spoiler: "[masqué]" };

describe("getiWithoutSpoilers — code et barres", () => {
  it("getiWithoutSpoilers_barsInsideInlineCode_codeIgnoredAndRealSpoilerHidden", () => {
    expect(getiWithoutSpoilers("use `||` then ||secret||", "#")).toBe("use `||` then #");
  });

  it("getiWithoutSpoilers_codeInsideSpoiler_wholePassageHidden", () => {
    expect(getiWithoutSpoilers("||a `b` c|| d", "#")).toBe("# d");
  });

  it("getiWithoutSpoilers_onlyBarsInCode_unchanged", () => {
    expect(getiWithoutSpoilers("`||x||`", "#")).toBe("`||x||`");
  });

  it("getiWithoutSpoilers_fourBarsAlone_keptLiteral", () => {
    expect(getiWithoutSpoilers("||||", "#")).toBe("||||");
  });

  it("getiWithoutSpoilers_threeBarsThenText_hidesBarAndText", () => {
    expect(getiWithoutSpoilers("|||a|| fin", "#")).toBe("# fin");
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

describe("getiPostBodyText — sécurité 3", () => {
  it("getiPostBodyText_spoilerAfterCodeBars_neverShown", () => {
    expect(getiPostBodyText("use `||` then ||secret 17 ans||", LABELS)).toBe("use || then [masqué]");
  });

  it("getiPostBodyText_headingAndQuoteInsideFence_keptVerbatim", () => {
    expect(getiPostBodyText("```\n# config\n> note\n```", LABELS)).toBe("# config\n> note");
  });

  it("getiPostBodyText_hashAfterInlineCode_notStrippedAsHeading", () => {
    expect(getiPostBodyText("`x` # hi", LABELS)).toBe("x # hi");
  });

  it("getiPostBodyText_powerBetweenDigits_kept", () => {
    expect(getiPostBodyText("score 5**2", LABELS)).toBe("score 5**2");
  });

  it("getiPostBodyText_separatorBetweenSpaces_kept", () => {
    expect(getiPostBodyText("a ~~~ b", LABELS)).toBe("a ~~~ b");
  });

  it("getiPostBodyText_separatorAloneOnLine_kept", () => {
    expect(getiPostBodyText("LFT\n~~~~\nEU", LABELS)).toBe("LFT\n~~~~\nEU");
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
