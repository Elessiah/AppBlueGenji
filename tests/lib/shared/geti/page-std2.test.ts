import { describe, expect, it } from "@jest/globals";
import { getiTimeSlotMatches, matchesGetiFilter, type GetiFilter, type GetiParsedPost } from "@/lib/shared/geti";
import { getiStoredRankRange, getiStoredTimeSlot } from "@/lib/shared/geti/filter";
import {
  emptyGetiPageQuery,
  getiChipMatches,
  getiFilterSync,
  getiNormalizedSearch,
  getiPostChips,
  type GetiChip,
} from "@/lib/shared/geti/page";
import { getiRank, parsedGetiPost } from "@/tests/helpers/geti";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");

type StoredTimes = GetiParsedPost["availability"]["times"];
type StoredByRole = GetiParsedPost["ranks"]["byRole"];

/** Annonce dont les horaires gardés sont écrits tels quels (ligne abîmée comprise). */
function timesPost(times: unknown[]): GetiParsedPost {
  return parsedGetiPost({
    category: "lfp",
    availability: { days: [], times: times as StoredTimes, timezone: null },
  });
}

describe("getiTimeSlotMatches — fin à minuit", () => {
  it("« 22h-0h » ne recoupe pas un créneau de début de nuit", () => {
    expect(getiTimeSlotMatches({ from: 1320, to: 0 }, 0, 120)).toBe(false);
  });

  it("« 22h-0h » recoupe la fin de soirée", () => {
    expect(getiTimeSlotMatches({ from: 1320, to: 0 }, 1380, 1440)).toBe(true);
  });

  it("« 0h-0h » reste minuit pile", () => {
    expect(getiTimeSlotMatches({ from: 0, to: 0 }, 0, 60)).toBe(true);
  });

  it("un horaire nul ne recoupe rien, sans erreur", () => {
    const slot = null as unknown as { from: number; to: number | null };

    expect(getiTimeSlotMatches(slot, 0, 120)).toBe(false);
  });
});

describe("matchesGetiFilter — horaires abîmés", () => {
  const filter: GetiFilter = { time: { from: 0, to: 120 } };

  it("un horaire nul vaut un horaire non lu : gardé avec includeUnknown", () => {
    expect(matchesGetiFilter(timesPost([null]), { ...filter, includeUnknown: true }, NOW)).toBe(true);
  });

  it("un horaire nul vaut un horaire non lu : écarté sans includeUnknown", () => {
    expect(matchesGetiFilter(timesPost([null]), { ...filter, includeUnknown: false }, NOW)).toBe(false);
  });

  it("à côté d'un horaire abîmé, l'horaire valide est jugé", () => {
    expect(matchesGetiFilter(timesPost([null, { from: 1320, to: 60 }]), filter, NOW)).toBe(true);
  });
});

describe("matchesGetiFilter — rang par rôle abîmé", () => {
  it("un rang par rôle aux bornes nulles retombe sur la fourchette globale", () => {
    const gold = getiRank("GOLD", 3);
    const post = parsedGetiPost({
      roles: ["TANK"],
      ranks: { min: gold, max: gold, byRole: { TANK: { min: null, max: null } } as unknown as StoredByRole },
    });
    const filter: GetiFilter = { roles: ["TANK"], ranks: { min: getiRank("GOLD", 5) }, includeUnknown: false };

    expect(matchesGetiFilter(post, filter, NOW)).toBe(true);
  });
});

describe("getiStoredTimeSlot", () => {
  it("une heure seule garde une fin absente", () => {
    expect(getiStoredTimeSlot({ from: 600 })).toEqual({ from: 600, to: null });
  });

  it("une fin hors de la journée rend l'horaire illisible", () => {
    expect(getiStoredTimeSlot({ from: 600, to: 2000 })).toBeNull();
  });

  it("une valeur qui n'est pas un objet est illisible", () => {
    expect(getiStoredTimeSlot("21h")).toBeNull();
  });
});

describe("getiStoredRankRange", () => {
  const gold = getiRank("GOLD", 2);

  it("deux vrais rangs donnent la fourchette", () => {
    expect(getiStoredRankRange({ min: gold, max: gold })).toEqual({ min: gold, max: gold });
  });

  it("un palier inconnu rend la fourchette illisible", () => {
    expect(getiStoredRankRange({ min: { tier: "WOOD", division: 1 }, max: gold })).toBeNull();
  });

  it("une borne nulle rend la fourchette illisible", () => {
    expect(getiStoredRankRange({ min: null, max: gold })).toBeNull();
  });
});

describe("getiNormalizedSearch", () => {
  it("des rangs inversés sont remis dans l'ordre que le serveur rendra", () => {
    const query = { ...emptyGetiPageQuery(), rankMin: getiRank("MASTER", 1), rankMax: getiRank("GOLD", 5) };

    expect(getiNormalizedSearch("lfp", query)).toBe("?rmin=gold-5&rmax=master-1");
  });

  it("un critère que la catégorie ne propose pas est retiré", () => {
    const query = { ...emptyGetiPageQuery(), roles: ["TANK" as const] };

    expect(getiNormalizedSearch("lfs", query)).toBe("");
  });
});

describe("getiChipMatches — repli sur la fourchette globale", () => {
  const range = { min: getiRank("GOLD", 1), max: getiRank("PLATINUM", 3) };
  const dpsChip: GetiChip = { kind: "rank", role: "DPS", ...range };
  const tankChip: GetiChip = { kind: "rank", role: "TANK", ...range };
  const filter: GetiFilter = { roles: ["TANK"], ranks: { min: getiRank("GOLD", 1) } };

  it("sans rang du rôle voulu sur la carte, le rang par rôle est mis en avant", () => {
    expect(getiChipMatches(dpsChip, filter, [dpsChip])).toBe(true);
  });

  it("avec le rang du rôle voulu sur la carte, l'autre rôle ne l'est pas", () => {
    expect(getiChipMatches(dpsChip, filter, [tankChip, dpsChip])).toBe(false);
  });
});

describe("getiPostChips — données abîmées", () => {
  it("un horaire nul et un rang par rôle illisible ne donnent pas d'étiquette", () => {
    const gold = getiRank("GOLD", 2);
    const post = parsedGetiPost({
      ranks: { min: gold, max: gold, byRole: { TANK: { min: null, max: gold } } as unknown as StoredByRole },
      availability: { days: [], times: [null, { from: 600, to: 660 }] as unknown as StoredTimes, timezone: null },
    });

    expect(getiPostChips(post)).toEqual([
      { kind: "rank", role: null, min: gold, max: gold },
      { kind: "time", from: 600, to: 660, timezone: null },
    ]);
  });
});

describe("getiFilterSync — rendu à adresse égale", () => {
  it("un geste défait avant son rendu : le rendu qui redonne l'adresse lève l'attente", () => {
    expect(getiFilterSync("", "")).toEqual({ adopt: true, pending: null });
  });
});
