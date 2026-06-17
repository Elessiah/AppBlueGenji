import { describe, expect, it } from "@jest/globals";
import {
  formatDisplayName,
  formatJoinedAt,
  groupByCategory,
  validateBenevoleInput,
  type Benevole,
} from "@/lib/shared/benevoles";

describe("validateBenevoleInput", () => {
  const valid = {
    firstName: "Marie",
    lastName: "Dupont",
    category: "Développeur",
    joinedAt: "2024-03-15",
  };

  it("accepts a minimal valid input", () => {
    const result = validateBenevoleInput(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.firstName).toBe("Marie");
      expect(result.value.lastName).toBe("Dupont");
      expect(result.value.category).toBe("Développeur");
      expect(result.value.joinedAt).toBe("2024-03-15");
      expect(result.value.pseudo).toBe("");
      expect(result.value.photoUrl).toBe("");
    }
  });

  it("accepts optional pseudo and photoUrl", () => {
    const result = validateBenevoleInput({
      ...valid,
      pseudo: "MarieD",
      photoUrl: "https://example.com/avatar.jpg",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pseudo).toBe("MarieD");
      expect(result.value.photoUrl).toBe("https://example.com/avatar.jpg");
    }
  });

  it("trims whitespace from all string fields", () => {
    const result = validateBenevoleInput({
      firstName: "  Marie  ",
      lastName: "  Dupont  ",
      category: "  Dev  ",
      joinedAt: "2024-03-15",
      pseudo: "  md  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.firstName).toBe("Marie");
      expect(result.value.lastName).toBe("Dupont");
      expect(result.value.category).toBe("Dev");
      expect(result.value.pseudo).toBe("md");
    }
  });

  it("rejects missing firstName", () => {
    expect(validateBenevoleInput({ ...valid, firstName: "" })).toEqual({
      ok: false, error: "FIRST_NAME_REQUIRED",
    });
  });

  it("rejects missing lastName", () => {
    expect(validateBenevoleInput({ ...valid, lastName: "   " })).toEqual({
      ok: false, error: "LAST_NAME_REQUIRED",
    });
  });

  it("rejects missing category", () => {
    expect(validateBenevoleInput({ ...valid, category: "" })).toEqual({
      ok: false, error: "CATEGORY_REQUIRED",
    });
  });

  it("rejects missing joinedAt", () => {
    expect(validateBenevoleInput({ ...valid, joinedAt: "" })).toEqual({
      ok: false, error: "JOINED_AT_REQUIRED",
    });
  });

  it("rejects an invalid date format", () => {
    expect(validateBenevoleInput({ ...valid, joinedAt: "15/03/2024" })).toEqual({
      ok: false, error: "JOINED_AT_INVALID",
    });
  });

  it("rejects firstName over 80 chars", () => {
    expect(validateBenevoleInput({ ...valid, firstName: "a".repeat(81) })).toEqual({
      ok: false, error: "FIRST_NAME_TOO_LONG",
    });
  });

  it("rejects lastName over 80 chars", () => {
    expect(validateBenevoleInput({ ...valid, lastName: "a".repeat(81) })).toEqual({
      ok: false, error: "LAST_NAME_TOO_LONG",
    });
  });

  it("rejects category over 120 chars", () => {
    expect(validateBenevoleInput({ ...valid, category: "a".repeat(121) })).toEqual({
      ok: false, error: "CATEGORY_TOO_LONG",
    });
  });

  it("rejects pseudo over 80 chars", () => {
    expect(validateBenevoleInput({ ...valid, pseudo: "a".repeat(81) })).toEqual({
      ok: false, error: "PSEUDO_TOO_LONG",
    });
  });

  it("rejects photoUrl over 500 chars", () => {
    expect(validateBenevoleInput({ ...valid, photoUrl: "a".repeat(501) })).toEqual({
      ok: false, error: "PHOTO_URL_TOO_LONG",
    });
  });
});

describe("groupByCategory", () => {
  const benevoles: Benevole[] = [
    { id: 1, firstName: "A", pseudo: null, lastName: "AA", category: "Dev", photoUrl: null, joinedAt: "2024-01-01" },
    { id: 2, firstName: "B", pseudo: null, lastName: "BB", category: "Arbitre", photoUrl: null, joinedAt: "2024-02-01" },
    { id: 3, firstName: "C", pseudo: null, lastName: "CC", category: "Dev", photoUrl: null, joinedAt: "2024-03-01" },
  ];

  it("groups members by category", () => {
    const groups = groupByCategory(benevoles);
    expect(groups).toHaveLength(2);
    expect(groups[0].category).toBe("Dev");
    expect(groups[0].members).toHaveLength(2);
    expect(groups[1].category).toBe("Arbitre");
    expect(groups[1].members).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(groupByCategory([])).toEqual([]);
  });

  it("preserves insertion order of categories", () => {
    const groups = groupByCategory(benevoles);
    expect(groups.map((g) => g.category)).toEqual(["Dev", "Arbitre"]);
  });
});

describe("formatDisplayName", () => {
  it("formats Prénom NOM when no pseudo", () => {
    expect(formatDisplayName({ firstName: "Marie", pseudo: null, lastName: "Dupont" }))
      .toBe("Marie DUPONT");
  });

  it("formats Prénom \"Pseudo\" NOM when pseudo is set", () => {
    expect(formatDisplayName({ firstName: "Marie", pseudo: "MarieD", lastName: "Dupont" }))
      .toBe('Marie "MarieD" DUPONT');
  });

  it("uppercases the last name", () => {
    expect(formatDisplayName({ firstName: "Jean", pseudo: null, lastName: "martin" }))
      .toBe("Jean MARTIN");
  });
});

describe("formatJoinedAt", () => {
  it("converts YYYY-MM-DD to DD/MM/YYYY", () => {
    expect(formatJoinedAt("2024-03-15")).toBe("15/03/2024");
  });

  it("returns the input as-is when format is unexpected", () => {
    expect(formatJoinedAt("invalid")).toBe("invalid");
  });
});
