import { describe, expect, it } from "@jest/globals";
import { hasVisibleName, shownEntityName } from "@/lib/shared/entity-fallback-name";

/**
 * Un ancien nom fait seulement de caractères invisibles (laissé tel quel par
 * `cleanStoredNames`) rendait un lien ou un titre sans texte : il s'affiche
 * « Équipe #id » / « Joueur #id » dans la langue de la page.
 */
const INVISIBLE = "\u200B\u2060\u202E";

describe("hasVisibleName", () => {
  it("hasVisibleName_ordinaryName_returnsTrue", () => {
    expect(hasVisibleName("Les Glaciers")).toBe(true);
  });

  it("hasVisibleName_invisibleOnly_returnsFalse", () => {
    expect(hasVisibleName(INVISIBLE)).toBe(false);
  });

  it("hasVisibleName_blankOrMissing_returnsFalse", () => {
    expect(hasVisibleName("   ")).toBe(false);
    expect(hasVisibleName(null)).toBe(false);
    expect(hasVisibleName(undefined)).toBe(false);
  });
});

describe("shownEntityName", () => {
  it("shownEntityName_visibleName_returnsItUnchanged", () => {
    expect(shownEntityName("Nova", "player", 4, "fr")).toBe("Nova");
  });

  it("shownEntityName_invisibleTeamNameFr_returnsTeamNumber", () => {
    expect(shownEntityName(INVISIBLE, "team", 12, "fr")).toBe("Équipe #12");
  });

  it("shownEntityName_invisiblePlayerNameEn_returnsPlayerNumber", () => {
    expect(shownEntityName(INVISIBLE, "player", 7, "en")).toBe("Player #7");
  });
});
