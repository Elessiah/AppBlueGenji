import { describe, expect, it } from "@jest/globals";
import {
  TEAM_TAG_ALREADY_USED,
  TEAM_TAG_MAX_LENGTH,
  TEAM_TAG_MIN_LENGTH,
  checkTeamTag,
  displayTeamTag,
  isTeamTagRejection,
  normalizeTeamTag,
  teamTagErrorMessage,
} from "@/lib/shared/team-tag";

/**
 * Règle de forme du sigle d'équipe — l'unique implémentation, partagée par les
 * formulaires et par le serveur. Ce qui se joue ici : la borne basse (2, pas 1
 * ni 3), la borne haute (4, pas 3), le jeu de caractères, et le fait qu'une
 * saisie vide **n'est pas** une erreur mais l'absence de sigle.
 */

describe("normalizeTeamTag", () => {
  it("met en majuscules et retire les espaces de bordure", () => {
    expect(normalizeTeamTag("  bg  ")).toBe("BG");
    expect(normalizeTeamTag("Bg")).toBe("BG");
  });

  it("rend la chaîne vide pour une saisie absente", () => {
    expect(normalizeTeamTag(null)).toBe("");
    expect(normalizeTeamTag(undefined)).toBe("");
    expect(normalizeTeamTag("   ")).toBe("");
  });
});

describe("checkTeamTag — bornes", () => {
  it("accepte la borne basse (2) et la borne haute (4)", () => {
    expect(checkTeamTag("BG")).toEqual({ ok: true, tag: "BG" });
    expect(checkTeamTag("DRGN")).toEqual({ ok: true, tag: "DRGN" });
  });

  it("accepte la longueur intermédiaire (3), l'ancien « trigramme »", () => {
    expect(checkTeamTag("DRA")).toEqual({ ok: true, tag: "DRA" });
  });

  it("refuse un seul caractère", () => {
    expect(checkTeamTag("B")).toEqual({ ok: false, reason: "TEAM_TAG_TOO_SHORT" });
  });

  it("refuse cinq caractères", () => {
    expect(checkTeamTag("DRGNS")).toEqual({ ok: false, reason: "TEAM_TAG_TOO_LONG" });
  });

  it("compte la longueur après normalisation, pas sur la saisie brute", () => {
    // « bg » entouré d'espaces fait 6 caractères bruts et 2 une fois normalisé.
    expect(checkTeamTag("  bg  ")).toEqual({ ok: true, tag: "BG" });
  });

  it("expose des bornes cohérentes avec ce qu'il accepte", () => {
    expect(TEAM_TAG_MIN_LENGTH).toBe(2);
    expect(TEAM_TAG_MAX_LENGTH).toBe(4);
    expect(checkTeamTag("X".repeat(TEAM_TAG_MIN_LENGTH)).ok).toBe(true);
    expect(checkTeamTag("X".repeat(TEAM_TAG_MAX_LENGTH)).ok).toBe(true);
    expect(checkTeamTag("X".repeat(TEAM_TAG_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe("checkTeamTag — absence de sigle", () => {
  it.each([null, undefined, "", "   "])("traite %p comme « pas de sigle », sans erreur", (raw) => {
    expect(checkTeamTag(raw)).toEqual({ ok: true, tag: null });
  });
});

describe("checkTeamTag — jeu de caractères", () => {
  it("accepte les chiffres, seuls ou mêlés aux lettres", () => {
    expect(checkTeamTag("42")).toEqual({ ok: true, tag: "42" });
    expect(checkTeamTag("ST01")).toEqual({ ok: true, tag: "ST01" });
  });

  it.each([
    ["un espace intérieur", "B G"],
    ["un tiret", "B-G"],
    ["un point", "B.G"],
    ["une apostrophe", "B'G"],
    ["un accent", "BÉG"],
    ["une cédille", "ÇA"],
    ["un emoji", "BG🔥"],
    ["un souligné", "B_G"],
  ])("refuse %s", (_label, raw) => {
    expect(checkTeamTag(raw)).toEqual({ ok: false, reason: "TEAM_TAG_NOT_ALPHANUMERIC" });
  });

  it("signale le jeu de caractères avant la longueur", () => {
    // « BG ESPORT » est trop long *et* fautif par son espace : annoncer « trop
    // long » enverrait raccourcir plutôt que retirer l'espace.
    expect(checkTeamTag("BG ESPORT")).toEqual({
      ok: false,
      reason: "TEAM_TAG_NOT_ALPHANUMERIC",
    });
  });
});

describe("isTeamTagRejection", () => {
  it("reconnaît les trois refus de forme", () => {
    expect(isTeamTagRejection("TEAM_TAG_TOO_SHORT")).toBe(true);
    expect(isTeamTagRejection("TEAM_TAG_TOO_LONG")).toBe(true);
    expect(isTeamTagRejection("TEAM_TAG_NOT_ALPHANUMERIC")).toBe(true);
  });

  it("ne compte pas le conflit d'unicité parmi eux — il vaut 409, pas 400", () => {
    expect(isTeamTagRejection(TEAM_TAG_ALREADY_USED)).toBe(false);
    expect(isTeamTagRejection("FORBIDDEN")).toBe(false);
  });
});

describe("teamTagErrorMessage", () => {
  it("rend un message français pour chaque code de sigle", () => {
    for (const code of [
      "TEAM_TAG_TOO_SHORT",
      "TEAM_TAG_TOO_LONG",
      "TEAM_TAG_NOT_ALPHANUMERIC",
      TEAM_TAG_ALREADY_USED,
    ]) {
      const message = teamTagErrorMessage(code);
      expect(typeof message).toBe("string");
      expect(message!.length).toBeGreaterThan(10);
    }
  });

  it("cite les bornes réelles dans les messages de longueur", () => {
    expect(teamTagErrorMessage("TEAM_TAG_TOO_SHORT")).toContain(String(TEAM_TAG_MIN_LENGTH));
    expect(teamTagErrorMessage("TEAM_TAG_TOO_LONG")).toContain(String(TEAM_TAG_MAX_LENGTH));
  });

  it("rend null sur un code étranger, pour laisser l'appelant à son message", () => {
    expect(teamTagErrorMessage("TEAM_NAME_ALREADY_USED")).toBeNull();
    expect(teamTagErrorMessage("")).toBeNull();
    expect(teamTagErrorMessage(null)).toBeNull();
  });

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "ne confond pas %s avec un code de sigle",
    (inherited) => {
      // `code in MESSAGES` remonterait la chaîne de prototypes et rendrait une
      // **fonction**, que l'appelant afficherait telle quelle en toast.
      expect(teamTagErrorMessage(inherited)).toBeNull();
    },
  );
});

describe("displayTeamTag", () => {
  it("préfère le sigle quand l'équipe en a un", () => {
    expect(displayTeamTag("DRGN", "Dragon Squad")).toBe("DRGN");
  });

  it("normalise un sigle stocké en minuscules", () => {
    expect(displayTeamTag("bg", "BlueGenji")).toBe("BG");
  });

  it("retombe sur les initiales du nom, comme avant la fonctionnalité", () => {
    expect(displayTeamTag(null, "Dragon Squad")).toBe("DRA");
    expect(displayTeamTag("", "Phoenix Force")).toBe("PHO");
  });

  it("écarte du repli ce qui n'est ni lettre ni chiffre", () => {
    // « L'É » n'aurait rien dit ; l'apostrophe n'est pas une initiale.
    expect(displayTeamTag(null, "L'Équipe")).toBe("LÉQ");
    expect(displayTeamTag(null, "  Nova  ")).toBe("NOV");
  });

  it("rend un repli visible même sur un nom sans lettre ni chiffre", () => {
    expect(displayTeamTag(null, "###")).toBe("?");
    expect(displayTeamTag(null, "")).toBe("?");
  });

  it("ne rogne jamais un nom plus court que le repli", () => {
    expect(displayTeamTag(null, "OG")).toBe("OG");
  });
});
