import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/staff-audit");

import { publishStaffAction } from "@/lib/server/staff-audit";
import { publishRolesChange, ROLES_CHANGE_DISCORD_LINE } from "@/lib/server/users/roles";

/** ADMIN-SELF-ROLES : tout enregistrement de rôles passe au journal du staff. */
describe("publishRolesChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("publishRolesChange_otherAccount_discordLineNamesNoAccountAndPm2LineNamesTarget", () => {
    publishRolesChange({ id: 1, pseudo: "Test_Admin" }, 7, ["ARBITRE"]);

    expect(publishStaffAction).toHaveBeenCalledWith(
      ROLES_CHANGE_DISCORD_LINE,
      { id: 1, pseudo: "Test_Admin" },
      "🛡️ Rôles de plateforme du compte #7 enregistrés : Arbitre.",
    );
  });

  it("publishRolesChange_ownAccount_pm2LineSaysOwnAccount", () => {
    publishRolesChange({ id: 1, pseudo: "Test_Admin" }, 1, ["ADMIN"]);

    const [, , auditLine] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(auditLine).toBe("🛡️ Rôles de plateforme de son propre compte (#1) enregistrés : Administrateur.");
  });

  it("publishRolesChange_discordLine_carriesNeitherPseudoNorIdentifier", () => {
    expect(ROLES_CHANGE_DISCORD_LINE).not.toMatch(/#\d/);
    expect(ROLES_CHANGE_DISCORD_LINE).toBe("🛡️ Rôles de plateforme d'un compte modifiés par le staff.");
  });
});
