import { describe, expect, it } from "@jest/globals";
import { inviteRolesFromBody, rolesListFromBody } from "@/lib/server/team-invite-roles";

describe("inviteRolesFromBody", () => {
  it("lit une absence comme « pas de choix » : le service posera son défaut", () => {
    expect(inviteRolesFromBody(undefined)).toBeUndefined();
    expect(inviteRolesFromBody(null)).toBeUndefined();
  });

  it("transmet une liste, que le service assainira", () => {
    expect(inviteRolesFromBody(["TANK", "MANAGER"])).toEqual(["TANK", "MANAGER"]);
  });

  it("écarte ce qui n'est pas une chaîne", () => {
    expect(inviteRolesFromBody(["TANK", 3, null, { r: 1 }])).toEqual(["TANK"]);
  });

  it.each([["une chaîne", "DPS"], ["un nombre", 4], ["un objet", { roles: ["DPS"] }]])(
    "refuse %s (INVALID_ROLES), jamais lu comme le défaut ni comme « aucun rôle »",
    (_label, raw) => {
      // Une valeur malformée n'est ni une absence ni un choix : la lire comme
      // l'un ou l'autre ferait arriver le joueur en DPS, ou sans rôle, sans que
      // personne ne l'ait voulu.
      expect(() => inviteRolesFromBody(raw)).toThrow("INVALID_ROLES");
    },
  );
});

describe("rolesListFromBody", () => {
  it.each([["absente", undefined], ["nulle", null]])(
    "rolesListFromBody_%sList_throwsInvalidRoles",
    (_label, raw) => {
      // Une liste absente ne vaut plus « aucun rôle » : elle effacerait ceux du membre.
      expect(() => rolesListFromBody(raw)).toThrow("INVALID_ROLES");
    },
  );

  it("rolesListFromBody_emptyArray_returnsEmpty", () => {
    expect(rolesListFromBody([])).toEqual([]);
  });

  it("rolesListFromBody_mixedValues_keepsStringsOnly", () => {
    expect(rolesListFromBody(["DPS", 1, "PILOTE"])).toEqual(["DPS", "PILOTE"]);
  });
});
