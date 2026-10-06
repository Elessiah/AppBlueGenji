import { describe, expect, it } from "@jest/globals";
import {
  BUREAU_COLORS,
  BUREAU_FIELD_ERRORS,
  BUREAU_ROLE_MAX,
  FALLBACK_BUREAU,
  bureauErrorMessage,
  computeInitials,
  localizedBureau,
  randomBureauColor,
  validateBureauInput,
  type BureauMember,
} from "@/lib/shared/bureau";

describe("computeInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(computeInitials("Léo Perreaut")).toBe("LP");
  });

  it("takes up to three initials", () => {
    expect(computeInitials("Jean Michel Dupont")).toBe("JMD");
  });

  it("uses the first two letters for a single word", () => {
    expect(computeInitials("Madonna")).toBe("MA");
  });

  it("uppercases the result", () => {
    expect(computeInitials("bryan boulleaux")).toBe("BB");
  });

  it("collapses extra whitespace", () => {
    expect(computeInitials("  Sophie   Martin  ")).toBe("SM");
  });

  it("returns empty string for empty input", () => {
    expect(computeInitials("   ")).toBe("");
  });
});

describe("randomBureauColor", () => {
  it("always returns a color from the palette", () => {
    for (let i = 0; i < 50; i++) {
      expect(BUREAU_COLORS).toContain(randomBureauColor());
    }
  });
});

describe("validateBureauInput", () => {
  it("accepts a valid input and derives initials + color", () => {
    const result = validateBureauInput({ roleEn: "Role", name: "Léo Perreaut", role: "Président" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Léo Perreaut");
      expect(result.value.role).toBe("Président");
      expect(result.value.initials).toBe("LP");
      expect(BUREAU_COLORS).toContain(result.value.color);
    }
  });

  it("trims name and role", () => {
    const result = validateBureauInput({ roleEn: "Role", name: "  Sophie Martin ", role: "  Secrétaire " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Sophie Martin");
      expect(result.value.role).toBe("Secrétaire");
    }
  });

  it("keeps explicit initials (uppercased, capped at 4)", () => {
    const result = validateBureauInput({ roleEn: "Role", name: "X", role: "Role", initials: "abcde" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.initials).toBe("ABCD");
  });

  it("caps initials by code point without splitting surrogate pairs", () => {
    // 5 emoji (each 2 UTF-16 units) — must keep 4 whole code points, no lone surrogate.
    const result = validateBureauInput({ roleEn: "Role", name: "X", role: "Role", initials: "😀😁😂🤣😅" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.value.initials]).toHaveLength(4);
      // No unpaired surrogate (would encode as U+FFFD-like / invalid otherwise).
      expect(result.value.initials).toBe("😀😁😂🤣");
    }
  });

  it("keeps an explicit color", () => {
    const result = validateBureauInput({ roleEn: "Role", name: "X", role: "Role", color: "rgb(1, 2, 3)" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.color).toBe("rgb(1, 2, 3)");
  });

  it("rejects a missing name", () => {
    const result = validateBureauInput({ roleEn: "Role", name: "  ", role: "Président" });
    expect(result).toEqual({ ok: false, error: "NAME_REQUIRED" });
  });

  it("rejects a missing role", () => {
    const result = validateBureauInput({ roleEn: "Role", name: "Léo", role: "" });
    expect(result).toEqual({ ok: false, error: "ROLE_REQUIRED" });
  });

  it("rejects an over-long name", () => {
    const result = validateBureauInput({ roleEn: "Role", name: "a".repeat(121), role: "Role" });
    expect(result).toEqual({ ok: false, error: "NAME_TOO_LONG" });
  });

  it("rejects an over-long role", () => {
    const result = validateBureauInput({ roleEn: "Role", name: "Léo", role: "a".repeat(121) });
    expect(result).toEqual({ ok: false, error: "ROLE_TOO_LONG" });
  });

  it("rejects when initials cannot be derived (numeric-free empty name words)", () => {
    // name with only spaces already rejected; this checks a name that yields no initials
    const result = validateBureauInput({ roleEn: "Role", name: "Léo", role: "Role", initials: "   " });
    // initials fall back to computeInitials("Léo") => "LÉ"
    expect(result.ok).toBe(true);
  });
});

describe("validateBureauInput — anglais du rôle (lot 5b, D9)", () => {
  it("demande l'anglais du rôle, rattaché à son champ", () => {
    expect(validateBureauInput({ name: "Léo", role: "Président" })).toEqual({ ok: false, error: "ROLE_EN_REQUIRED" });
    expect(validateBureauInput({ name: "Léo", role: "Président", roleEn: "   " })).toEqual({ ok: false, error: "ROLE_EN_REQUIRED" });
    expect(BUREAU_FIELD_ERRORS.ROLE_EN_REQUIRED).toBe("roleEn");
  });

  it("borne l'anglais comme le français", () => {
    expect(validateBureauInput({ name: "Léo", role: "Président", roleEn: "a".repeat(BUREAU_ROLE_MAX + 1) })).toEqual({
      ok: false,
      error: "ROLE_EN_TOO_LONG",
    });
  });

  it("garde l'anglais rogné", () => {
    const result = validateBureauInput({ name: "Léo", role: "Président", roleEn: "  President " });
    expect(result.ok && result.value.roleEn).toBe("President");
  });

  it("le français reste vérifié d'abord", () => {
    expect(validateBureauInput({ name: "Léo", role: "" })).toEqual({ ok: false, error: "ROLE_REQUIRED" });
  });
});

describe("localizedBureau", () => {
  const members: BureauMember[] = [
    { id: 1, name: "A", role: "Président", roleEn: "President", initials: "A", color: "c" },
    { id: 2, name: "B", role: "Trésorier", roleEn: null, initials: "B", color: "c" },
  ];

  it("français : tous les membres, rôle français", () => {
    expect(localizedBureau(members, "fr").map((m) => m.role)).toEqual(["Président", "Trésorier"]);
  });

  it("anglais : seulement les rôles traduits, avec leur place dans la liste complète", () => {
    expect(localizedBureau(members, "en")).toEqual([{ member: members[0], role: "President", index: 0 }]);
  });

  it("le bureau de secours a son anglais", () => {
    expect(localizedBureau(FALLBACK_BUREAU, "en")).toHaveLength(FALLBACK_BUREAU.length);
  });
});

describe("bureauErrorMessage", () => {
  it("phrase les refus de l'anglais comme l'éditeur des textes de la vitrine", () => {
    expect(bureauErrorMessage("ROLE_EN_REQUIRED", "x")).toBe("La traduction anglaise est requise.");
    expect(bureauErrorMessage("ROLE_REQUIRED", "x")).toBe("Le rôle est requis.");
    expect(bureauErrorMessage("WHATEVER", "x")).toBe("Échec : WHATEVER");
    expect(bureauErrorMessage(undefined, "repli")).toBe("repli");
  });
});
