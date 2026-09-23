import { describe, expect, it } from "@jest/globals";
import {
  INVALID_TEAM_NAME,
  TEAM_NAME_MAX_LENGTH,
  TEAM_NAME_MIN_LENGTH,
  checkTeamName,
  teamNameLength,
} from "@/lib/shared/team-name";

describe("checkTeamName", () => {
  it("accepte un nom dans les bornes, sans ses espaces de bordure", () => {
    expect(checkTeamName("  Dragon Squad  ")).toEqual({ ok: true, name: "Dragon Squad" });
  });

  it.each([
    ["vide", ""],
    ["blanc", "    "],
    ["absent", undefined],
    ["null", null],
    ["trop court", "ab"],
    ["trop court une fois rogné", "  ab  "],
  ])("refuse un nom %s", (_label, raw) => {
    expect(checkTeamName(raw as string | null | undefined)).toEqual({ ok: false, reason: INVALID_TEAM_NAME });
  });

  it("accepte les bornes exactes", () => {
    expect(checkTeamName("a".repeat(TEAM_NAME_MIN_LENGTH)).ok).toBe(true);
    expect(checkTeamName("a".repeat(TEAM_NAME_MAX_LENGTH)).ok).toBe(true);
  });

  it("refuse un caractère de trop", () => {
    expect(checkTeamName("a".repeat(TEAM_NAME_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it("compte les caractères comme MySQL, pas les unités UTF-16", () => {
    // Un emoji vaut deux unités en JavaScript, un caractère dans un VARCHAR
    // utf8mb4 : `String.length` refuserait un nom que la colonne accepte.
    const name = "🐉".repeat(TEAM_NAME_MAX_LENGTH);
    expect(name.length).toBe(TEAM_NAME_MAX_LENGTH * 2);
    expect(teamNameLength(name)).toBe(TEAM_NAME_MAX_LENGTH);
    expect(checkTeamName(name).ok).toBe(true);
  });

  it("garde les bornes de la création (3 à 60)", () => {
    expect(TEAM_NAME_MIN_LENGTH).toBe(3);
    expect(TEAM_NAME_MAX_LENGTH).toBe(60);
  });
});
