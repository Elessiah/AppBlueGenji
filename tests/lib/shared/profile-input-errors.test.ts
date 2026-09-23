import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_INPUT_ERRORS, isProfileInputError } from "@/lib/shared/profile-input-errors";
import { profileErrorMessage } from "@/app/(secured)/profil/profile-errors";

const ROOT = join(__dirname, "..", "..", "..");

/**
 * Une liste, deux lecteurs : la route ne laisse sortir que ces codes, l'écran
 * leur doit une phrase. Recopiée des deux côtés, elle dériverait au premier
 * refus ajouté.
 */
describe("PROFILE_INPUT_ERRORS", () => {
  it("a une phrase propre pour chaque code, jamais le repli", () => {
    for (const code of PROFILE_INPUT_ERRORS) {
      expect(profileErrorMessage(code)).not.toBe(profileErrorMessage("BOOM"));
    }
  });

  it("reconnaît ses codes et eux seuls", () => {
    for (const code of PROFILE_INPUT_ERRORS) expect(isProfileInputError(code)).toBe(true);
    for (const code of ["PSEUDO_ALREADY_USED", "constructor", "", null, undefined]) {
      expect(isProfileInputError(code)).toBe(false);
    }
  });

  it("couvre tous les refus que `updateOwnProfile` lève sur une saisie", () => {
    // Tout code levé par le service est soit un refus de saisie de la liste,
    // soit l'un des conflits d'état que la route rend en 409 : un troisième
    // genre ressortirait en code générique.
    const source = readFileSync(join(ROOT, "lib", "server", "users-service.ts"), "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf("export async function updateOwnProfile(");
    // La fonction se ferme sur la première accolade en colonne 0.
    const end = source.indexOf("\n}\n", start);
    const body = source.slice(start, end);
    const thrown = [...body.matchAll(/throw new Error\("([A-Z_]+)"\)/g)].map((m) => m[1]);
    expect(thrown.length).toBeGreaterThan(0);
    const conflicts = new Set(["PSEUDO_ALREADY_USED", "ACCOUNT_DELETED", "DISCORD_TAG_LOCKED"]);
    for (const code of thrown) {
      expect(isProfileInputError(code) || conflicts.has(code)).toBe(true);
    }
  });

  it("n'est pas recopiée dans la route", () => {
    const route = readFileSync(join(ROOT, "app", "api", "profile", "route.ts"), "utf8");
    expect(route).toContain("isProfileInputError(message)");
    expect(route).not.toMatch(/"PSEUDO_EMPTY"/);
  });
});
