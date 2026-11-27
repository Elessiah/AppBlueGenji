import { describe, expect, it } from "@jest/globals";
import { getiErrorCode, getiPostBodyText, getiPostChips, getiTimestampLabel } from "@/lib/shared/geti/page";
import type { GetiParsedPost } from "@/lib/shared/geti";
import { parsedGetiPost } from "@/tests/helpers/geti";

/** Revue sécurité 1 : texte d'annonce (citation, masqué, balisage, horodatage), étiquettes sûres, code d'erreur. */

const LABELS = { member: "@membre", role: "@rôle", channel: "#salon", spoiler: "[masqué]" };
/** 2026-11-27 20:00 UTC = 21:00 à Paris. */
const EVENING = Date.parse("2026-11-27T20:00:00.000Z") / 1000;

describe("getiPostBodyText — citation", () => {
  it("getiPostBodyText_relayQuoteWithSpace_stripsOneLevel", () => {
    expect(getiPostBodyText("> > cité par le joueur", LABELS)).toBe("> cité par le joueur");
  });

  it("getiPostBodyText_quoteWithoutSpace_keepsGreaterThan", () => {
    expect(getiPostBodyText(">4000 SR only", LABELS)).toBe(">4000 SR only");
  });

  it("getiPostBodyText_blockQuote_stripsMarker", () => {
    expect(getiPostBodyText(">>> LFT tank", LABELS)).toBe("LFT tank");
  });
});

describe("getiPostBodyText — passage masqué", () => {
  it("getiPostBodyText_spoiler_replacedByLabel", () => {
    expect(getiPostBodyText("contact ||Player#21345 / 06 12||", LABELS)).toBe("contact [masqué]");
  });

  it("getiPostBodyText_multilineSpoiler_replacedByLabel", () => {
    expect(getiPostBodyText("âge ||17\nans|| ok", LABELS)).toBe("âge [masqué] ok");
  });

  it("getiPostBodyText_unpairedSpoiler_keptLiteral", () => {
    expect(getiPostBodyText("tank || dps", LABELS)).toBe("tank || dps");
  });

  it("getiPostBodyText_englishLabel_used", () => {
    expect(getiPostBodyText("||secret||", { ...LABELS, spoiler: "[hidden]" }, "en")).toBe("[hidden]");
  });
});

describe("getiPostBodyText — balisage", () => {
  it("getiPostBodyText_pairedBoldAtWordEdge_stripped", () => {
    expect(getiPostBodyText("**LFS**, __ce soir__ ~~annulé~~", LABELS)).toBe("LFS, ce soir annulé");
  });

  it("getiPostBodyText_intrawordUnderscores_kept", () => {
    expect(getiPostBodyText("ajoutez xX__Sniper__Xx", LABELS)).toBe("ajoutez xX__Sniper__Xx");
  });

  it("getiPostBodyText_codePair_stripped", () => {
    expect(getiPostBodyText("tag `Ana#1234`", LABELS)).toBe("tag Ana#1234");
  });

  it("getiPostBodyText_loneBacktick_kept", () => {
    expect(getiPostBodyText("l`apostrophe", LABELS)).toBe("l`apostrophe");
  });

  it("getiPostBodyText_hostileLongText_staysFast", () => {
    const hostile = "**x".repeat(1365);
    const started = Date.now();

    getiPostBodyText(hostile, LABELS);

    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("getiPostBodyText — horodatage Discord", () => {
  it("getiPostBodyText_shortTimeFrench_writesParisTime", () => {
    expect(getiPostBodyText(`Dispo <t:${EVENING}:t>`, LABELS)).toMatch(/^Dispo 21:00 UTC\+1$/);
  });

  it("getiPostBodyText_shortTimeEnglish_writesParisTime", () => {
    expect(getiPostBodyText(`From <t:${EVENING}:t>`, LABELS, "en")).toMatch(/^From 21:00 (CET|GMT\+1)$/);
  });

  it("getiTimestampLabel_shortDate_writesDayMonthYear", () => {
    expect(getiTimestampLabel(EVENING, "d", "fr")).toBe("27/11/2026");
  });

  it("getiTimestampLabel_relativeStyle_writtenAsFull", () => {
    expect(getiTimestampLabel(EVENING, "R", "fr")).toBe(getiTimestampLabel(EVENING, "f", "fr"));
  });

  it("getiTimestampLabel_unknownStyle_writtenAsFull", () => {
    expect(getiTimestampLabel(EVENING, "x", "fr")).toBe(getiTimestampLabel(EVENING, undefined, "fr"));
  });

  it("getiTimestampLabel_nonFinite_returnsEmpty", () => {
    expect(getiTimestampLabel(Number.NaN, "t", "fr")).toBe("");
  });
});

describe("getiPostChips — valeurs hors domaine", () => {
  /** Analyse gardée abîmée : des valeurs que le type n'admet pas, comme en base. */
  function stored(overrides: Record<string, unknown>): GetiParsedPost {
    return { ...parsedGetiPost(), ...overrides } as unknown as GetiParsedPost;
  }

  it("getiPostChips_unknownRoleProto_ignored", () => {
    const chips = getiPostChips(stored({ roles: ["__proto__", "TANK"] }));

    expect(chips.filter((chip) => chip.kind === "role")).toEqual([{ kind: "role", value: "TANK" }]);
  });

  it("getiPostChips_unknownDayAndLanguage_ignored", () => {
    const chips = getiPostChips(
      stored({ languages: ["constructor"], availability: { days: ["toString", "MON"], times: [], timezone: null } }),
    );

    expect(chips.filter((chip) => chip.kind === "day" || chip.kind === "language")).toEqual([
      { kind: "day", value: "MON" },
    ]);
  });

  it("getiPostChips_nonStringTeamAndDates_ignored", () => {
    const chips = getiPostChips(stored({ teamName: { x: 1 }, dates: [42, "2026-11-28"] }));

    expect(chips.filter((chip) => chip.kind === "team" || chip.kind === "date")).toEqual([
      { kind: "date", iso: "2026-11-28" },
    ]);
  });

  it("getiPostChips_nonFiniteMinAge_ignored", () => {
    expect(getiPostChips(stored({ minAge: Number.POSITIVE_INFINITY })).some((chip) => chip.kind === "minAge")).toBe(false);
  });
});

describe("getiErrorCode", () => {
  it("getiErrorCode_mysqlCode_returned", () => {
    expect(getiErrorCode(Object.assign(new Error("Table x"), { code: "ER_PARSE_ERROR" }))).toBe("ER_PARSE_ERROR");
  });

  it("getiErrorCode_messageLikeCode_unknown", () => {
    expect(getiErrorCode({ code: "select * from secret" })).toBe("unknown");
  });

  it("getiErrorCode_nonObject_unknown", () => {
    expect(getiErrorCode("boom")).toBe("unknown");
  });
});
