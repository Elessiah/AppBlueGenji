import { describe, expect, it } from "@jest/globals";
import {
  nextCategoryEnglish,
  borrowedCategoryEnglish,
  knownCategoryEnglish,
  BENEVOLE_CATEGORY_MAX,
  BENEVOLE_FIELD_ERRORS,
  benevoleInitials,
  categoryEnglish,
  formatDisplayName,
  formatJoinedAt,
  groupByCategory,
  localizedCategories,
  validateBenevoleInput,
  validateCategoryReorder,
  type Benevole,
} from "@/lib/shared/benevoles";

describe("validateBenevoleInput", () => {
  const valid = {
    firstName: "Marie",
    lastName: "Dupont",
    category: "Développeur",
    categoryEn: "Developer",
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

  it("accepts a pseudo alone, without firstName/lastName", () => {
    const result = validateBenevoleInput({
      firstName: "",
      lastName: "",
      pseudo: "MarieD",
      category: "Développeur",
      categoryEn: "Developer",
      joinedAt: "2024-03-15",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.firstName).toBe("");
      expect(result.value.lastName).toBe("");
      expect(result.value.pseudo).toBe("MarieD");
    }
  });

  it("rejects no name at all (no pseudo, no firstName/lastName)", () => {
    expect(
      validateBenevoleInput({
        firstName: "",
        lastName: "",
        category: "Développeur",
        joinedAt: "2024-03-15",
      }),
    ).toEqual({ ok: false, error: "NAME_REQUIRED" });
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
      categoryEn: "  Dev EN ",
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

  it("rejects a calendar-invalid date like 2024-02-30", () => {
    expect(validateBenevoleInput({ ...valid, joinedAt: "2024-02-30" })).toEqual({
      ok: false, error: "JOINED_AT_INVALID",
    });
  });

  it("rejects an impossible month like 2024-13-01", () => {
    expect(validateBenevoleInput({ ...valid, joinedAt: "2024-13-01" })).toEqual({
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
    { id: 1, firstName: "A", pseudo: null, lastName: "AA", category: "Dev", categoryEn: null, photoUrl: null, joinedAt: "2024-01-01" },
    { id: 2, firstName: "B", pseudo: null, lastName: "BB", category: "Arbitre", categoryEn: null, photoUrl: null, joinedAt: "2024-02-01" },
    { id: 3, firstName: "C", pseudo: null, lastName: "CC", category: "Dev", categoryEn: null, photoUrl: null, joinedAt: "2024-03-01" },
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

describe("validateCategoryReorder", () => {
  it("accepts an ordered list of category names", () => {
    const result = validateCategoryReorder(["Dev", "Arbitre", "Caster"]);
    expect(result).toEqual({ ok: true, categories: ["Dev", "Arbitre", "Caster"] });
  });

  it("trims whitespace from each category", () => {
    const result = validateCategoryReorder(["  Dev  ", " Arbitre "]);
    expect(result).toEqual({ ok: true, categories: ["Dev", "Arbitre"] });
  });

  it("rejects a non-array", () => {
    expect(validateCategoryReorder("Dev")).toEqual({ ok: false, error: "CATEGORIES_REQUIRED" });
    expect(validateCategoryReorder(null)).toEqual({ ok: false, error: "CATEGORIES_REQUIRED" });
  });

  it("rejects an empty array", () => {
    expect(validateCategoryReorder([])).toEqual({ ok: false, error: "CATEGORIES_EMPTY" });
  });

  it("rejects a non-string entry", () => {
    expect(validateCategoryReorder(["Dev", 42])).toEqual({ ok: false, error: "INVALID_CATEGORY" });
  });

  it("rejects an empty / whitespace-only entry", () => {
    expect(validateCategoryReorder(["Dev", "   "])).toEqual({ ok: false, error: "INVALID_CATEGORY" });
  });

  it("rejects a duplicate category", () => {
    expect(validateCategoryReorder(["Dev", "Dev"])).toEqual({ ok: false, error: "DUPLICATE_CATEGORY" });
  });

  it("treats trimmed duplicates as duplicates", () => {
    expect(validateCategoryReorder(["Dev", " Dev "])).toEqual({ ok: false, error: "DUPLICATE_CATEGORY" });
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

  it("returns the pseudo alone when there is no firstName/lastName", () => {
    expect(formatDisplayName({ firstName: "", pseudo: "MarieD", lastName: "" }))
      .toBe("MarieD");
  });

  it("falls back to firstName alone on a partial legacy name with no pseudo", () => {
    expect(formatDisplayName({ firstName: "Marie", pseudo: null, lastName: "" }))
      .toBe("Marie");
  });

  it("falls back to lastName alone on a partial legacy name with no pseudo", () => {
    expect(formatDisplayName({ firstName: "", pseudo: null, lastName: "dupont" }))
      .toBe("DUPONT");
  });

  it("returns an empty string when nothing at all is set", () => {
    expect(formatDisplayName({ firstName: "", pseudo: null, lastName: "" })).toBe("");
  });
});

describe("benevoleInitials", () => {
  it("uses firstName+lastName initials when both are set", () => {
    expect(benevoleInitials({ firstName: "marie", pseudo: null, lastName: "dupont" })).toBe("MD");
  });

  it("falls back to the pseudo's first letter when there is no full name", () => {
    expect(benevoleInitials({ firstName: "", pseudo: "ghost", lastName: "" })).toBe("G");
  });

  it("falls back to the pseudo even with a partial legacy name", () => {
    expect(benevoleInitials({ firstName: "Marie", pseudo: "ghost", lastName: "" })).toBe("G");
  });

  it("returns a placeholder when nothing is set", () => {
    expect(benevoleInitials({ firstName: "", pseudo: null, lastName: "" })).toBe("?");
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

describe("validateBenevoleInput — photo", () => {
  const valid = { firstName: "Marie", lastName: "Dupont", category: "Développeur", categoryEn: "Developer", joinedAt: "2024-03-15" };

  it("accepte une photo importée, servie ou disque", () => {
    for (const photoUrl of ["/api/uploads/benevoles/1-a.webp", "/uploads/benevoles/1-a.webp"]) {
      expect(validateBenevoleInput({ ...valid, photoUrl }).ok).toBe(true);
    }
  });

  // Rien à effacer chez nous : l'adresse est tue à la sortie par `localUploadUrl`.
  it("laisse passer une adresse étrangère", () => {
    expect(validateBenevoleInput({ ...valid, photoUrl: "https://cdn.exemple.fr/p.png" }).ok).toBe(true);
  });

  it.each([
    "/api/uploads/avatars/12-a.webp",
    "/api/uploads/teams/3-a.webp",
    "/uploads/sponsors/1-a.webp",
  ])("refuse l'adresse d'upload d'un autre dossier %s — le remplacement l'effacerait", (photoUrl) => {
    expect(validateBenevoleInput({ ...valid, photoUrl })).toEqual({ ok: false, error: "INVALID_PHOTO_URL" });
  });
});

describe("validateBenevoleInput — anglais de la catégorie (lot 5b, D9)", () => {
  const base = { firstName: "Marie", lastName: "Dupont", category: "Arbitre", joinedAt: "2024-03-15" };

  it("demande l'anglais de la catégorie, juste après son français", () => {
    expect(validateBenevoleInput(base)).toEqual({ ok: false, error: "CATEGORY_EN_REQUIRED" });
    expect(validateBenevoleInput({ ...base, category: "" })).toEqual({ ok: false, error: "CATEGORY_REQUIRED" });
    expect(validateBenevoleInput({ ...base, categoryEn: "r".repeat(BENEVOLE_CATEGORY_MAX + 1) })).toEqual({
      ok: false,
      error: "CATEGORY_EN_TOO_LONG",
    });
    expect(BENEVOLE_FIELD_ERRORS.CATEGORY_EN_REQUIRED).toBe("categoryEn");
  });

  it("garde l'anglais rogné", () => {
    const result = validateBenevoleInput({ ...base, categoryEn: "  Referee " });
    expect(result.ok && result.value.categoryEn).toBe("Referee");
  });
});

describe("localizedCategories", () => {
  const list: Benevole[] = [
    { id: 1, firstName: "A", pseudo: null, lastName: "AA", category: "Dev", categoryEn: null, photoUrl: null, joinedAt: "2024-01-01" },
    { id: 2, firstName: "B", pseudo: null, lastName: "BB", category: "Arbitre", categoryEn: null, photoUrl: null, joinedAt: "2024-02-01" },
    { id: 3, firstName: "C", pseudo: null, lastName: "CC", category: "Dev", categoryEn: "Development", photoUrl: null, joinedAt: "2024-03-01" },
  ];

  it("français : toutes les catégories, intitulé français", () => {
    expect(localizedCategories(list, "fr").map((g) => g.label)).toEqual(["Dev", "Arbitre"]);
  });

  it("anglais : une catégorie se traduit en bloc — un seul bénévole traduit suffit", () => {
    const groups = localizedCategories(list, "en");
    expect(groups.map((g) => [g.category, g.label, g.members.length])).toEqual([["Dev", "Development", 2]]);
    expect(categoryEnglish(list.filter((b) => b.category === "Arbitre"))).toBeNull();
  });
});

describe("formatJoinedAt — langue", () => {
  it("français inchangé, anglais en toutes lettres", () => {
    expect(formatJoinedAt("2024-03-15")).toBe("15/03/2024");
    expect(formatJoinedAt("2024-03-15", "en")).toBe("Mar 15, 2024");
    expect(formatJoinedAt("bad", "en")).toBe("bad");
  });
});


describe("nextCategoryEnglish", () => {
  // « Staff » existe, encore sans anglais.
  const known: Record<string, string | null> = { Arbitre: "Referee", Caster: "Caster", Developpeur: "Developer", Staff: null };
  const lookup = {
    englishOf: (category: string) => known[category.trim()] ?? null,
    exists: (category: string) => category.trim() in known,
    knownEnglish: new Set(["Referee", "Caster", "Developer"]),
  };
  const next = (form: { category: string; categoryEn: string }, category: string) => nextCategoryEnglish(form, category, lookup);

  it("reprend l'anglais connu de la nouvelle catégorie", () => {
    expect(next({ category: "", categoryEn: "" }, "Arbitre")).toBe("Referee");
    expect(next({ category: "Arbitre", categoryEn: "Referee" }, "Caster")).toBe("Caster");
  });

  it("vers une catégorie existante encore sans anglais, l'anglais repris se vide", () => {
    expect(next({ category: "Arbitre", categoryEn: "Referee" }, "Staff")).toBe("");
  });

  it("vers une catégorie inconnue, l'anglais reste (une faute corrigée ne le vide pas)", () => {
    expect(next({ category: "Developpeur", categoryEn: "Developer" }, "Dveloppeur")).toBe("Developer");
    expect(next({ category: "Dveloppeur", categoryEn: "Developer" }, "Développeur")).toBe("Developer");
  });

  it("un anglais repris, gardé le temps de taper une catégorie inconnue, cède à celui de la catégorie connue atteinte", () => {
    // « Arbitre » → « C » → « Caster » (connue) : « Referee » ne colle pas.
    expect(next({ category: "Arbitre", categoryEn: "Referee" }, "C")).toBe("Referee");
    expect(next({ category: "C", categoryEn: "Referee" }, "Caster")).toBe("Caster");
  });

  it("une saisie anglaise faite à la main n'est jamais écrasée", () => {
    expect(next({ category: "Graphiste", categoryEn: "Designer" }, "Arbitre")).toBe("Designer");
    expect(next({ category: "Arbitre", categoryEn: "Umpire" }, "Staff")).toBe("Umpire");
  });
});

describe("borrowedCategoryEnglish", () => {
  const benevoles = [
    { category: "Arbitre", categoryEn: "Referee" },
    { category: "Developpeur", categoryEn: "Developer" },
  ];

  it("catégorie nouvelle qui porte l'anglais d'une autre : la nomme, à vérifier", () => {
    expect(borrowedCategoryEnglish({ category: "Caster", categoryEn: "Referee" }, benevoles)).toBe("Arbitre");
    expect(borrowedCategoryEnglish({ category: "Développeur", categoryEn: "Developer" }, benevoles)).toBe("Developpeur");
  });

  it("rien à signaler : catégorie connue, anglais propre, ou champ vide", () => {
    expect(borrowedCategoryEnglish({ category: "Arbitre", categoryEn: "Referee" }, benevoles)).toBeNull();
    // Catégorie existante sans anglais qui reçoit celui d'une autre : signalé aussi.
    expect(borrowedCategoryEnglish({ category: "Staff", categoryEn: "Referee" }, [...benevoles, { category: "Staff", categoryEn: null }])).toBe("Arbitre");
    expect(borrowedCategoryEnglish({ category: "Caster", categoryEn: "Caster" }, benevoles)).toBeNull();
    expect(borrowedCategoryEnglish({ category: "Caster", categoryEn: "" }, benevoles)).toBeNull();
    expect(borrowedCategoryEnglish({ category: "", categoryEn: "Referee" }, benevoles)).toBeNull();
  });
});

describe("knownCategoryEnglish", () => {
  it("rassemble les anglais saisis, sans les vides", () => {
    expect(knownCategoryEnglish([{ categoryEn: " Referee " }, { categoryEn: null }, { categoryEn: "" }])).toEqual(new Set(["Referee"]));
  });
});
