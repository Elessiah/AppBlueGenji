import { describe, expect, it } from "@jest/globals";
import { can, type Permission } from "@/lib/shared/permissions";
import {
  canImpersonate,
  IMPERSONABLE_ROLES,
  parseImpersonatedRoles,
  parsePlayerViewBody,
  PLAYER_VIEW_EXPIRY_MARGIN_MS,
  PLAYER_VIEW_MAX_HOURS,
  playerViewExpiryDelayMs,
  sessionHolds,
  sessionPlatformRights,
  toggleImpersonatedRole,
} from "@/lib/shared/player-view";

/** « Incarner un rôle » (`docs/features/ADMIN_ROLE_IMPERSONATION.md`). */
describe("canImpersonate", () => {
  it("canImpersonate_adminColumn_returnsTrue", () => {
    expect(canImpersonate({ isAdmin: true })).toBe(true);
  });

  it("canImpersonate_platformRoleWithoutAdmin_returnsFalse", () => {
    expect(canImpersonate({ isAdmin: false })).toBe(false);
  });
});

describe("IMPERSONABLE_ROLES", () => {
  it("impersonableRoles_list_excludesAdminKeepsOrder", () => {
    expect(IMPERSONABLE_ROLES).toEqual(["ARBITRE", "CASTER", "PROD", "COMMUNITY_MANAGER", "RECRUTEUR", "DEV"]);
  });
});

describe("parseImpersonatedRoles", () => {
  it("parseImpersonatedRoles_jsonString_returnsKnownRolesOrdered", () => {
    expect(parseImpersonatedRoles('["DEV","CASTER"]')).toEqual(["CASTER", "DEV"]);
  });

  it("parseImpersonatedRoles_containsAdminOrUnknown_dropsThem", () => {
    expect(parseImpersonatedRoles(["ADMIN", "PIRATE", "PROD"])).toEqual(["PROD"]);
  });

  it("parseImpersonatedRoles_invalidJson_returnsEmpty", () => {
    expect(parseImpersonatedRoles("{pas du json")).toEqual([]);
  });

  it("parseImpersonatedRoles_null_returnsEmpty", () => {
    expect(parseImpersonatedRoles(null)).toEqual([]);
  });
});

describe("sessionPlatformRights", () => {
  it("sessionPlatformRights_playerViewWithoutRoles_returnsNoRights", () => {
    expect(sessionPlatformRights({ isAdmin: true, roles: ["ADMIN", "ARBITRE"] }, true)).toEqual({
      isAdmin: false,
      roles: [],
    });
  });

  it("sessionPlatformRights_impersonatingCaster_returnsOnlyCaster", () => {
    expect(sessionPlatformRights({ isAdmin: true, roles: ["ADMIN", "ARBITRE"] }, true, '["CASTER"]')).toEqual({
      isAdmin: false,
      roles: ["CASTER"],
    });
  });

  it("sessionPlatformRights_storedAdmin_neverGrantsAdmin", () => {
    expect(sessionPlatformRights({ isAdmin: true, roles: ["ADMIN"] }, true, '["ADMIN"]')).toEqual({
      isAdmin: false,
      roles: [],
    });
  });

  it("sessionPlatformRights_playerViewOff_returnsRealRights", () => {
    expect(sessionPlatformRights({ isAdmin: false, roles: ["CASTER"] }, false, '["DEV"]')).toEqual({
      isAdmin: false,
      roles: ["CASTER"],
    });
  });
});

const ALL_PERMISSIONS: readonly Permission[] = [
  "tournaments",
  "casting",
  "live",
  "showcase",
  "recruitment",
  "roles",
  "moderation",
  "dev",
  "planning",
];

function grantedWhileImpersonating(stored: string): Permission[] {
  const session = sessionPlatformRights({ isAdmin: true, roles: ["ADMIN"] }, true, stored);
  return ALL_PERMISSIONS.filter((permission) => can(session, permission));
}

describe("can() pendant l'incarnation", () => {
  it("can_impersonatingArbitre_opensTournamentsCastingLivePlanning", () => {
    expect(grantedWhileImpersonating('["ARBITRE"]')).toEqual(["tournaments", "casting", "live", "planning"]);
  });

  it("can_impersonatingCaster_opensCastingLivePlanning", () => {
    expect(grantedWhileImpersonating('["CASTER"]')).toEqual(["casting", "live", "planning"]);
  });

  it("can_impersonatingProd_opensPlanningOnly", () => {
    expect(grantedWhileImpersonating('["PROD"]')).toEqual(["planning"]);
  });

  it("can_impersonatingCommunityManager_opensShowcaseOnly", () => {
    expect(grantedWhileImpersonating('["COMMUNITY_MANAGER"]')).toEqual(["showcase"]);
  });

  it("can_impersonatingRecruteur_opensRecruitmentOnly", () => {
    expect(grantedWhileImpersonating('["RECRUTEUR"]')).toEqual(["recruitment"]);
  });

  it("can_impersonatingDev_opensDevOnly", () => {
    expect(grantedWhileImpersonating('["DEV"]')).toEqual(["dev"]);
  });

  it("can_impersonatingCasterAndRecruteur_cumulates", () => {
    expect(grantedWhileImpersonating('["CASTER","RECRUTEUR"]')).toEqual([
      "casting",
      "live",
      "recruitment",
      "planning",
    ]);
  });

  it("can_impersonatingPlayer_opensNothing", () => {
    expect(grantedWhileImpersonating("[]")).toEqual([]);
  });
});

describe("sessionHolds", () => {
  it("sessionHolds_notImpersonating_returnsTrue", () => {
    expect(sessionHolds({ playerView: false }, "tournaments")).toBe(true);
  });

  it("sessionHolds_casterImpersonation_holdsLive", () => {
    expect(sessionHolds({ playerView: true, roles: ["CASTER"] }, "live")).toBe(true);
  });

  it("sessionHolds_casterImpersonation_doesNotHoldTournaments", () => {
    expect(sessionHolds({ playerView: true, roles: ["CASTER"] }, "tournaments")).toBe(false);
  });

  it("sessionHolds_arbitreImpersonation_holdsTournaments", () => {
    expect(sessionHolds({ playerView: true, roles: ["ARBITRE"] }, "tournaments")).toBe(true);
  });

  it("sessionHolds_playerViewWithoutRoles_returnsFalse", () => {
    expect(sessionHolds({ playerView: true }, "live")).toBe(false);
  });
});

describe("parsePlayerViewBody", () => {
  it("parsePlayerViewBody_activeTrue_returnsEmptyRoles", () => {
    expect(parsePlayerViewBody({ active: true })).toEqual({ active: true, roles: [] });
  });

  it("parsePlayerViewBody_activeFalse_returnsExit", () => {
    expect(parsePlayerViewBody({ active: false })).toEqual({ active: false, roles: [] });
  });

  it("parsePlayerViewBody_activeWithRoles_returnsOrderedRoles", () => {
    expect(parsePlayerViewBody({ active: true, roles: ["DEV", "ARBITRE"] })).toEqual({
      active: true,
      roles: ["ARBITRE", "DEV"],
    });
  });

  it("parsePlayerViewBody_rolesOnExit_returnsNull", () => {
    expect(parsePlayerViewBody({ active: false, roles: [] })).toBeNull();
  });

  it("parsePlayerViewBody_adminRole_returnsNull", () => {
    expect(parsePlayerViewBody({ active: true, roles: ["ADMIN"] })).toBeNull();
  });

  it("parsePlayerViewBody_unknownRole_returnsNull", () => {
    expect(parsePlayerViewBody({ active: true, roles: ["PIRATE"] })).toBeNull();
  });

  it("parsePlayerViewBody_rolesNotArray_returnsNull", () => {
    expect(parsePlayerViewBody({ active: true, roles: "CASTER" })).toBeNull();
  });

  it("parsePlayerViewBody_sixteenRoles_accepted", () => {
    const roles = new Array<string>(16).fill("DEV");

    expect(parsePlayerViewBody({ active: true, roles })).toEqual({ active: true, roles: ["DEV"] });
  });

  it("parsePlayerViewBody_seventeenRoles_returnsNull", () => {
    const roles = new Array<string>(17).fill("DEV");

    expect(parsePlayerViewBody({ active: true, roles })).toBeNull();
  });

  it("parsePlayerViewBody_missingActive_returnsNull", () => {
    expect(parsePlayerViewBody({})).toBeNull();
  });

  it("parsePlayerViewBody_stringActive_returnsNull", () => {
    expect(parsePlayerViewBody({ active: "true" })).toBeNull();
  });

  it("parsePlayerViewBody_array_returnsNull", () => {
    expect(parsePlayerViewBody([true])).toBeNull();
  });

  it("parsePlayerViewBody_null_returnsNull", () => {
    expect(parsePlayerViewBody(null)).toBeNull();
  });
});

describe("toggleImpersonatedRole", () => {
  it("toggleImpersonatedRole_add_keepsCanonicalOrder", () => {
    expect(toggleImpersonatedRole(["DEV"], "CASTER")).toEqual(["CASTER", "DEV"]);
  });

  it("toggleImpersonatedRole_remove_dropsRole", () => {
    expect(toggleImpersonatedRole(["CASTER", "DEV"], "CASTER")).toEqual(["DEV"]);
  });
});

describe("PLAYER_VIEW_MAX_HOURS", () => {
  it("borne la vue joueur à douze heures", () => {
    expect(PLAYER_VIEW_MAX_HOURS).toBe(12);
  });
});

describe("playerViewExpiryDelayMs", () => {
  const NOW = Date.parse("2026-11-18T10:00:00.000Z");

  it("playerViewExpiryDelayMs_null_returnsNull", () => {
    expect(playerViewExpiryDelayMs(null, NOW)).toBeNull();
  });

  it("playerViewExpiryDelayMs_unparsable_returnsNull", () => {
    expect(playerViewExpiryDelayMs("pas une date", NOW)).toBeNull();
  });

  it("playerViewExpiryDelayMs_future_returnsRemainingPlusMargin", () => {
    expect(playerViewExpiryDelayMs("2026-11-18T11:00:00.000Z", NOW)).toBe(3_600_000 + PLAYER_VIEW_EXPIRY_MARGIN_MS);
  });

  it("playerViewExpiryDelayMs_past_returnsMarginOnly", () => {
    expect(playerViewExpiryDelayMs("2026-11-18T09:00:00.000Z", NOW)).toBe(PLAYER_VIEW_EXPIRY_MARGIN_MS);
  });

  it("playerViewExpiryDelayMs_farFuture_cappedToMaxTimer", () => {
    expect(playerViewExpiryDelayMs("2027-11-18T10:00:00.000Z", NOW)).toBe(2_147_483_647);
  });
});
