import { describe, expect, it } from "@jest/globals";
import { getiCodeSpan, getiWithoutSpoilers } from "@/lib/shared/geti/normalize";
import { getiPostBodyText } from "@/lib/shared/geti/page";
import { parseGetiText } from "@/tests/helpers/geti";

/** Revue sécurité 4 : lecture de gauche à droite (passage ouvert avant un code), code sans borne, motif neuf par usage. */

const LABELS = { member: "@membre", role: "@rôle", channel: "#salon", spoiler: "[masqué]" };

/** Cas `[nom, entrée, attendu]` : un tableau typé, pas `as const`. */
const SPOILER_CASES: [name: string, input: string, expected: string][] = [
  ["spoilerOpensBeforeCodeCrossingClose_hiddenUpToFirstBars", "LFT ||team Secret`x|| `y`", "LFT # `y`"],
  ["spoilerWithBacktickAndNoLaterBars_stillHidden", "||`x|| `", "# `"],
  ["unpairedBackticksBeforeSpoiler_spoilerHidden", "`a ``b ||s|| fin", "`a ``b # fin"],
];

describe("getiWithoutSpoilers — passage ouvert avant un code", () => {
  it.each(SPOILER_CASES)("getiWithoutSpoilers_%s", (_name, input, expected) => {
    expect(getiWithoutSpoilers(input, "#")).toBe(expected);
  });

  it("getiWithoutSpoilers_codeLongerThan4096_barsInsideKeptLiteral", () => {
    const fence = "```" + "x".repeat(5000) + " a || b || c```";

    expect(getiWithoutSpoilers(fence, "#")).toBe(fence);
  });

  it("getiWithoutSpoilers_manyBackticksBeforeMark_linear", () => {
    const text = "`".repeat(20_000) + " ||x||";
    const started = Date.now();

    const actual = getiWithoutSpoilers(text, "#");

    expect(actual.endsWith(" #")).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("getiCodeSpan", () => {
  it("getiCodeSpan_twoCalls_independentRegexes", () => {
    const first = getiCodeSpan();
    const second = getiCodeSpan();

    first.test("a `b` c");

    expect(second).not.toBe(first);
    expect(second.lastIndex).toBe(0);
  });
});

describe("page et analyse — sécurité 4", () => {
  it("getiPostBodyText_spoilerOpensBeforeCode_neverShown", () => {
    expect(getiPostBodyText("LFT ||team Secret`x|| ok", LABELS)).toBe("LFT [masqué] ok");
  });

  it("parseGetiPost_teamInSpoilerOpenedBeforeCode_noTeamChip", () => {
    expect(parseGetiText("LFT tank ||+18 team SecretSquad`x|| `y`").minAge).toBeNull();
  });
});
