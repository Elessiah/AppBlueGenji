import { describe, expect, it } from "@jest/globals";
import {
  mayUnmarkLiveTrigger,
  viewerMayUnmarkLiveTrigger,
  castOverseer,
  isMatchRefereeActor,
  liveTriggerOwnerAfter,
  liveTriggerViewer,
  mayChangeLiveTrigger,
  organisationModeLocked,
  viewerMayChangeLiveTrigger,
} from "@/lib/shared/live-trigger-owner";

/**
 * Qui règle le mode d'antenne d'un match (`docs/features/CAST_SETTINGS.md`
 * § Qui règle le mode d'antenne) : le caster qui l'a posé, l'arbitre désigné
 * du match, un admin — jamais un co-caster.
 */

const LIVE_ONLY = { oversees: false, manages: false };
const STAFF = { oversees: false, manages: true };
const ownedByCaster12 = { trigger: "MANUAL" as const, ownerId: 12, refereeId: 9 };

describe("mayChangeLiveTrigger — l'antenne d'un mode manuel suit la règle du mode", () => {
  const ownerless = { trigger: "MANUAL" as const, ownerId: null, refereeId: null };

  it("mayChangeLiveTrigger_manualownerlessShownCaster_true", () => {
    expect(mayChangeLiveTrigger(ownerless, { userId: 13, ...LIVE_ONLY }, true)).toBe(true);
  });

  it("mayChangeLiveTrigger_manualownerlessNonCaster_false", () => {
    expect(mayChangeLiveTrigger(ownerless, { userId: 13, ...LIVE_ONLY }, false)).toBe(false);
  });

  it("mayChangeLiveTrigger_manualotherCastersMode_false", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 13, ...LIVE_ONLY }, true)).toBe(false);
  });
});

describe("viewerMayChangeLiveTrigger — antenne d'un mode sans maître", () => {
  const ownerlessMatch = { liveTrigger: "MANUAL" as const, liveTriggerCasterId: null, casters: [{ userId: 13 }] };
  const viewer13 = { userId: 13, oversees: false, manages: false, referees: false };

  it("viewerMayChangeLiveTrigger_manualownerlessViewerCasts_true", () => {
    expect(viewerMayChangeLiveTrigger(ownerlessMatch, viewer13)).toBe(true);
  });

  it("viewerMayChangeLiveTrigger_manualownerlessViewerNotCasting_false", () => {
    expect(viewerMayChangeLiveTrigger({ ...ownerlessMatch, casters: [] }, viewer13)).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_manualanonymous_false", () => {
    expect(viewerMayChangeLiveTrigger(ownerlessMatch, { ...viewer13, userId: null })).toBe(false);
  });
});

describe("mayChangeLiveTrigger", () => {
  it("mayChangeLiveTrigger_noTriggerYet_firstCasterMayPose", () => {
    expect(mayChangeLiveTrigger({ trigger: null, ownerId: null, refereeId: null }, { userId: 13, ...LIVE_ONLY }, true)).toBe(true);
  });

  it("mayChangeLiveTrigger_noTriggerLiveOnlyNotCasting_refused", () => {
    // Décision du 2026-11-05 : un porteur de la seule `live` ne règle que son cast.
    expect(mayChangeLiveTrigger({ trigger: null, ownerId: null, refereeId: null }, { userId: 13, ...LIVE_ONLY }, false)).toBe(false);
  });

  it("mayChangeLiveTrigger_noTriggerTournamentsOnlyNotCasting_refused", () => {
    // La seule permission `tournaments`, hors arbitrage, n'atteint pas le mode (`assertLiveActor` au serveur).
    expect(mayChangeLiveTrigger({ trigger: null, ownerId: null, refereeId: null }, { userId: 5, ...STAFF })).toBe(false);
  });

  it("mayChangeLiveTrigger_ownerlessTriggerShownCaster_allowed", () => {
    // Un caster qui change un mode sans maître en devient le maître (liveTriggerOwnerAfter).
    expect(mayChangeLiveTrigger({ trigger: "AUTO", ownerId: null, refereeId: null }, { userId: 13, ...LIVE_ONLY }, true)).toBe(true);
  });

  it("mayChangeLiveTrigger_otherCastersModeEvenWhenCasting_refused", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 13, ...LIVE_ONLY }, true)).toBe(false);
  });

  it("mayChangeLiveTrigger_coCaster_refused", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 13, ...LIVE_ONLY })).toBe(false);
  });

  it("mayChangeLiveTrigger_owner_allowed", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 12, ...LIVE_ONLY })).toBe(true);
  });

  it("mayChangeLiveTrigger_admin_allowed", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 1, oversees: true, manages: true })).toBe(true);
  });

  it("mayChangeLiveTrigger_designatedReferee_allowed", () => {
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 9, ...STAFF })).toBe(true);
  });

  it("mayChangeLiveTrigger_otherMatchReferee_refused", () => {
    // Le staff qui arbitre un autre match ne décide pas pour le caster de celui-ci.
    expect(mayChangeLiveTrigger(ownedByCaster12, { userId: 5, ...STAFF })).toBe(false);
  });

  it("mayChangeLiveTrigger_ownerlessTriggerByOverseer_allowed", () => {
    expect(mayChangeLiveTrigger({ trigger: "AUTO", ownerId: null, refereeId: null }, { userId: 5, oversees: true, manages: true })).toBe(true);
  });

  it("mayChangeLiveTrigger_ownerlessTriggerByTournamentsOnly_refused", () => {
    expect(mayChangeLiveTrigger({ trigger: "AUTO", ownerId: null, refereeId: null }, { userId: 5, ...STAFF })).toBe(false);
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

describe("liveTriggerViewer", () => {
  it("liveTriggerViewer_controls_mapsEveryField", () => {
    expect(liveTriggerViewer({ viewerUserId: 7, canManage: true, canSchedule: true }, true)).toEqual({
      userId: 7,
      oversees: true,
      manages: true,
      referees: true,
    });
  });
});

describe("viewerMayChangeLiveTrigger", () => {
  const match = { liveTrigger: "MANUAL" as const, liveTriggerCasterId: 12, casters: [{ userId: 12 }, { userId: 13 }] };

  it("viewerMayChangeLiveTrigger_unsetModeLiveOnlyNotCasting_false", () => {
    const unset = { liveTrigger: null, liveTriggerCasterId: null, casters: [] };

    expect(viewerMayChangeLiveTrigger(unset, { userId: 13, oversees: false, manages: false, referees: false })).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_unsetModeClaimingViewer_true", () => {
    // À l'inscription, le lecteur est jugé en caster du match.
    const unset = { liveTrigger: null, liveTriggerCasterId: null, casters: [] };

    expect(viewerMayChangeLiveTrigger(unset, { userId: 13, oversees: false, manages: false, referees: false }, true)).toBe(true);
  });

  it("viewerMayChangeLiveTrigger_anonymous_false", () => {
    expect(viewerMayChangeLiveTrigger(match, { userId: null, oversees: false, manages: false, referees: false })).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_viewerRefereesMatch_true", () => {
    expect(viewerMayChangeLiveTrigger(match, { userId: 9, oversees: false, manages: true, referees: true })).toBe(true);
  });

  it("viewerMayChangeLiveTrigger_coCasterViewer_false", () => {
    expect(viewerMayChangeLiveTrigger(match, { userId: 13, oversees: false, manages: false, referees: false })).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_ownerViewer_true", () => {
    expect(viewerMayChangeLiveTrigger(match, { userId: 12, oversees: false, manages: false, referees: false })).toBe(true);
  });

  it("viewerMayChangeLiveTrigger_ownerNotShownStaffViewer_true", () => {
    // Un maître tu ou parti n'est pas nommé : le mode reste sans maître, comme au serveur.
    const unnamed = { liveTrigger: "MANUAL" as const, liveTriggerCasterId: null, casters: [] };

    expect(viewerMayChangeLiveTrigger(unnamed, { userId: 9, oversees: true, manages: true, referees: false })).toBe(true);
    expect(viewerMayChangeLiveTrigger(unnamed, { userId: 9, oversees: false, manages: true, referees: true })).toBe(true);
    expect(viewerMayChangeLiveTrigger(unnamed, { userId: 13, oversees: false, manages: false, referees: false })).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_ownerlessNamedCaster_true", () => {
    const ownerless = { liveTrigger: "AUTO" as const, liveTriggerCasterId: null, casters: [{ userId: 13 }] };

    expect(viewerMayChangeLiveTrigger(ownerless, { userId: 13, oversees: false, manages: false, referees: false })).toBe(true);
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
    expect(liveTriggerOwnerAfter("AUTO", { userId: 1, oversees: true, manages: true }, false)).toBeNull();
  });

  it("liveTriggerOwnerAfter_liveOnlyNotCasting_staysOwnerless", () => {
    // Seul un caster du match en devient propriétaire : la page ne sait montrer qu'un caster.
    expect(liveTriggerOwnerAfter("AUTO", { userId: 13, ...LIVE_ONLY }, false)).toBeNull();
  });

  it("liveTriggerOwnerAfter_refereeNotCastingWithKeptOwner_keepsOwner", () => {
    // L'arbitre médie pour le caster : le mode reste au caster qui l'a posé.
    expect(liveTriggerOwnerAfter("AUTO", { userId: 9, ...STAFF }, false, 12)).toBe(12);
  });

  it("liveTriggerOwnerAfter_castingRefereeWithShownOwner_keepsOwner", () => {
    // L'arbitre qui caste aussi le match médie : il ne prend pas le mode du caster.
    expect(liveTriggerOwnerAfter("AUTO", { userId: 9, ...STAFF }, true, 12)).toBe(12);
  });

  it("liveTriggerOwnerAfter_triggerRemovedWithKeptOwner_null", () => {
    expect(liveTriggerOwnerAfter(null, { userId: 9, ...STAFF }, false, 12)).toBeNull();
  });

  it("liveTriggerOwnerAfter_triggerRemoved_null", () => {
    expect(liveTriggerOwnerAfter(null, { userId: 12, ...LIVE_ONLY }, true)).toBeNull();
  });
});


describe("castOverseer — staff qui règle tout cast (décision du 2026-11-09)", () => {
  it("castOverseer_tournamentsAndLive_true", () => {
    expect(castOverseer(true, true)).toBe(true);
  });

  it("castOverseer_tournamentsWithoutLive_false", () => {
    expect(castOverseer(true, false)).toBe(false);
  });

  it("castOverseer_liveWithoutTournaments_false", () => {
    expect(castOverseer(false, true)).toBe(false);
  });

  it("liveTriggerViewer_scheduleWithoutLive_notOverseer", () => {
    expect(liveTriggerViewer({ viewerUserId: 7, canManage: false, canSchedule: true }, false).oversees).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_overseerOnOtherCasterMode_true", () => {
    const match = { liveTrigger: "MANUAL" as const, liveTriggerCasterId: 12, casters: [{ userId: 12 }] };
    expect(viewerMayChangeLiveTrigger(match, { userId: 5, oversees: true, manages: true, referees: false })).toBe(true);
  });
});

describe("mayUnmarkLiveTrigger — démarquer (décision du 2026-11-09)", () => {
  const ownerless = { trigger: "AUTO" as const, ownerId: null, refereeId: 9 };

  it("mayUnmarkLiveTrigger_owner_true", () => {
    expect(mayUnmarkLiveTrigger(ownedByCaster12, { userId: 12, ...LIVE_ONLY })).toBe(true);
  });

  it("mayUnmarkLiveTrigger_liveOnlyOnOwnerlessMode_false", () => {
    expect(mayUnmarkLiveTrigger(ownerless, { userId: 13, ...LIVE_ONLY })).toBe(false);
  });

  it("mayUnmarkLiveTrigger_overseer_true", () => {
    expect(mayUnmarkLiveTrigger(ownerless, { userId: 5, oversees: true, manages: true })).toBe(true);
  });

  it("mayUnmarkLiveTrigger_designatedReferee_true", () => {
    expect(mayUnmarkLiveTrigger(ownerless, { userId: 9, ...STAFF })).toBe(true);
  });
});

describe("organisationModeLocked — décision du 2026-11-10", () => {
  const ownerless = { trigger: "AUTO" as const, ownerId: null, refereeId: null };
  const caster13 = { userId: 13, ...LIVE_ONLY };

  it("organisationModeLocked_noOrganisationLink_false", () => {
    expect(organisationModeLocked(ownerless, caster13, false)).toBe(false);
  });

  it("organisationModeLocked_noModeYet_false", () => {
    expect(organisationModeLocked({ ...ownerless, trigger: null }, caster13, true)).toBe(false);
  });

  it("organisationModeLocked_overseerActor_false", () => {
    expect(organisationModeLocked(ownerless, { userId: 5, oversees: true, manages: true }, true)).toBe(false);
  });

  it("organisationModeLocked_matchReferee_false", () => {
    expect(organisationModeLocked({ ...ownerless, refereeId: 9 }, { userId: 9, ...STAFF }, true)).toBe(false);
  });

  it("organisationModeLocked_tournamentsOnlyNotReferee_true", () => {
    expect(organisationModeLocked(ownerless, { userId: 5, ...STAFF }, true)).toBe(true);
  });

  it("organisationModeLocked_ownerActor_false", () => {
    expect(organisationModeLocked({ ...ownerless, ownerId: 13 }, caster13, true)).toBe(false);
  });

  it("organisationModeLocked_casterOnOwnerlessModeWithOrganisationLink_true", () => {
    expect(organisationModeLocked(ownerless, caster13, true)).toBe(true);
  });
});

describe("viewerMayChangeLiveTrigger — lien de l'organisation", () => {
  const viewer13 = { userId: 13, oversees: false, manages: false, referees: false };
  const ownerless = { liveTrigger: "AUTO" as const, liveTriggerCasterId: null, casters: [{ userId: 13 }] };

  it("viewerMayChangeLiveTrigger_casterWithOrganisationLink_false", () => {
    expect(viewerMayChangeLiveTrigger({ ...ownerless, officialBroadcastLink: true }, viewer13)).toBe(false);
  });

  it("viewerMayChangeLiveTrigger_casterWithoutOrganisationLink_true", () => {
    // La chaîne d'un membre du staff (case décochée) ne ferme pas le mode.
    expect(viewerMayChangeLiveTrigger({ ...ownerless, officialBroadcastLink: false }, viewer13)).toBe(true);
  });

  it("viewerMayChangeLiveTrigger_noModeWithOrganisationLink_true", () => {
    expect(viewerMayChangeLiveTrigger({ ...ownerless, liveTrigger: null, officialBroadcastLink: true }, viewer13)).toBe(true);
  });
});

describe("viewerMayUnmarkLiveTrigger", () => {
  const viewer13 = { userId: 13, oversees: false, manages: false, referees: false };

  it("viewerMayUnmarkLiveTrigger_liveOnlyOnOwnerlessMode_false", () => {
    expect(viewerMayUnmarkLiveTrigger({ liveTrigger: "AUTO", liveTriggerCasterId: null }, viewer13)).toBe(false);
  });

  it("viewerMayUnmarkLiveTrigger_ownMode_true", () => {
    expect(viewerMayUnmarkLiveTrigger({ liveTrigger: "AUTO", liveTriggerCasterId: 13 }, viewer13)).toBe(true);
  });

  it("viewerMayUnmarkLiveTrigger_unmarkedMatch_true", () => {
    expect(viewerMayUnmarkLiveTrigger({ liveTrigger: null }, viewer13)).toBe(true);
  });
});
