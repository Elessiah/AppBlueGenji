import { describe, expect, it } from "@jest/globals";
import {
  ERROR_MESSAGES,
  mapBatchError,
  mapEntrantError,
  mapError,
} from "@/app/(secured)/tournois/[id]/_lib/error-map";
import { REGISTRATION_FILTER_ERRORS } from "@/lib/shared/registration-filters";

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

});

describe("mapBatchError", () => {
  it("dit qu'un lot refusé n'a rien enregistré", () => {
    // Le tout-ou-rien doit se lire dans la phrase : sans cette précision, le
    // staff ne sait pas s'il doit reprendre toute sa sélection ou seulement la
    // fin. Ces mêmes codes servent aussi à l'inscription d'un seul, d'où la
    // précision ajoutée ici et non dans la table.
    for (const code of ["TOURNAMENT_FULL", "ALREADY_REGISTERED", "REGISTRATION_CLOSED"]) {
      expect(mapBatchError(code, null, 25)).toBe(`${mapError(code)} Rien n'a été enregistré.`);
    }
  });

  it("se tait sur un lot d'un seul, où la précision n'apprend rien", () => {
    expect(mapBatchError("TOURNAMENT_FULL", null, 1)).toBe(mapError("TOURNAMENT_FULL"));
    expect(mapBatchError("TOURNAMENT_FULL", null, 0)).toBe(mapError("TOURNAMENT_FULL"));
  });

  it("nomme l'engagé et précise, quand le refus fait les deux", () => {
    expect(mapBatchError("ALREADY_REGISTERED", "Alpha", 4)).toBe(
      `Alpha — ${mapError("ALREADY_REGISTERED")} Rien n'a été enregistré.`,
    );
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

/**
 * Les refus des conditions d'inscription.
 *
 * Cinq codes, cinq messages distincts : chacun doit nommer **le geste qui le
 * lève** (recruter, certifier un tag, rattacher un compte Blizzard), faute de
 * quoi le capitaine ne sait pas laquelle des trois conditions a bloqué.
 *
 * `mapError` rend le code lui-même quand il ne le connaît pas : un refus oublié
 * ici ne casse rien, il s'affiche en capitales dans un toast. D'où le balayage
 * de `REGISTRATION_FILTER_ERRORS`, qui ferme le cas pour tout refus ajouté
 * demain.
 */
describe("conditions d'inscription", () => {
  it("dit de recruter quand l'effectif manque", () => {
    expect(mapError("TEAM_TOO_FEW_PLAYERS")).toMatch(/recrute/i);
  });

  it("distingue « au moins un » de « tous », et renvoie au profil", () => {
    const any = mapError("TEAM_NEEDS_VERIFIED_DISCORD");
    const all = mapError("TEAM_NEEDS_ALL_VERIFIED_DISCORD");

    expect(any).toMatch(/au moins un/i);
    expect(all).toMatch(/tous/i);
    expect(any).not.toBe(all);
    for (const message of [any, all]) {
      // Le geste se fait sur sa fiche de profil : le message doit y mener.
      expect(message).toMatch(/profil/i);
    }
  });

  it("distingue les deux refus Blizzard, et renvoie au profil", () => {
    const any = mapError("TEAM_NEEDS_LINKED_BLIZZARD");
    const all = mapError("TEAM_NEEDS_ALL_LINKED_BLIZZARD");

    expect(any).toMatch(/au moins un/i);
    expect(all).toMatch(/tous/i);
    expect(any).not.toBe(all);
    for (const message of [any, all]) {
      expect(message).toMatch(/blizzard/i);
      expect(message).toMatch(/profil/i);
    }
  });

  it("ne confond pas un refus Discord avec un refus Blizzard", () => {
    // Les quatre messages se ressemblent par construction (« au moins un » /
    // « tous ») : ce qui les sépare est le geste, et il doit se lire.
    expect(mapError("TEAM_NEEDS_VERIFIED_DISCORD")).not.toMatch(/blizzard/i);
    expect(mapError("TEAM_NEEDS_ALL_VERIFIED_DISCORD")).not.toMatch(/blizzard/i);
    expect(mapError("TEAM_NEEDS_LINKED_BLIZZARD")).not.toMatch(/discord/i);
    expect(mapError("TEAM_NEEDS_ALL_LINKED_BLIZZARD")).not.toMatch(/discord/i);
  });

  it("traduit chaque refus que le module pur peut rendre", () => {
    for (const code of REGISTRATION_FILTER_ERRORS) {
      expect(mapError(code)).not.toContain(code);
    }
  });

  it("ne laisse sortir aucun code brut", () => {
    for (const code of [
      "TEAM_TOO_FEW_PLAYERS",
      "TEAM_NEEDS_VERIFIED_DISCORD",
      "TEAM_NEEDS_ALL_VERIFIED_DISCORD",
      "TEAM_NEEDS_LINKED_BLIZZARD",
      "TEAM_NEEDS_ALL_LINKED_BLIZZARD",
      "INVALID_DISCORD_REQUIREMENT",
      "INVALID_BLIZZARD_REQUIREMENT",
      "INVALID_MIN_PLAYERS",
    ]) {
      expect(mapError(code)).not.toContain(code);
    }
  });
});

/**
 * Les deux refus du panneau de contacts.
 *
 * `mapError` rend le code lui-même quand il ne le connaît pas, si bien qu'un
 * refus oublié ici ne casse rien : il s'affiche en capitales dans un toast. Les
 * **deux** refus de `GET /api/admin/tournaments/[id]/contacts` doivent donc y
 * figurer — le second (`TOURNAMENT_FINISHED`) est atteignable même si le panneau
 * n'est pas rendu sur un tournoi clos, la clôture pouvant tomber entre le rendu
 * et le clic.
 */
describe("contacts d'un plateau", () => {
  it("traduit les deux refus de la route, sans laisser sortir leur code", () => {
    for (const code of ["CONTACTS_LOAD_FAILED", "TOURNAMENT_FINISHED"]) {
      const message = mapError(code);
      expect(message).not.toContain(code);
      expect(message).not.toBe(code);
    }
  });

  it("dit que le tournoi est terminé, et non qu'un droit manque", () => {
    // Le refus n'est pas une question de permission : l'arbitre a bien le droit,
    // c'est la fenêtre qui s'est fermée. Un « tu n'as pas les droits » l'enverrait
    // demander un rôle qu'il détient déjà.
    expect(mapError("TOURNAMENT_FINISHED")).toMatch(/termin/i);
    expect(mapError("TOURNAMENT_FINISHED")).not.toMatch(/droit/i);
  });
});
