import { describe, expect, it } from "@jest/globals";
import {
  holdsPlatformRights,
  parsePlayerViewBody,
  PLAYER_VIEW_EXPIRY_MARGIN_MS,
  PLAYER_VIEW_MAX_HOURS,
  playerViewExpiryDelayMs,
  sessionPlatformRights,
} from "@/lib/shared/player-view";

describe("holdsPlatformRights", () => {
  it("holdsPlatformRights_adminColumn_returnsTrue", () => {
    expect(holdsPlatformRights({ isAdmin: true, roles: [] })).toBe(true);
  });

  it("holdsPlatformRights_devRoleOnly_returnsTrue", () => {
    expect(holdsPlatformRights({ isAdmin: false, roles: ["DEV"] })).toBe(true);
  });

  it("holdsPlatformRights_noRights_returnsFalse", () => {
    expect(holdsPlatformRights({ isAdmin: false, roles: [] })).toBe(false);
  });
});

describe("sessionPlatformRights", () => {
  it("sessionPlatformRights_playerViewOn_returnsNoRights", () => {
    expect(sessionPlatformRights({ isAdmin: true, roles: ["ADMIN", "ARBITRE"] }, true)).toEqual({
      isAdmin: false,
      roles: [],
    });
  });

  it("sessionPlatformRights_playerViewOff_returnsRealRights", () => {
    expect(sessionPlatformRights({ isAdmin: false, roles: ["CASTER"] }, false)).toEqual({
      isAdmin: false,
      roles: ["CASTER"],
    });
  });
});

describe("parsePlayerViewBody", () => {
  it("parsePlayerViewBody_activeTrue_returnsTrue", () => {
    expect(parsePlayerViewBody({ active: true })).toBe(true);
  });

  it("parsePlayerViewBody_activeFalse_returnsFalse", () => {
    expect(parsePlayerViewBody({ active: false })).toBe(false);
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
