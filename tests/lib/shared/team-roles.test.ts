import { describe, expect, it } from "@jest/globals";
import type { TeamRole } from "@/lib/shared/types";
import { hasTeamManagementRole, TEAM_MANAGEMENT_ROLES } from "@/lib/shared/team-roles";

describe("hasTeamManagementRole", () => {
  it.each([["OWNER"], ["MANAGER"]] as [TeamRole][])("accorde la main à %s", (role) => {
    expect(hasTeamManagementRole([role])).toBe(true);
  });

  it.each([["CAPITAINE"], ["COACH"], ["TANK"], ["DPS"], ["HEAL"]] as [TeamRole][])(
    "la refuse à %s : jouer pour une équipe n'est pas la diriger",
    (role) => {
      expect(hasTeamManagementRole([role])).toBe(false);
    },
  );

  it("suffit d'un rôle de gestion dans un cumul", () => {
    expect(hasTeamManagementRole(["DPS", "COACH", "MANAGER"])).toBe(true);
  });

  it("refuse un cumul entièrement sportif", () => {
    expect(hasTeamManagementRole(["CAPITAINE", "TANK", "COACH"])).toBe(false);
  });

  it.each([[[]], [null], [undefined]])("refuse %j", (roles) => {
    expect(hasTeamManagementRole(roles as TeamRole[] | null | undefined)).toBe(false);
  });

  it("expose exactement les deux rôles de gestion", () => {
    // La liste est publique : un rôle ajouté ici élargit le droit d'engager une
    // équipe autant que celui de conduire son roster.
    expect(TEAM_MANAGEMENT_ROLES).toEqual(["OWNER", "MANAGER"]);
  });
});
