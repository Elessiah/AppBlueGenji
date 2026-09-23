import { describe, expect, it } from "@jest/globals";
import { inviteRolesFromBody } from "@/lib/server/team-invite-roles";

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
    "lit %s comme une liste vide — donc un refus, jamais le défaut",
    (_label, raw) => {
      // Une valeur malformée n'est pas une absence : la lire comme telle ferait
      // arriver le joueur en DPS sans que personne ne l'ait choisi.
      expect(inviteRolesFromBody(raw)).toEqual([]);
    },
  );
});
