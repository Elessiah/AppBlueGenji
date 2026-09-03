import { describe, expect, it } from "@jest/globals";
import { ERROR_MESSAGES, mapEntrantError, mapError } from "@/app/(secured)/tournois/[id]/_lib/error-map";

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

describe("mapError — inscription en lot d'engagés sans compte", () => {
  it.each([
    ["EMPTY_TEAM_SELECTION"],
    ["INVALID_TEAM_IDS"],
    ["TOO_MANY_TEAMS"],
    ["NOT_A_GHOST_TEAM"],
    ["TEAM_ALREADY_DELETED"],
    ["TEAM_NOT_FOUND"],
    ["GHOST_TEAMS_LOAD_FAILED"],
    ["GHOST_TEAM_CREATE_FAILED"],
    ["GHOST_REGISTRATION_FAILED"],
  ])("traduit %s", (code) => {
    expect(mapError(code)).not.toBe(code);
  });

  it("dit qu'un lot refusé n'a rien enregistré", () => {
    // Le lot est tout ou rien : sans cette précision, le staff ne sait pas s'il
    // doit reprendre toute sa sélection ou seulement la fin.
    for (const code of ["NOT_A_GHOST_TEAM", "TEAM_ALREADY_DELETED", "GHOST_REGISTRATION_FAILED"]) {
      expect(mapError(code)).toMatch(/n'a été enregistré|rien n'a été enregistré/);
    }
  });
});

describe("mapEntrantError", () => {
  it("met le nom de l'engagé en tête du message", () => {
    expect(mapEntrantError("ALREADY_REGISTERED", "Les Fantômes")).toBe(
      `Les Fantômes — ${mapError("ALREADY_REGISTERED")}`,
    );
  });

  it("retombe sur le message seul quand le refus ne nomme personne", () => {
    expect(mapEntrantError("TOURNAMENT_FULL", null)).toBe(mapError("TOURNAMENT_FULL"));
  });

  it("traduit toujours le code, nom ou pas", () => {
    expect(mapEntrantError("REGISTRATION_CLOSED", "Alpha")).not.toContain("REGISTRATION_CLOSED");
  });
});
