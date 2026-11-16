import { describe, expect, it } from "@jest/globals";
import { formatProfilelessLookup, parseProfilelessLookup, PROFILELESS_LOOKUP_MAX } from "@/lib/shared/profileless-lookup";

/** D86 : seuls les identifiants affichés partent, en une question bornée. */
describe("parseProfilelessLookup", () => {
  it("parseProfilelessLookup_validList_returnsIds", () => {
    expect(parseProfilelessLookup("3,8")).toEqual([3, 8]);
  });

  it("parseProfilelessLookup_duplicates_dedupedInOrder", () => {
    expect(parseProfilelessLookup("8,3,8")).toEqual([8, 3]);
  });

  it("parseProfilelessLookup_absent_returnsNull", () => {
    expect(parseProfilelessLookup(null)).toBeNull();
  });

  it("parseProfilelessLookup_empty_returnsNull", () => {
    expect(parseProfilelessLookup("")).toBeNull();
  });

  it.each(["0", "-1", "3,abc", "1.5", "3,", "03", " 3"])("parseProfilelessLookup_malformed %s_returnsNull", (raw) => {
    expect(parseProfilelessLookup(raw)).toBeNull();
  });

  it("parseProfilelessLookup_unsafeInteger_returnsNull", () => {
    expect(parseProfilelessLookup("9999999999999999")).toBeNull();
  });

  it("parseProfilelessLookup_exactlyMax_returnsAll", () => {
    const raw = Array.from({ length: PROFILELESS_LOOKUP_MAX }, (_, index) => index + 1).join(",");

    expect(parseProfilelessLookup(raw)).toHaveLength(PROFILELESS_LOOKUP_MAX);
  });

  it("parseProfilelessLookup_overMax_returnsNull", () => {
    const raw = Array.from({ length: PROFILELESS_LOOKUP_MAX + 1 }, (_, index) => index + 1).join(",");

    expect(parseProfilelessLookup(raw)).toBeNull();
  });
});

describe("formatProfilelessLookup", () => {
  it("formatProfilelessLookup_ids_joinedByComma", () => {
    expect(formatProfilelessLookup([3, 8])).toBe("3,8");
  });
});
