import { describe, expect, it } from "@jest/globals";

import { frEn, inBothLanguages, isBilingual, localize, type Localizable } from "@/lib/shared/bilingual";

interface Sample {
  ref: string;
  count: number;
  open: boolean;
  name: string;
  items: string[];
}

const SAMPLE: Localizable<Sample> = {
  ref: "T01",
  count: 3,
  open: false,
  name: frEn("Comptes", "Accounts"),
  items: [frEn("Pseudo", "Username"), "Discord"],
};

describe("frEn", () => {
  it("frEn_twoValues_returnsPairWithFrenchThenEnglish", () => {
    const pair = frEn("Bonjour", "Hello");

    expect(pair).toEqual({ fr: "Bonjour", en: "Hello" });
    expect(Object.keys(pair)).toEqual(["fr", "en"]);
  });
});

describe("isBilingual", () => {
  it("isBilingual_objectWithExactlyFrAndEn_returnsTrue", () => {
    expect(isBilingual({ en: 1, fr: 2 })).toBe(true);
  });

  it("isBilingual_objectWithExtraKey_returnsFalse", () => {
    expect(isBilingual({ fr: "a", en: "b", num: "01" })).toBe(false);
  });

  it("isBilingual_objectWithTwoOtherKeys_returnsFalse", () => {
    expect(isBilingual({ fr: "a", de: "b" })).toBe(false);
  });

  it("isBilingual_null_returnsFalse", () => {
    expect(isBilingual(null)).toBe(false);
  });

  it("isBilingual_primitive_returnsFalse", () => {
    expect(isBilingual("fr")).toBe(false);
  });

  it("isBilingual_array_returnsFalse", () => {
    expect(isBilingual(["fr", "en"])).toBe(false);
  });
});

describe("localize", () => {
  it("localize_pairOfStrings_returnsFrenchHalf", () => {
    expect(localize(frEn("Oui", "Yes"), "fr")).toBe("Oui");
  });

  it("localize_pairOfStrings_returnsEnglishHalf", () => {
    expect(localize(frEn("Oui", "Yes"), "en")).toBe("Yes");
  });

  it("localize_pairOfWholeLists_returnsEachListAsIs", () => {
    const french = ["a", "b"];
    const english = ["x"];
    const pair = frEn(french, english);

    expect(localize<string[]>(pair, "fr")).toBe(french);
    expect(localize<string[]>(pair, "en")).toBe(english);
  });

  it("localize_nestedObjectAndArray_resolvesEveryPairKeepingSharedValues", () => {
    expect(localize(SAMPLE, "en")).toEqual({
      ref: "T01",
      count: 3,
      open: false,
      name: "Accounts",
      items: ["Username", "Discord"],
    });
  });

  it("localize_object_keepsKeyOrder", () => {
    const spec: Localizable<{ z: string; a: string; m: number }> = { z: frEn("z", "Z"), a: "a", m: 1 };

    expect(Object.keys(localize(spec, "fr"))).toEqual(["z", "a", "m"]);
  });

  it("localize_input_isNotMutated", () => {
    const before = JSON.stringify(SAMPLE);

    localize(SAMPLE, "fr");

    expect(JSON.stringify(SAMPLE)).toBe(before);
  });
});

describe("inBothLanguages", () => {
  it("inBothLanguages_spec_returnsBothResolutions", () => {
    expect(inBothLanguages(SAMPLE)).toEqual({
      fr: { ref: "T01", count: 3, open: false, name: "Comptes", items: ["Pseudo", "Discord"] },
      en: { ref: "T01", count: 3, open: false, name: "Accounts", items: ["Username", "Discord"] },
    });
  });
});
