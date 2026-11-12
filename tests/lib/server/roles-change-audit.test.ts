import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/staff-audit");

import { publishStaffAction } from "@/lib/server/staff-audit";
import {
  ADMIN_GRANTED_DISCORD_LINE,
  ADMIN_REMOVED_DISCORD_LINE,
  publishRolesChange,
  ROLES_CHANGE_DISCORD_LINE,
} from "@/lib/server/users/roles";

/** ADMIN-SELF-ROLES : tout enregistrement qui change des rôles passe au journal du staff. */
describe("publishRolesChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("publishRolesChange_noRoleChanged_publishesNothing", () => {
    const published = publishRolesChange({ id: 1, pseudo: "Test_Admin" }, 7, {
      roles: ["ARBITRE", "CASTER"],
      previous: ["CASTER", "ARBITRE"],
    });

    expect(published).toBe(false);
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("publishRolesChange_scopedRoleGranted_genericDiscordLineAndDiffInPm2Line", () => {
    const published = publishRolesChange({ id: 1, pseudo: "Test_Admin" }, 7, { roles: ["ARBITRE"], previous: [] });

    expect(published).toBe(true);
    expect(publishStaffAction).toHaveBeenCalledWith(
      ROLES_CHANGE_DISCORD_LINE,
      { id: 1, pseudo: "Test_Admin" },
      {
        auditLine: "🛡️ Rôles de plateforme du compte #7 — accordés : Arbitre ; retirés : aucun ; enregistrés : Arbitre.",
        category: "admin",
      },
    );
  });

  it("publishRolesChange_adminGranted_usesAdminGrantedDiscordLine", () => {
    publishRolesChange({ id: 1, pseudo: "Test_Admin" }, 7, { roles: ["ADMIN", "ARBITRE"], previous: ["ARBITRE"] });

    const [line] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(line).toBe(ADMIN_GRANTED_DISCORD_LINE);
  });

  it("publishRolesChange_adminRemoved_usesAdminRemovedDiscordLine", () => {
    publishRolesChange({ id: 1, pseudo: "Test_Admin" }, 7, { roles: ["CASTER"], previous: ["ADMIN"] });

    const [line] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(line).toBe(ADMIN_REMOVED_DISCORD_LINE);
  });

  it("publishRolesChange_ownAccount_pm2LineSaysOwnAccount", () => {
    publishRolesChange({ id: 1, pseudo: "Test_Admin" }, 1, { roles: ["ADMIN", "CASTER"], previous: ["ADMIN"] });

    const [, , { auditLine }] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(auditLine).toBe(
      "🛡️ Rôles de plateforme de son propre compte (#1) — accordés : Caster ; retirés : aucun ; enregistrés : Administrateur, Caster.",
    );
  });

  it("discordLines_carryNeitherPseudoNorIdentifier", () => {
    expect(ROLES_CHANGE_DISCORD_LINE).toBe("🛡️ Rôles de plateforme d'un compte modifiés par le staff.");
    expect(ADMIN_GRANTED_DISCORD_LINE).toBe("🛡️ Administration de la plateforme accordée à un compte par le staff.");
    expect(ADMIN_REMOVED_DISCORD_LINE).toBe("🛡️ Administration de la plateforme retirée à un compte par le staff.");
    expect([ROLES_CHANGE_DISCORD_LINE, ADMIN_GRANTED_DISCORD_LINE, ADMIN_REMOVED_DISCORD_LINE].join(" ")).not.toMatch(
      /#\d/,
    );
  });
});
