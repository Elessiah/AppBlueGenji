import { describe, expect, it } from "@jest/globals";
import { cutToWidth, displayWidth, graphemesOf, hasRightToLeftLetters, isolateDirection, withoutRightToLeftLetters } from "@/lib/shared/graphemes";
import { truncateForShare } from "@/lib/shared/share-metadata";

/** Drapeau français : deux indicateurs régionaux, un seul graphème. */
const FLAG_FR = "\u{1F1EB}\u{1F1F7}";
/** Pouce levé à teinte moyenne : deux points de code, un seul graphème. */
const THUMB_TONE = "\u{1F44D}\u{1F3FD}";

describe("graphemesOf", () => {
  it("graphemesOf_flagAndSkinTone_keepsClusters", () => {
    expect(graphemesOf(`${FLAG_FR}${THUMB_TONE}a`)).toEqual([FLAG_FR, THUMB_TONE, "a"]);
  });
});

describe("displayWidth", () => {
  it("displayWidth_latin_countsOnePerLetter", () => {
    expect(displayWidth("Alpha")).toBe(5);
  });

  it("displayWidth_cjkAndEmoji_countsTwo", () => {
    expect(displayWidth("東京")).toBe(4);
    expect(displayWidth(FLAG_FR)).toBe(2);
    expect(displayWidth(THUMB_TONE)).toBe(2);
  });
});

describe("displayWidth — symboles étroits et contrôles invisibles", () => {
  it("displayWidth_narrowPictographs_countsOne", () => {
    expect(displayWidth("\u00A9\u00AE\u2122\u203C\u2194\u2714")).toBe(6);
  });

  it("displayWidth_emojiPresentationSelector_countsTwo", () => {
    expect(displayWidth("\u2714\uFE0F")).toBe(2);
    expect(displayWidth("\u{1F3C6}")).toBe(2);
  });

  it("displayWidth_directionIsolates_countZero", () => {
    expect(displayWidth(isolateDirection("\u0627\u0644\u0646\u0633\u0648\u0631"))).toBe(6);
    expect(displayWidth("\u200Fab\u202E")).toBe(2);
  });
});

describe("cutToWidth", () => {
  it("cutToWidth_fits_unchanged", () => {
    expect(cutToWidth("Alpha", 5)).toBe("Alpha");
  });

  it("cutToWidth_latin_cutsWithEllipsis", () => {
    expect(cutToWidth("Alphabet", 5)).toBe("Alph…");
  });

  it("cutToWidth_flags_neverSplitsPair", () => {
    const cut = cutToWidth(`${FLAG_FR}${FLAG_FR}${FLAG_FR}`, 4);
    expect(cut).toBe(`${FLAG_FR}…`);
  });
});

describe("isolateDirection", () => {
  it("isolateDirection_arabic_wrapsFsiPdi", () => {
    expect(isolateDirection("النسور")).toBe("\u2068النسور\u2069");
  });

  it("isolateDirection_hebrew_wrapsFsiPdi", () => {
    expect(isolateDirection("שלום")).toBe("\u2068שלום\u2069");
  });

  it("isolateDirection_latin_unchanged", () => {
    expect(isolateDirection("Choco Pops")).toBe("Choco Pops");
  });
});

describe("truncateForShare — graphèmes", () => {
  it("truncateForShare_emojiWithinCodePointBudget_notCut", () => {
    // 5 points de code (10 unités UTF-16) : tient dans 5.
    const text = "\u{1F3C6}\u{1F3C6}\u{1F3C6}\u{1F3C6}\u{1F3C6}";
    expect(truncateForShare(text, 5)).toBe(text);
  });

  it("truncateForShare_flags_cutBetweenGraphemes", () => {
    // Trois drapeaux = 6 points de code ; limite 4 → un drapeau entier + ellipse.
    expect(truncateForShare(`${FLAG_FR}${FLAG_FR}${FLAG_FR}`, 4)).toBe(`${FLAG_FR}…`);
  });
});

describe("withoutRightToLeftLetters", () => {
  it("withoutRightToLeftLetters_mixed_keepsLatinPart", () => {
    expect(withoutRightToLeftLetters(`Team ${"\u0627\u0644\u0646\u0633\u0648\u0631"} 2`)).toBe("Team 2");
  });

  it("withoutRightToLeftLetters_hebrewOnly_returnsEmpty", () => {
    expect(withoutRightToLeftLetters("\u05E9\u05DC\u05D5\u05DD")).toBe("");
  });

  it("withoutRightToLeftLetters_latin_unchanged", () => {
    expect(withoutRightToLeftLetters("Choco Pops")).toBe("Choco Pops");
  });
});

describe("hasRightToLeftLetters", () => {
  const ARABIC = String.fromCharCode(0x627, 0x644, 0x646, 0x633, 0x648, 0x631);

  it("hasRightToLeftLetters_arabicName_isTrueEveryCall", () => {
    // Un test répété : aucune dérive d'état (`lastIndex`) d'une expression globale.
    expect([1, 2, 3].map(() => hasRightToLeftLetters(`Les ${ARABIC}`))).toEqual([true, true, true]);
  });

  it("hasRightToLeftLetters_latinAndCjkName_isFalse", () => {
    expect(hasRightToLeftLetters("Alpha 東京")).toBe(false);
  });

  it("withoutRightToLeftLetters_calledTwice_givesTheSameResult", () => {
    expect([1, 2].map(() => withoutRightToLeftLetters(`A ${ARABIC} B`))).toEqual(["A B", "A B"]);
  });
});
