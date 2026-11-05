import { describe, expect, it } from "@jest/globals";
import {
  isMatchRefereeActor,
  liveTriggerOwnerAfter,
  mayChangeLiveTrigger,
  nullableUserId,
  viewerMayChangeLiveTrigger,
} from "@/lib/shared/live-trigger-owner";

/**
 * Qui règle le mode d'antenne d'un match (`docs/features/CAST_SETTINGS.md`
 * § Qui règle le mode d'antenne) : le caster qui l'a posé, l'arbitre désigné
 * du match, un admin — jamais un co-caster.
 */

const LIVE_ONLY = { isAdmin: false, manages: false };
const STAFF = { isAdmin: false, manages: true };
const ownedByCaster12 = { trigger: "MANUAL" as const, ownerId: 12, refereeId: 9 };

describe("mayChangeLiveTrigger", () => {
  it("mayChangeLiveTrigger_noTriggerYet_firstCasterMayPose", () => {
    expect(mayChangeLiveTrigger({ trigger: null, ownerId: null, refereeId: null }, { userId: 13, ...LIVE_ONLY })).toBe(true);
  });

  it("mayChangeLiveTrigger_coCaster_refused", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 13, ...LIVE_ONLY })).toBe(false);
  });

  it("mayChangeLiveTrigger_owner_allowed", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 12, ...LIVE_ONLY })).toBe(true);
  });

  it("mayChangeLiveTrigger_admin_allowed", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 1, isAdmin: true, manages: true })).toBe(true);
  });

  it("mayChangeLiveTrigger_designatedReferee_allowed", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 9, ...STAFF })).toBe(true);
  });

  it("mayChangeLiveTrigger_otherMatchReferee_refused", () => {
    // Le staff qui arbitre un autre match ne décide pas pour le caster de celui-ci.
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 5, ...STAFF })).toBe(false);
  });

  it("mayChangeLiveTrigger_ownerlessTriggerByStaff_allowed", () => {
    expect(mayChangeLiveTrigger({ trigger: "AUTO", ownerId: null, refereeId: null }, { userId: 5, ...STAFF })).toBe(true);
  });

  it("mayChangeLiveTrigger_ownerlessTriggerByLiveOnly_refused", () => {
    expect(mayChangeLiveTrigger({ trigger: "AUTO", ownerId: null, refereeId: null }, { userId: 13, ...LIVE_ONLY })).toBe(false);
  });
});

describe("isMatchRefereeActor", () => {
  it("isMatchRefereeActor_refereeWithoutTournamentsPermission_refused", () => {
    expect(isMatchRefereeActor({ refereeId: 9 }, { userId: 9, ...LIVE_ONLY })).toBe(false);
  });

  it("isMatchRefereeActor_noReferee_refused", () => {
    expect(isMatchRefereeActor({ refereeId: null }, { userId: 9, ...STAFF })).toBe(false);
  });
});

describe("viewerMayChangeLiveTrigger", () => {
  const match = { liveTrigger: "MANUAL" as const, liveTriggerCasterId: 12 };

  it("viewerMayChangeLiveTrigger_anonymous_false", () => {
    expect(viewerMayChangeLiveTrigger(match, { userId: null, isAdmin: false, manages: false, referees: false })).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_viewerRefereesMatch_true", () => {
    expect(viewerMayChangeLiveTrigger(match, { userId: 9, isAdmin: false, manages: true, referees: true })).toBe(true);
  });

  it("viewerMayChangeLiveTrigger_coCasterViewer_false", () => {
    expect(viewerMayChangeLiveTrigger(match, { userId: 13, isAdmin: false, manages: false, referees: false })).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_ownerViewer_true", () => {
    expect(viewerMayChangeLiveTrigger(match, { userId: 12, isAdmin: false, manages: false, referees: false })).toBe(true);
  });
});

describe("liveTriggerOwnerAfter", () => {
  it("liveTriggerOwnerAfter_casterPoses_ownsIt", () => {
    expect(liveTriggerOwnerAfter("AUTO", { userId: 12, ...STAFF }, true)).toBe(12);
  });

  it("liveTriggerOwnerAfter_staffNotCasting_staysOwnerless", () => {
    expect(liveTriggerOwnerAfter("AUTO", { userId: 9, ...STAFF }, false)).toBeNull();
  });

  it("liveTriggerOwnerAfter_adminNotCasting_staysOwnerless", () => {
    expect(liveTriggerOwnerAfter("AUTO", { userId: 1, isAdmin: true, manages: true }, false)).toBeNull();
  });

  it("liveTriggerOwnerAfter_liveOnlyNotCasting_ownsIt", () => {
    // Sans quoi il ne pourrait plus changer son propre réglage (mode sans propriétaire = staff).
    expect(liveTriggerOwnerAfter("AUTO", { userId: 13, ...LIVE_ONLY }, false)).toBe(13);
  });

  it("liveTriggerOwnerAfter_triggerRemoved_null", () => {
    expect(liveTriggerOwnerAfter(null, { userId: 12, ...LIVE_ONLY }, true)).toBeNull();
  });
});

describe("nullableUserId", () => {
  it("nullableUserId_bigintString_number", () => {
    expect(nullableUserId("12")).toBe(12);
  });

  it("nullableUserId_nullOrMissing_null", () => {
    expect(nullableUserId(null)).toBeNull();
    expect(nullableUserId(undefined)).toBeNull();
  });
});
