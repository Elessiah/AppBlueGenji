import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mapMatch } from "@/lib/server/tournaments/_internal";
import {
  castEligibilityBlock,
  refereeEligibilityBlock,
  loadCastBlocks,
  loadEligibleRefereeIds,
  loadRefereeEligibility,
  loadRefereePermission,
  loadRefereeStanding,
  resetObjectionColumnProbe,
  loadShownCasterIds,
  refereeKeptColumns,
  refereeObjectionUpheld,
  type CastEligibilityFields,
} from "@/lib/server/tournaments/cast-eligibility";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";
import type { MatchCasterRow } from "@/lib/server/tournaments/match-casters";
import { matchRow } from "../../helpers/tournament-rows";

/**
 * La condition du cast rejouée sur un compte **déjà inscrit**, et ce qu'en
 * fait l'instantané du plateau : un titulaire qui ne la remplit plus avant le
 * lancement est tu, pour que la carte rouvre l'inscription.
 */

const ELIGIBLE: CastEligibilityFields = {
  discord_verified_at: "2026-09-01 10:00:00",
  discord_pseudo: "caster",
  blizzard_sub: "sub",
  overwatch_battletag: "Caster#1",
  is_deleted: 0,
  is_admin: 0,
  platform_roles_json: JSON.stringify(["CASTER"]),
};

describe("castEligibilityBlock", () => {
  it("laisse caster un compte qui a `live` et l'identité exigée", () => {
    expect(castEligibilityBlock(ELIGIBLE, "OW")).toBeNull();
    expect(castEligibilityBlock({ ...ELIGIBLE, platform_roles_json: JSON.stringify(["ARBITRE"]) }, "OW")).toBeNull();
  });

  it("donne `live` à un administrateur sans rôle stocké", () => {
    expect(castEligibilityBlock({ ...ELIGIBLE, is_admin: 1, platform_roles_json: null }, "OW")).toBeNull();
  });

  it.each<[string, Partial<CastEligibilityFields>, string]>([
    ["sans `live`", { platform_roles_json: JSON.stringify(["RECRUTEUR"]) }, "NOT_CASTER"],
    ["aux rôles illisibles", { platform_roles_json: "pas du JSON" }, "NOT_CASTER"],
    ["au tag décertifié", { discord_verified_at: null }, "CASTER_IDENTITY_REQUIRED"],
    ["sans tag", { discord_pseudo: null }, "CASTER_IDENTITY_REQUIRED"],
    ["sans Battle.net", { blizzard_sub: null }, "CASTER_IDENTITY_REQUIRED"],
    ["supprimé", { is_deleted: 1 }, "NOT_CASTER"],
  ])("refuse un compte %s", (_label, overrides, block) => {
    expect(castEligibilityBlock({ ...ELIGIBLE, ...overrides }, "OW")).toBe(block);
  });

  it("castEligibilityBlock_deletedAdmin_returnsNotCaster", () => {
    expect(castEligibilityBlock({ ...ELIGIBLE, is_admin: 1, is_deleted: 1 }, "OW")).toBe("NOT_CASTER");
  });

  it("refuse un compte introuvable", () => {
    expect(castEligibilityBlock(undefined, "OW")).toBe("NOT_CASTER");
  });
});

describe("castEligibilityBlock / refereeEligibilityBlock — Battle.net seulement en Overwatch", () => {
  const noBattlenet = { ...ELIGIBLE, blizzard_sub: null, overwatch_battletag: null };

  it("castEligibilityBlock_marvelRivalsWithoutBattlenet_returnsNull", () => {
    expect(castEligibilityBlock(noBattlenet, "MR")).toBeNull();
  });

  it("castEligibilityBlock_overwatchWithoutBattlenet_requiresIdentity", () => {
    expect(castEligibilityBlock(noBattlenet, "OW")).toBe("CASTER_IDENTITY_REQUIRED");
  });

  it("castEligibilityBlock_marvelRivalsWithoutDiscord_requiresIdentity", () => {
    expect(castEligibilityBlock({ ...noBattlenet, discord_verified_at: null }, "MR")).toBe("CASTER_DISCORD_REQUIRED");
  });

  it("refereeEligibilityBlock_marvelRivalsWithoutBattlenet_returnsNull", () => {
    const referee = { ...noBattlenet, platform_roles_json: JSON.stringify(["ARBITRE"]) };
    expect(refereeEligibilityBlock(referee, "MR")).toBeNull();
    expect(refereeEligibilityBlock(referee, "OW")).toBe("REFEREE_IDENTITY_REQUIRED");
  });
});

describe("mapMatch — casters inscrits et condition du cast", () => {
  const caster = (
    userId: number,
    overrides: Partial<CastEligibilityFields> = {},
    extra: Partial<MatchCasterRow> = {},
  ): MatchCasterRow => ({
    matchId: 1,
    userId,
    streamId: 10,
    readyAt: null,
    pseudo: `Caster${userId}`,
    eligibility: { ...ELIGIBLE, ...overrides },
    ...extra,
  });
  const pairing = "1:2";
  const row = (overrides: Parameters<typeof matchRow>[0] = {}) =>
    matchRow({ status: "READY", team1_id: 1, team2_id: 2, launch_pairing: pairing, ...overrides });

  it("garde un caster éligible, avec son stream", () => {
    const match = mapMatch(row(), { casters: [caster(900)] });
    expect(match.casters).toEqual([{ userId: 900, pseudo: "Caster900", streamId: 10, ready: false }]);
  });

  it("tait un caster devenu inéligible tant que le match n'est pas lancé, et garde les autres", () => {
    const match = mapMatch(row(), {
      casters: [caster(900, { blizzard_sub: null }, { readyAt: new Date() }), caster(901)],
    });
    expect(match.casters.map((entry) => entry.userId)).toEqual([901]);
  });

  it("tait un caster dont le compte est supprimé (anonymisé)", () => {
    const match = mapMatch(row(), { casters: [caster(900, { is_deleted: 1 })] });
    expect(match.casters).toEqual([]);
  });

  it("garde les casters d'un match lancé ou joué", () => {
    const ineligible = [caster(900, { platform_roles_json: null })];
    expect(mapMatch(row({ launched_at: new Date() }), { casters: ineligible }).casters).toHaveLength(1);
    expect(mapMatch(row({ status: "COMPLETED" }), { casters: ineligible }).casters).toHaveLength(1);
  });

  it("lit le « Prêt » de chaque caster, effacé pour un autre appariement", () => {
    const casters = [caster(900, {}, { readyAt: new Date() }), caster(901)];
    expect(mapMatch(row(), { casters }).casters.map((entry) => entry.ready)).toEqual([true, false]);
    expect(mapMatch(row({ launch_pairing: "1:3" }), { casters }).casters.map((entry) => entry.ready)).toEqual([
      false,
      false,
    ]);
  });

  it("sans liste (lecture partielle) : ni caster ni stream", () => {
    const match = mapMatch(row());
    expect(match.casters).toEqual([]);
    expect(match.streams).toEqual([]);
  });

  it("revalide les liens des streams à la lecture", () => {
    const match = mapMatch(row(), {
      casters: [caster(900, {}, { streamId: 11 }), caster(901, {}, { streamId: 12 })],
      streams: [
        { id: 10, matchId: 1, liveUrl: "twitch.tv/BlueGenji", staff: true },
        { id: 11, matchId: 1, liveUrl: "https://evil.example/stream", staff: false },
        { id: 12, matchId: 1, liveUrl: null, staff: false },
      ],
    });
    expect(match.streams).toEqual([
      { id: 10, liveUrl: "https://twitch.tv/BlueGenji", staff: true },
      { id: 11, liveUrl: null, staff: false },
      { id: 12, liveUrl: null, staff: false },
    ]);
  });

  it("tait le stream que seul tient un caster tu (avant le lancement), garde celui du staff", () => {
    const streams = [
      { id: 10, matchId: 1, liveUrl: "https://twitch.tv/match", staff: true },
      { id: 11, matchId: 1, liveUrl: "https://twitch.tv/perso", staff: false },
    ];
    const casters = [caster(900, { platform_roles_json: null }, { streamId: 11 })];
    expect(mapMatch(row(), { casters, streams }).streams.map((stream) => stream.id)).toEqual([10]);
    // Lancé : le caster et son stream restent (on ne réécrit pas une diffusion en cours).
    expect(mapMatch(row({ launched_at: new Date() }), { casters, streams }).streams.map((stream) => stream.id)).toEqual([
      10, 11,
    ]);
  });

  it("mapMatch_ownerShownCaster_exposesId", () => {
    const match = mapMatch(row({ live_trigger: "MANUAL", live_trigger_user_id: 900 }), { casters: [caster(900)] });

    expect(match.liveTriggerCasterId).toBe(900);
  });

  it("mapMatch_ownerNotShown_noOwner", () => {
    const match = mapMatch(row({ live_trigger: "MANUAL", live_trigger_user_id: 900 }), {
      casters: [caster(900, { blizzard_sub: null })],
    });

    expect(match.liveTriggerCasterId).toBeNull();
    expect(Object.keys(match)).not.toContain("liveTriggerOwnerHidden");
  });
});

describe("mapMatch — arbitre désigné dans l'instantané (`docs/features/MATCH_REFEREE.md`)", () => {
  const pairing = "1:2";
  const eligible = {
    referee_user_id: 950,
    referee_discord_verified_at: new Date(),
    referee_discord_pseudo: "arbitre",
    referee_blizzard_sub: "sub",
    referee_overwatch_battletag: "Arbitre#1",
    referee_is_deleted: 0,
    referee_is_admin: 0,
    referee_platform_roles_json: JSON.stringify(["ARBITRE"]),
  };
  const row = (overrides: Parameters<typeof matchRow>[0] = {}) =>
    matchRow({ status: "READY", team1_id: 1, team2_id: 2, launch_pairing: pairing, ...overrides });

  it("ne porte que des drapeaux : jamais l'identité de l'arbitre", () => {
    const match = mapMatch(row({ ...eligible, referee_ready_at: new Date() }));
    expect(match).toMatchObject({ refereeAssigned: true, selfManaged: false });
    // Ni « Prêt » de l'arbitre (décision 47) ni compte : une empreinte opaque.
    expect(match).not.toHaveProperty("refereeReady");
    expect(match.refereeKey).toMatch(/^[\w-]{16}$/);
    const text = JSON.stringify(match);
    expect(text).not.toContain("950");
    expect(text).not.toContain("arbitre");
    expect(text).not.toContain("Arbitre#1");
  });

  // MATCH-UI-NAMES : un match joué ne nomme plus son arbitre aux membres.
  it("mapMatchLaunch_completedMatch_hasNullRefereeKey", () => {
    const match = mapMatch(row({ ...eligible, status: "COMPLETED" }));
    expect(match.refereeKey).toBeNull();
  });

  it("mapMatch_completedRefereedMatch_noFirstBan", () => {
    // L'ordre réellement suivi n'est pas gardé : un match joué n'en affirme aucun.
    expect(mapMatch(row({ ...eligible, status: "COMPLETED", team1_seed: 1, team2_seed: 4 })).firstBanTeamId).toBeNull();
  });

  it("mapMatch_pendingRefereedMatch_lowerSeedBansFirst", () => {
    expect(mapMatch(row({ ...eligible, status: "PENDING", team1_seed: 1, team2_seed: 4 })).firstBanTeamId).toBe(2);
  });

  it("mapMatchLaunch_pendingMatch_hasRefereeKey", () => {
    const match = mapMatch(row({ ...eligible, status: "PENDING" }));
    expect(match.refereeKey).toMatch(/^[\w-]{16}$/);
  });

  // Score déclaré : l'empreinte reste (relève de la fenêtre « Contacts ») ;
  // c'est `showsRefereeName` qui tait le pseudo aux membres.
  it("mapMatchLaunch_awaitingConfirmationMatch_keepsRefereeKey", () => {
    const match = mapMatch(row({ ...eligible, status: "AWAITING_CONFIRMATION" }));
    expect(match.refereeKey).toMatch(/^[\w-]{16}$/);
  });

  it("tait un arbitre qui ne remplit plus la condition, et son « Prêt » d'un autre appariement", () => {
    expect(mapMatch(row({ ...eligible, referee_platform_roles_json: JSON.stringify(["CASTER"]) })).refereeAssigned).toBe(false);
    expect(mapMatch(row({ ...eligible, referee_platform_roles_json: JSON.stringify(["CASTER"]) })).refereeKey).toBeNull();
  });

  it("tait, avant le départ, un arbitre qui joue désormais le match ; le garde une fois le match lancé", () => {
    expect(mapMatch(row({ ...eligible, referee_plays_match: 1 })).refereeAssigned).toBe(false);
    expect(mapMatch(row({ ...eligible, referee_plays_match: 0 })).refereeAssigned).toBe(true);
    expect(mapMatch(row({ ...eligible, referee_plays_match: 1, launched_at: new Date() })).refereeAssigned).toBe(true);
  });

  it("mapMatch_refereeObjectionOnOpenMatch_hidesReferee", () => {
    const match = mapMatch(row({ ...eligible, referee_objection_at: new Date() }));

    expect(match.refereeAssigned).toBe(false);
    expect(match.refereeKey).toBeNull();
  });

  it("mapMatch_refereeObjectionOnLaunchedMatch_hidesReferee", () => {
    const match = mapMatch(row({ ...eligible, referee_objection_at: new Date(), launched_at: new Date() }));

    expect(match.refereeAssigned).toBe(false);
  });

  it("mapMatch_refereeObjectionOnCompletedMatch_keepsReferee", () => {
    const match = mapMatch(row({ ...eligible, referee_objection_at: new Date(), status: "COMPLETED" }));

    expect(match.refereeAssigned).toBe(true);
  });

  it("hôte à gauche, premier ban à l'autre ; en BlueGenji Survie la meilleure tête de série héberge", () => {
    expect(mapMatch(row()).hostTeamId).toBe(1);
    expect(mapMatch(row()).firstBanTeamId).toBe(2);
    const seeded = mapMatch(row({ team1_seed: 5, team2_seed: 2 }));
    expect(seeded.hostTeamId).toBe(2);
    expect(seeded.firstBanTeamId).toBe(1);
  });

  it("autogestion et première carte passent telles quelles, la carte en texte visible", () => {
    const match = mapMatch(row({ self_managed: 1, first_map: "  Ilios​ " }));
    expect(match.selfManaged).toBe(true);
    expect(match.firstMap).toBe("Ilios");
  });
});

describe("refereeObjectionUpheld", () => {
  const connectionWith = (execute: jest.Mock<SqlQuery>) => fakeConnection({ execute });

  it("refereeObjectionUpheld_dateSet_returnsTrue", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ referee_objection_at: "2026-10-28 20:00:00" }], []]);

    await expect(refereeObjectionUpheld(connectionWith(execute), 5)).resolves.toBe(true);
  });

  it("refereeObjectionUpheld_nullDate_returnsFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ referee_objection_at: null }], []]);

    await expect(refereeObjectionUpheld(connectionWith(execute), 5)).resolves.toBe(false);
  });

  it("refereeObjectionUpheld_noRow_returnsFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await expect(refereeObjectionUpheld(connectionWith(execute), 5)).resolves.toBe(false);
  });

  it("refereeObjectionUpheld_lockTrue_readsInShareMode", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await refereeObjectionUpheld(connectionWith(execute), 5, true);

    expect(execute.mock.calls[0][0]).toMatch(/WHERE id = \? LIMIT 1 LOCK IN SHARE MODE$/);
    expect(execute.mock.calls[0][1]).toEqual([5]);
  });

  it("refereeObjectionUpheld_noLock_plainRead", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await refereeObjectionUpheld(connectionWith(execute), 5);

    expect(execute.mock.calls[0][0]).not.toContain("LOCK IN SHARE MODE");
  });

  it("refereeObjectionUpheld_unknownColumn_returnsFalse", async () => {
    const unknownColumn = Object.assign(new Error("Unknown column 'referee_objection_at'"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest.fn<SqlQuery>().mockRejectedValue(unknownColumn);

    await expect(refereeObjectionUpheld(connectionWith(execute), 5)).resolves.toBe(false);
  });

  it("refereeObjectionUpheld_otherError_rethrows", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

    await expect(refereeObjectionUpheld(connectionWith(execute), 5)).rejects.toThrow("ER_LOCK_WAIT_TIMEOUT");
  });
});

describe("loadEligibleRefereeIds", () => {
  const referee = { ...ELIGIBLE, id: 950, platform_roles_json: JSON.stringify(["ARBITRE"]) };

  it("loadEligibleRefereeIds_eligibleReferee_returnsItsId", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[referee], []]);

    await expect(loadEligibleRefereeIds(fakeConnection({ execute }), [950], "OW")).resolves.toEqual(new Set([950]));
  });

  it("loadEligibleRefereeIds_query_excludesUpheldObjections", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await loadEligibleRefereeIds(fakeConnection({ execute }), [950], "OW");

    expect(execute.mock.calls[0][0]).toContain("AND referee_objection_at IS NULL");
  });

  it("loadEligibleRefereeIds_noId_readsNothing", async () => {
    const execute = jest.fn<SqlQuery>();

    await expect(loadEligibleRefereeIds(fakeConnection({ execute }), [], "OW")).resolves.toEqual(new Set());
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("loadRefereeEligibility", () => {
  const connectionWith = (execute: jest.Mock<SqlQuery>) => fakeConnection({ execute });
  const referee: CastEligibilityFields = { ...ELIGIBLE, platform_roles_json: JSON.stringify(["ARBITRE"]) };

  it("loadRefereeEligibility_lockRequested_appendsShareLock", async () => {
    // Une désignation attend la suppression du compte en cours (verrou exclusif).
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[referee], []]);

    await expect(loadRefereeEligibility(connectionWith(execute), 950, "OW", true)).resolves.toBeNull();

    expect(execute.mock.calls[0][0]).toMatch(/WHERE id = \? LIMIT 1 LOCK IN SHARE MODE$/);
    expect(execute.mock.calls[0][1]).toEqual([950]);
  });

  it("loadRefereeEligibility_defaultCall_readsWithoutLock", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[referee], []]);

    await loadRefereeEligibility(connectionWith(execute), 950, "OW");

    expect(execute.mock.calls[0][0]).not.toContain("LOCK IN SHARE MODE");
  });
});

describe("loadRefereePermission — permission seule, sans jeu ni identité (revue sécurité #545)", () => {
  const connectionWith = (execute: jest.Mock<SqlQuery>) => fakeConnection({ execute });
  const referee: CastEligibilityFields = { ...ELIGIBLE, platform_roles_json: JSON.stringify(["ARBITRE"]) };

  it("loadRefereePermission_refereeWithoutIdentity_returnsTrue", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...referee, discord_verified_at: null, blizzard_sub: null }], []]);

    await expect(loadRefereePermission(connectionWith(execute), 950)).resolves.toBe(true);
    expect(execute.mock.calls[0][1]).toEqual([950]);
  });

  it("loadRefereePermission_withoutTournamentsPermission_returnsFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...referee, platform_roles_json: JSON.stringify(["CASTER"]) }], []]);

    await expect(loadRefereePermission(connectionWith(execute), 950)).resolves.toBe(false);
  });

  it("loadRefereePermission_missingAccount_returnsFalse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await expect(loadRefereePermission(connectionWith(execute), 950)).resolves.toBe(false);
  });

  it("loadRefereePermission_adminWithoutStoredRoles_returnsTrue", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...referee, is_admin: 1, platform_roles_json: null }], []]);

    await expect(loadRefereePermission(connectionWith(execute), 950)).resolves.toBe(true);
  });
});

describe("loadRefereeStanding (EF-31)", () => {
  const connectionWith = (execute: jest.Mock<SqlQuery>) => fakeConnection({ execute });
  const referee: CastEligibilityFields = { ...ELIGIBLE, platform_roles_json: JSON.stringify(["ARBITRE"]) };

  beforeEach(() => resetObjectionColumnProbe());

  it("loadRefereeStanding_eligibleWithoutObjection_oneRead", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...referee, referee_objection_at: null }], []]);

    await expect(loadRefereeStanding(connectionWith(execute), 950, "OW")).resolves.toEqual({ block: null, objection: false });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain("referee_objection_at FROM bg_users WHERE id = ? LIMIT 1");
  });

  it("loadRefereeStanding_objectionSet_returnsObjectionTrue", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...referee, referee_objection_at: "2026-10-28 20:00:00" }], []]);

    await expect(loadRefereeStanding(connectionWith(execute), 950, "OW")).resolves.toEqual({ block: null, objection: true });
  });

  it("loadRefereeStanding_noRole_returnsBlock", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...ELIGIBLE, platform_roles_json: null, referee_objection_at: null }], []]);

    const standing = await loadRefereeStanding(connectionWith(execute), 950, "OW");

    expect(standing.block).not.toBeNull();
  });

  it("loadRefereeStanding_unknownColumn_fallsBackWithoutObjection", async () => {
    const unknownColumn = Object.assign(new Error("Unknown column 'referee_objection_at'"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(unknownColumn).mockResolvedValue([[referee], []]);

    await expect(loadRefereeStanding(connectionWith(execute), 950, "OW")).resolves.toEqual({ block: null, objection: false });
  });

  it("loadRefereeStanding_columnSeenMissing_skipsObjectionReadNextTime", async () => {
    const unknownColumn = Object.assign(new Error("Unknown column 'referee_objection_at'"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(unknownColumn).mockResolvedValue([[referee], []]);
    await loadRefereeStanding(connectionWith(execute), 950, "OW");
    execute.mockClear();

    await expect(loadRefereeStanding(connectionWith(execute), 950, "OW")).resolves.toEqual({ block: null, objection: false });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).not.toContain("referee_objection_at");
  });

  it("loadRefereeStanding_otherError_rethrows", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

    await expect(loadRefereeStanding(connectionWith(execute), 950, "OW")).rejects.toThrow("ER_LOCK_WAIT_TIMEOUT");
  });
});

describe("loadCastBlocks", () => {
  it("loadCastBlocks_mixedAccounts_blockPerAccount_missingIsNotCaster", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { id: 1, ...ELIGIBLE },
        { id: 2, ...ELIGIBLE, discord_verified_at: null },
      ],
      [],
    ]);
    const blocks = await loadCastBlocks(fakeConnection({ execute }), [1, 2, 3, 1], "OW");
    expect(blocks).toEqual(
      new Map([
        [1, null],
        [2, "CASTER_IDENTITY_REQUIRED"],
        [3, "NOT_CASTER"],
      ]),
    );
    expect(execute.mock.calls[0][1]).toEqual([1, 2, 3]);
  });

  it("loadCastBlocks_emptyList_noQuery", async () => {
    const execute = jest.fn<SqlQuery>();
    await expect(loadCastBlocks(fakeConnection({ execute }), [], "OW")).resolves.toEqual(new Map());
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("loadShownCasterIds", () => {
  const ADMIN_CASTER = { ...ELIGIBLE, is_admin: 1, platform_roles_json: null };
  const PLAYER = { ...ELIGIBLE, platform_roles_json: JSON.stringify([]) };

  it("loadShownCasterIds_noIds_returnsEmptyWithoutQuery", async () => {
    const execute = jest.fn<SqlQuery>();

    await expect(loadShownCasterIds(fakeConnection({ execute }), 42, [null], "OW", true)).resolves.toEqual(new Set());
    expect(execute).not.toHaveBeenCalled();
  });

  it("loadShownCasterIds_beforeLaunchIneligibleCaster_excluded", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([
      [
        { user_id: 12, ...ADMIN_CASTER },
        { user_id: 13, ...PLAYER },
      ],
      [],
    ]);

    await expect(loadShownCasterIds(fakeConnection({ execute }), 42, [12, 13], "OW", true)).resolves.toEqual(new Set([12]));
  });

  it("loadShownCasterIds_afterLaunchIneligibleCaster_kept", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([
      [
        { user_id: 12, ...ADMIN_CASTER },
        { user_id: 13, ...PLAYER },
      ],
      [],
    ]);

    await expect(loadShownCasterIds(fakeConnection({ execute }), 42, [12, 13], "OW", false)).resolves.toEqual(
      new Set([12, 13]),
    );
  });

  it("loadShownCasterIds_duplicateIds_asksOnce", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[], []]);

    await loadShownCasterIds(fakeConnection({ execute }), 42, [12, 12], "OW", true);

    expect(String(execute.mock.calls[0][0])).toContain("mc.user_id IN (?)");
    expect(execute.mock.calls[0][1]).toEqual([42, 12]);
  });
});

describe("refereeKeptColumns", () => {
  it("refereeKeptColumns_alias_readsPseudoEligibilityAndObjectionUnderRefereeNames", () => {
    expect(refereeKeptColumns("ru")).toBe(
      "ru.pseudo AS referee_pseudo, ru.discord_verified_at AS referee_discord_verified_at, " +
        "ru.discord_pseudo AS referee_discord_pseudo, ru.blizzard_sub AS referee_blizzard_sub, " +
        "ru.overwatch_battletag AS referee_overwatch_battletag, " +
        "ru.overwatch_battletag_typed AS referee_overwatch_battletag_typed, ru.is_deleted AS referee_is_deleted, " +
        "ru.is_admin AS referee_is_admin, ru.platform_roles_json AS referee_platform_roles_json, " +
        "ru.referee_objection_at AS referee_objection_at",
    );
  });
});
