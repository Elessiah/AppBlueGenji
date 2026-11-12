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

  it("inviteRolesFromBody_nonStringItem_throwsInvalidRoles", () => {
    // Filtré en silence, ["TANK", 3] devenait une invitation en TANK seul —
    // et [3] une invitation sans rôle que personne n'avait choisie.
    expect(() => inviteRolesFromBody(["TANK", 3, null, { r: 1 }])).toThrow("INVALID_ROLES");
    expect(() => inviteRolesFromBody([3])).toThrow("INVALID_ROLES");
  });

  it("inviteRolesFromBody_unknownCode_throwsInvalidRoles", () => {
    expect(() => inviteRolesFromBody(["X"])).toThrow("INVALID_ROLES");
  });

  it("inviteRolesFromBody_emptyList_returnsEmpty", () => {
    expect(inviteRolesFromBody([])).toEqual([]);
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

  it("rolesListFromBody_repeatedCodes_returnsDedupedListInOrder", () => {
    expect(rolesListFromBody(["TANK", "DPS", "TANK", ...Array(5000).fill("DPS")])).toEqual(["TANK", "DPS"]);
  });

  it("rolesListFromBody_everyKnownCode_returnsList", () => {
    const all = ["OWNER", "MANAGER", "CAPITAINE", "COACH", "TANK", "DPS", "HEAL"];
    expect(rolesListFromBody(all)).toEqual(all);
  });

  it.each([
    ["unknownCode", ["PILOTE"]],
    ["numberItem", [3]],
    ["mixedValues", ["DPS", 1, "PILOTE"]],
    ["nullItem", ["DPS", null]],
    ["lowercaseCode", ["dps"]],
  ])("rolesListFromBody_%s_throwsInvalidRoles", (_label, raw) => {
    // Filtrés en silence, ces éléments laissaient une liste vide — et une
    // liste vide, permise depuis D71, effaçait les rôles du membre.
    expect(() => rolesListFromBody(raw)).toThrow("INVALID_ROLES");
  });
});
