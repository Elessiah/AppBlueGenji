import { describe, expect, it } from "@jest/globals";
import { DEFAULT_PRESS_EMAIL, validatePressEmail, PRESS_EMAIL_MAX } from "@/lib/shared/contact";

describe("validatePressEmail", () => {
  it("accepts and normalises a valid address", () => {
    const res = validatePressEmail("  Presse@BlueGenji-Esport.FR  ");
    expect(res).toEqual({ ok: true, value: "presse@bluegenji-esport.fr" });
  });

  it("rejects an empty value", () => {
    expect(validatePressEmail("")).toEqual({ ok: false, error: "EMAIL_REQUIRED" });
    expect(validatePressEmail("   ")).toEqual({ ok: false, error: "EMAIL_REQUIRED" });
    expect(validatePressEmail(null)).toEqual({ ok: false, error: "EMAIL_REQUIRED" });
  });

  it.each(["plainaddress", "no@domain", "@no-local.fr", "spaces in@mail.fr", "two@@at.fr"])(
    "rejects malformed address %s",
    (bad) => {
      expect(validatePressEmail(bad)).toEqual({ ok: false, error: "EMAIL_INVALID" });
    },
  );

  it("rejects an over-long address", () => {
    const long = `${"a".repeat(PRESS_EMAIL_MAX)}@x.fr`;
    expect(validatePressEmail(long)).toEqual({ ok: false, error: "EMAIL_TOO_LONG" });
  });

  it("ships a sensible default fallback", () => {
    expect(validatePressEmail(DEFAULT_PRESS_EMAIL).ok).toBe(true);
  });
});
