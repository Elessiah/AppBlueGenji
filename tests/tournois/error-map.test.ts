import { describe, expect, it } from "@jest/globals";
import { mapError } from "@/app/(secured)/tournois/[id]/_lib/error-map";

/**
 * Les codes que le serveur renvoie réellement doivent tous avoir une phrase
 * française : `mapError` retombe sinon sur le code brut, qui finit tel quel
 * dans le toast.
 */
describe("mapError — inscription", () => {
  it.each([
    ["ALREADY_REGISTERED"],
    ["REGISTRATION_CLOSED"],
    ["TOURNAMENT_FULL"],
    ["NO_ACTIVE_TEAM"],
    ["SOLO_ENTRY_NAME_UNAVAILABLE"],
    ["USER_NOT_FOUND"],
  ])("traduit %s", (code) => {
    const message = mapError(code);
    expect(message).not.toBe(code);
    expect(message).toMatch(/[a-zà-ÿ]/);
  });

  it("laisse passer un code inconnu tel quel", () => {
    expect(mapError("WAT")).toBe("WAT");
  });
});
