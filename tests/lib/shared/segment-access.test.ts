import { describe, expect, it } from "@jest/globals";
import { segmentAccess } from "@/lib/shared/segment-access";

/** Accès d'un segment réservé, lu à la fois par l'onglet et par la mise en page. */
type Reader = { roles: string[] };
const isStaff = (reader: Reader) => reader.roles.includes("STAFF");

describe("segmentAccess", () => {
  it("segmentAccess_noUser_anonymous", () => {
    expect(segmentAccess<Reader>(null, isStaff)).toBe("anonymous");
  });

  it("segmentAccess_userWithoutPermission_denied", () => {
    expect(segmentAccess({ roles: [] }, isStaff)).toBe("denied");
  });

  it("segmentAccess_userWithPermission_allowed", () => {
    expect(segmentAccess({ roles: ["STAFF"] }, isStaff)).toBe("allowed");
  });
});
