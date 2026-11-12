import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { invitationRoles } from "@/lib/server/teams/invitations";

/**
 * Rôles lus d'une invitation stockée : `null` (défaut DPS à l'arrivée), une
 * liste vide voulue (D71), ou les codes connus qu'elle porte.
 */
describe("invitationRoles", () => {
  it("invitationRoles_null_returnsNull", () => {
    expect(invitationRoles(null)).toBeNull();
  });

  it("invitationRoles_emptyArray_returnsEmpty", () => {
    expect(invitationRoles([])).toEqual([]);
  });

  it("invitationRoles_emptyJsonText_returnsEmpty", () => {
    expect(invitationRoles("[]")).toEqual([]);
  });

  it("invitationRoles_unknownCodesOnlyArray_returnsNull", () => {
    expect(invitationRoles(["PILOTE"])).toBeNull();
  });

  it("invitationRoles_unknownCodesOnlyJsonText_returnsNull", () => {
    expect(invitationRoles('["PILOTE"]')).toBeNull();
  });

  it("invitationRoles_mixedCodes_keepsKnownOnly", () => {
    expect(invitationRoles(["PILOTE", "TANK"])).toEqual(["TANK"]);
  });

  it("invitationRoles_invalidJsonText_returnsNull", () => {
    expect(invitationRoles("{oops")).toBeNull();
  });
});
