import { describe, expect, it } from "@jest/globals";
import { ERROR_MESSAGES, mapError } from "@/app/(secured)/tournois/[id]/_lib/error-map";

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

/**
 * Régression : une fusion mal résolue avait transformé les entrées
 * `TOURNAMENT_DELETE_FAILED` / `INVALID_TOURNAMENT_ID` / `INVALID_ID` en
 * commentaire, les faisant disparaître silencieusement de la table sans
 * qu'aucun test ni le typage ne s'en aperçoive.
 */
describe("mapError — suppression et identifiants invalides", () => {
  it.each([
    ["TOURNAMENT_DELETE_FAILED"],
    ["INVALID_TOURNAMENT_ID"],
    ["INVALID_ID"],
  ])("traduit %s", (code) => {
    const message = mapError(code);
    expect(message).not.toBe(code);
    expect(message.length).toBeGreaterThan(0);
  });
});

/**
 * Garde-fou générique : le bug ci-dessus n'était pas propre à ces trois
 * codes — n'importe quelle entrée peut être avalée par un commentaire lors
 * d'une future fusion. On vérifie donc que chaque clé réellement exposée par
 * le module se traduit bien (aucune clé ne « retombe » sur elle-même) et que
 * le nombre d'entrées n'a pas chuté.
 */
describe("mapError — intégrité de la table", () => {
  const codes = Object.keys(ERROR_MESSAGES);

  it("ne contient pas moins d'entrées qu'attendu", () => {
    expect(codes.length).toBeGreaterThanOrEqual(45);
  });

  it.each(codes.map((code) => [code]))("traduit %s sans le renvoyer tel quel", (code) => {
    expect(mapError(code)).not.toBe(code);
  });
});
