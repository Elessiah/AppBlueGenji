import { describe, expect, it } from "@jest/globals";
import { getiWithoutSpoilers } from "@/lib/shared/geti/normalize";
import { getiErrorCode, getiPostBodyText } from "@/lib/shared/geti/page";
import { parseGetiText } from "@/tests/helpers/geti";

/** Revue sécurité 2 : passages masqués (page et analyse), citation vide, code, marques restées seules, code d'erreur. */

const LABELS = { member: "@membre", role: "@rôle", channel: "#salon", spoiler: "[masqué]" };

describe("getiWithoutSpoilers", () => {
  it("getiWithoutSpoilers_noBars_returnsSameText", () => {
    expect(getiWithoutSpoilers("LFT tank | dps", " ")).toBe("LFT tank | dps");
  });

  it("getiWithoutSpoilers_pairedSpoiler_replacedByReplacement", () => {
    expect(getiWithoutSpoilers("a ||b|| c", "#")).toBe("a # c");
  });

  it("getiWithoutSpoilers_spoilerLongerThan1000_replaced", () => {
    const secret = "x".repeat(1001);

    expect(getiWithoutSpoilers(`contact ||${secret}|| fin`, "#")).toBe("contact # fin");
  });

  it("getiWithoutSpoilers_fourBarsThenText_hidesLikeDiscord", () => {
    // Discord : `\|\|([\s\S]+?)\|\|` — le contenu masqué peut commencer par une barre.
    expect(getiWithoutSpoilers("|||| puis ||secret||", "#")).toBe("#secret||");
  });

  it("getiWithoutSpoilers_unclosed_keptLiteral", () => {
    expect(getiWithoutSpoilers("tank || dps", "#")).toBe("tank || dps");
  });

  it("getiWithoutSpoilers_twoSpoilers_bothReplaced", () => {
    expect(getiWithoutSpoilers("||a|| et ||b||", "#")).toBe("# et #");
  });
});

describe("parseGetiPost — passage masqué", () => {
  it("parseGetiPost_ageAndTeamInsideSpoiler_noChipFromHiddenText", () => {
    const parsed = parseGetiText("LFT tank ||+18, team SecretSquad||");

    expect(parsed.minAge).toBeNull();
    expect(parsed.teamName).toBeNull();
    expect(parsed.roles).toEqual(["TANK"]);
  });
});

/** Cas `[nom, entrée, attendu]` : un tableau typé, pas `as const`. */
const BODY_CASES: [name: string, input: string, expected: string][] = [
  ["bareQuoteLine_stripped", "> LFT tank\n>\n> dispo ce soir", "LFT tank\n\ndispo ce soir"],
  ["longSpoiler_masked", `contact ||${"y".repeat(1001)}||`, "contact [masqué]"],
  ["fencedCodeLanguage_dropped", "```txt\nAna__main```", "Ana__main"],
  ["markupInsideInlineCode_kept", "pseudo `**x**`", "pseudo **x**"],
  ["leftoverBold_removed", "**LFS**s ce soir", "LFSs ce soir"],
  ["leftoverStrike_removed", "Team ~~", "Team"],
  ["intrawordUnderscores_kept", "xX__Sniper__Xx", "xX__Sniper__Xx"],
];

describe("getiPostBodyText — sécurité 2", () => {
  it.each(BODY_CASES)("getiPostBodyText_%s", (_name, input, expected) => {
    expect(getiPostBodyText(input, LABELS)).toBe(expected);
  });
});

describe("getiErrorCode — sécurité 2", () => {
  it("getiErrorCode_typeErrorWithoutCode_returnsName", () => {
    expect(getiErrorCode(new TypeError("Cannot read properties of undefined"))).toBe("TypeError");
  });

  it("getiErrorCode_nonError_returnsUnknown", () => {
    expect(getiErrorCode("down")).toBe("unknown");
  });
});
