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

describe("getiPostBodyText — sécurité 2", () => {
  it("getiPostBodyText_bareQuoteLine_stripped", () => {
    expect(getiPostBodyText("> LFT tank\n>\n> dispo ce soir", LABELS)).toBe("LFT tank\n\ndispo ce soir");
  });

  it("getiPostBodyText_longSpoiler_masked", () => {
    const secret = "y".repeat(1001);

    expect(getiPostBodyText(`contact ||${secret}||`, LABELS)).toBe("contact [masqué]");
  });

  it("getiPostBodyText_fencedCodeLanguage_dropped", () => {
    expect(getiPostBodyText("```txt\nAna__main```", LABELS)).toBe("Ana__main");
  });

  it("getiPostBodyText_markupInsideInlineCode_kept", () => {
    expect(getiPostBodyText("pseudo `**x**`", LABELS)).toBe("pseudo **x**");
  });

  it("getiPostBodyText_leftoverBold_removed", () => {
    expect(getiPostBodyText("**LFS**s ce soir", LABELS)).toBe("LFSs ce soir");
  });

  it("getiPostBodyText_leftoverStrike_removed", () => {
    expect(getiPostBodyText("Team ~~", LABELS)).toBe("Team");
  });

  it("getiPostBodyText_intrawordUnderscores_kept", () => {
    expect(getiPostBodyText("xX__Sniper__Xx", LABELS)).toBe("xX__Sniper__Xx");
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
