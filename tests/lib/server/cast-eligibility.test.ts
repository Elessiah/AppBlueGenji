import { describe, expect, it } from "@jest/globals";
import { mapMatch } from "@/lib/server/tournaments/_internal";
import { castEligibilityBlock, type CastEligibilityFields } from "@/lib/server/tournaments/cast-eligibility";
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

describe("mapMatch — caster inscrit qui ne remplit plus la condition", () => {
  const caster = (overrides: Partial<CastEligibilityFields> = {}) => {
    const fields = { ...ELIGIBLE, ...overrides };
    return {
      caster_user_id: 900,
      caster_pseudo: "Caster",
      caster_discord_verified_at: fields.discord_verified_at,
      caster_discord_pseudo: fields.discord_pseudo,
      caster_blizzard_sub: fields.blizzard_sub,
      caster_overwatch_battletag: fields.overwatch_battletag,
      caster_is_deleted: fields.is_deleted,
      caster_is_admin: fields.is_admin,
      caster_platform_roles_json: fields.platform_roles_json,
    };
  };

  it("garde un caster éligible", () => {
    const match = mapMatch(matchRow({ status: "READY", ...caster() }));
    expect(match.casterUserId).toBe(900);
    expect(match.casterPseudo).toBe("Caster");
  });

  it("tait un caster devenu inéligible tant que le match n'est pas lancé", () => {
    const match = mapMatch(matchRow({ status: "READY", caster_ready_at: new Date(), ...caster({ blizzard_sub: null }) }));
    expect(match.casterUserId).toBeNull();
    expect(match.casterPseudo).toBeNull();
    expect(match.casterReady).toBe(false);
  });

  it("tait un caster dont le compte a disparu", () => {
    const match = mapMatch(
      matchRow({ status: "READY", ...caster(), caster_is_deleted: null, caster_platform_roles_json: null }),
    );
    expect(match.casterUserId).toBeNull();
  });

  it("garde le caster d'un match lancé ou joué", () => {
    const launched = mapMatch(
      matchRow({ status: "READY", launched_at: new Date(), ...caster({ platform_roles_json: null }) }),
    );
    expect(launched.casterUserId).toBe(900);
    const played = mapMatch(matchRow({ status: "COMPLETED", ...caster({ platform_roles_json: null }) }));
    expect(played.casterUserId).toBe(900);
  });

  it("garde l'inscription stockée d'une lecture partielle, sans la condition", () => {
    const match = mapMatch(matchRow({ status: "READY", caster_user_id: 900, caster_pseudo: "Caster" }));
    expect(match.casterUserId).toBe(900);
  });
});
