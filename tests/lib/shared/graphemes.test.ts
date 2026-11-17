import { describe, expect, it } from "@jest/globals";
import { cutToWidth, displayWidth, graphemesOf, isolateDirection } from "@/lib/shared/graphemes";
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
