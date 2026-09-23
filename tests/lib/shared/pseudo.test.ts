import { describe, expect, it } from "@jest/globals";
import { PSEUDO_MAX_LENGTH, pseudoLength } from "@/lib/shared/pseudo";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("pseudo — bornes de la colonne", () => {
  it("suit la largeur de `bg_users.pseudo`", () => {
    const schema = readFileSync(join(__dirname, "..", "..", "..", "lib", "server", "database.ts"), "utf8");
    expect(schema).toContain(`pseudo VARCHAR(${PSEUDO_MAX_LENGTH}) NOT NULL UNIQUE`);
  });

  it("compte en caractères, comme MySQL, et non en unités UTF-16", () => {
    expect(pseudoLength("Nova")).toBe(4);
    expect("🎮".length).toBe(2);
    expect(pseudoLength("🎮")).toBe(1);
    expect(pseudoLength("🎮".repeat(PSEUDO_MAX_LENGTH))).toBe(PSEUDO_MAX_LENGTH);
  });
});
