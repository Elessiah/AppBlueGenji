import { describe, expect, it } from "@jest/globals";
import {
  DELETED_PLAYER_PAGE_TITLE,
  PLAYER_PAGE_FALLBACK_TITLE,
  TEAM_PAGE_FALLBACK_TITLE,
  parseEntityPageId,
  playerPageTitle,
  teamPageTitle,
} from "@/lib/shared/entity-page-titles";

/**
 * Titres d'onglet des fiches (WCAG 2.4.2) : deux onglets sur deux fiches
 * portaient le même titre, hérité de l'annuaire.
 */

describe("teamPageTitle", () => {
  it("nomme l'équipe, puis la nature de la page", () => {
    expect(teamPageTitle({ name: "Dragon Squad" })).toBe("Dragon Squad · Équipe");
  });

  it("donne un titre distinct à deux équipes", () => {
    expect(teamPageTitle({ name: "Alpha" })).not.toBe(teamPageTitle({ name: "Beta" }));
  });

  it("retombe sur le titre générique sans équipe à nommer", () => {
    expect(teamPageTitle(null)).toBe(TEAM_PAGE_FALLBACK_TITLE);
  });

  it("ne rend pas un titre qui commence par un séparateur quand le nom est vide", () => {
    expect(teamPageTitle({ name: "   " })).toBe(TEAM_PAGE_FALLBACK_TITLE);
  });

  it("rogne les espaces du nom", () => {
    expect(teamPageTitle({ name: "  Nova  " })).toBe("Nova · Équipe");
  });
});

describe("playerPageTitle", () => {
  it("nomme le joueur par son pseudo", () => {
    expect(playerPageTitle({ pseudo: "Nova", isDeleted: false })).toBe("Nova · Joueur");
  });

  it("tait le pseudo d'emprunt d'un compte anonymisé", () => {
    const title = playerPageTitle({ pseudo: "Renard_Discret", isDeleted: true });
    expect(title).toBe(`${DELETED_PLAYER_PAGE_TITLE} · ${PLAYER_PAGE_FALLBACK_TITLE}`);
    expect(title).not.toContain("Renard_Discret");
  });

  it("retombe sur le titre générique sans joueur à nommer", () => {
    expect(playerPageTitle(null)).toBe(PLAYER_PAGE_FALLBACK_TITLE);
  });

  it("retombe sur le titre générique quand le pseudo est vide", () => {
    expect(playerPageTitle({ pseudo: "", isDeleted: false })).toBe(PLAYER_PAGE_FALLBACK_TITLE);
  });
});

describe("parseEntityPageId", () => {
  it.each<[string, number]>([
    ["1", 1],
    ["42", 42],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ])("lit %s", (raw, expected) => {
    expect(parseEntityPageId(raw)).toBe(expected);
  });

  it.each(["0", "-3", "01", "1.5", "1e3", " 7", "7 ", "abc", "", "0x10", "9007199254740993"])(
    "refuse « %s »",
    (raw) => {
      expect(parseEntityPageId(raw)).toBeNull();
    },
  );
});
