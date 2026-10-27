import { describe, expect, it } from "@jest/globals";
import { mapMatch } from "@/lib/server/tournaments/_internal";
import { castEligibilityBlock, type CastEligibilityFields } from "@/lib/server/tournaments/cast-eligibility";
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
});
