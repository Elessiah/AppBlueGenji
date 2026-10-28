import { describe, expect, it, jest } from "@jest/globals";
import { mapMatch } from "@/lib/server/tournaments/_internal";
import {
  castEligibilityBlock,
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
    expect(castEligibilityBlock(ELIGIBLE)).toBeNull();
    expect(castEligibilityBlock({ ...ELIGIBLE, platform_roles_json: JSON.stringify(["ARBITRE"]) })).toBeNull();
  });

  it("donne `live` à un administrateur sans rôle stocké", () => {
    expect(castEligibilityBlock({ ...ELIGIBLE, is_admin: 1, platform_roles_json: null })).toBeNull();
  });

  it.each<[string, Partial<CastEligibilityFields>, string]>([
    ["sans `live`", { platform_roles_json: JSON.stringify(["RECRUTEUR"]) }, "NOT_CASTER"],
    ["aux rôles illisibles", { platform_roles_json: "pas du JSON" }, "NOT_CASTER"],
    ["au tag décertifié", { discord_verified_at: null }, "CASTER_IDENTITY_REQUIRED"],
    ["sans tag", { discord_pseudo: null }, "CASTER_IDENTITY_REQUIRED"],
    ["sans Battle.net", { blizzard_sub: null }, "CASTER_IDENTITY_REQUIRED"],
    ["supprimé", { is_deleted: 1 }, "CASTER_IDENTITY_REQUIRED"],
  ])("refuse un compte %s", (_label, overrides, block) => {
    expect(castEligibilityBlock({ ...ELIGIBLE, ...overrides })).toBe(block);
  });

  it("refuse un compte introuvable", () => {
    expect(castEligibilityBlock(undefined)).toBe("NOT_CASTER");
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
    expect(match).toMatchObject({ refereeAssigned: true, refereeReady: true, selfManaged: false });
    const text = JSON.stringify(match);
    expect(text).not.toContain("950");
    expect(text).not.toContain("arbitre");
    expect(text).not.toContain("Arbitre#1");
  });

  it("tait un arbitre qui ne remplit plus la condition, et son « Prêt » d'un autre appariement", () => {
    expect(mapMatch(row({ ...eligible, referee_platform_roles_json: JSON.stringify(["CASTER"]) })).refereeAssigned).toBe(false);
    expect(mapMatch(row({ ...eligible, referee_ready_at: new Date(), launch_pairing: "1:3" })).refereeReady).toBe(false);
  });

  it("tait, avant le départ, un arbitre qui joue désormais le match ; le garde une fois le match lancé", () => {
    expect(mapMatch(row({ ...eligible, referee_plays_match: 1 })).refereeAssigned).toBe(false);
    expect(mapMatch(row({ ...eligible, referee_plays_match: 0 })).refereeAssigned).toBe(true);
    expect(mapMatch(row({ ...eligible, referee_plays_match: 1, launched_at: new Date() })).refereeAssigned).toBe(true);
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
