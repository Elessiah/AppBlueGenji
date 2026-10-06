import { describe, expect, it } from "@jest/globals";
import {
  EMPTY_PODIUM_TIERS,
  buildPodiumTiers,
  memberPodiumTier,
  podiumTeamIds,
  podiumTierClass,
  standingNameWeight,
  teamPodiumTier,
  visiblePodiumTiers,
} from "@/lib/shared/podium-tiers";

/** Marches du podium du site (docs/features/PODIUM_TIERS.md). */

describe("buildPodiumTiers", () => {
  const ranked = [10, 20, 30, 40];

  it("donne une marche par place aux trois premières équipes, aucune à la 4e", () => {
    const tiers = buildPodiumTiers(ranked, []);
    expect(tiers.teams).toEqual({ 10: 1, 20: 2, 30: 3 });
    expect(teamPodiumTier(tiers, 40)).toBeNull();
    expect(teamPodiumTier(tiers, null)).toBeNull();
  });

  it("propage la marche de l'équipe à ses membres, jamais à ceux d'une équipe hors podium", () => {
    const tiers = buildPodiumTiers(ranked, [
      { userId: 1, teamId: 10 },
      { userId: 2, teamId: 30 },
      { userId: 3, teamId: 40 },
    ]);
    expect(memberPodiumTier(tiers, 1)).toBe(1);
    expect(memberPodiumTier(tiers, 2)).toBe(3);
    expect(memberPodiumTier(tiers, 3)).toBeNull();
    expect(memberPodiumTier(tiers, undefined)).toBeNull();
  });

  it("garde la plus haute marche d'un joueur membre de plusieurs équipes du podium, quel que soit l'ordre", () => {
    const tiers = buildPodiumTiers(ranked, [
      { userId: 5, teamId: 30 },
      { userId: 5, teamId: 20 },
      { userId: 6, teamId: 10 },
      { userId: 6, teamId: 20 },
    ]);
    expect(memberPodiumTier(tiers, 5)).toBe(2);
    expect(memberPodiumTier(tiers, 6)).toBe(1);
  });

  it("ne pose aucune marche sous trois équipes classées (pas de podium sur /classement non plus)", () => {
    expect(buildPodiumTiers([10, 20], [{ userId: 1, teamId: 10 }])).toBe(EMPTY_PODIUM_TIERS);
    expect(buildPodiumTiers([], [])).toBe(EMPTY_PODIUM_TIERS);
    expect(podiumTeamIds([10, 20])).toEqual([]);
    expect(podiumTeamIds(ranked)).toEqual([10, 20, 30]);
  });
});

describe("visiblePodiumTiers", () => {
  const tiers = buildPodiumTiers([10, 20, 30], [{ userId: 1, teamId: 10 }]);

  it("remet tout à un visiteur connecté", () => {
    expect(visiblePodiumTiers(tiers, true)).toBe(tiers);
  });

  it("ne remet que les équipes (publiques) à un visiteur anonyme — aucun membre", () => {
    const anonymous = visiblePodiumTiers(tiers, false);
    expect(anonymous.teams).toEqual(tiers.teams);
    expect(anonymous.members).toEqual({});
  });
});

describe("podiumTierClass", () => {
  it("rend la famille pleine pour une équipe, adoucie pour un membre, rien hors podium", () => {
    expect(podiumTierClass(1)).toBe("podium-tier podium-tier-1");
    expect(podiumTierClass(3, "team")).toBe("podium-tier podium-tier-3");
    expect(podiumTierClass(2, "member")).toBe("podium-member podium-member-2");
    expect(podiumTierClass(null)).toBeUndefined();
  });
});

describe("standingNameWeight", () => {
  it("met en gras l'engagé du lecteur, marche ou non", () => {
    expect(standingNameWeight(true, false)).toBe(700);
    expect(standingNameWeight(true, true)).toBe(700);
  });

  it("laisse une marche du podium porter sa propre graisse", () => {
    expect(standingNameWeight(false, true)).toBeUndefined();
  });

  it("garde 500 pour les autres engagés", () => {
    expect(standingNameWeight(false, false)).toBe(500);
  });
});
