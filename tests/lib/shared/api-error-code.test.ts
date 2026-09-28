import { describe, expect, it } from "@jest/globals";

import {
  INTERNAL_ERROR,
  INVALID_REQUEST,
  isPublicErrorCode,
  publicErrorCode,
} from "@/lib/shared/api-error-code";

/**
 * Ce qu'une réponse d'erreur peut dire : un code, jamais un message
 * d'exception — une erreur mysql2 nomme base, table et contrainte.
 */
describe("publicErrorCode", () => {
  it.each(["TEAM_NOT_FOUND", "TOO_MANY_CODE_REQUESTS_TODAY", "E2", "MATCH_FORMAT_V2_INVALID"])(
    "laisse passer le code %s",
    (code) => {
      expect(isPublicErrorCode(code)).toBe(true);
      expect(publicErrorCode(code, 500)).toBe(code);
    },
  );

  it.each([
    ["une erreur mysql2", "Table 'bluegenji.bg_users' doesn't exist"],
    ["un refus d'accès", "Access denied for user 'app'@'localhost'"],
    ["une connexion refusée", "connect ECONNREFUSED 127.0.0.1:3306"],
    ["une erreur de lecture JSON", "Unexpected token } in JSON at position 12"],
    ["un message en minuscules", "something went wrong"],
    ["un code préfixé d'un détail", "ER_DUP_ENTRY: Duplicate entry 'x' for key 'uniq'"],
    ["une chaîne vide", ""],
    ["une seule lettre", "X"],
    ["un code démesuré", "A".repeat(65)],
  ])("remplace %s", (_label, message) => {
    expect(isPublicErrorCode(message)).toBe(false);
    expect(publicErrorCode(message, 500)).toBe(INTERNAL_ERROR);
  });

  it("dit seulement de quel côté est la faute", () => {
    expect(publicErrorCode("boom", 400)).toBe(INVALID_REQUEST);
    expect(publicErrorCode("boom", 404)).toBe(INVALID_REQUEST);
    expect(publicErrorCode("boom", 500)).toBe(INTERNAL_ERROR);
    expect(publicErrorCode("boom", 503)).toBe(INTERNAL_ERROR);
  });

  it("refuse ce qui n'est pas une chaîne", () => {
    expect(isPublicErrorCode(undefined)).toBe(false);
    expect(isPublicErrorCode(42)).toBe(false);
    expect(publicErrorCode(undefined, 500)).toBe(INTERNAL_ERROR);
  });
});
