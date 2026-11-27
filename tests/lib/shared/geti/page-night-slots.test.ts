import { describe, expect, it } from "@jest/globals";
import { getiTimeSlotMatches, matchesGetiFilter, type GetiFilter, type GetiParsedPost } from "@/lib/shared/geti";
import {
  getiChipMatches,
  getiFilterSync,
  getiPageFilter,
  getiPageSearch,
  getiPostChips,
  parseGetiPageQuery,
  type GetiChip,
} from "@/lib/shared/geti/page";
import { getiRank, parsedGetiPost } from "@/tests/helpers/geti";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");

function slotPost(from: number, to: number | null): GetiParsedPost {
  return parsedGetiPost({ category: "lfp", availability: { days: [], times: [{ from, to }], timezone: null } });
}

describe("getiTimeSlotMatches — minuit", () => {
  it("un horaire qui passe minuit recoupe un créneau de début de nuit", () => {
    expect(getiTimeSlotMatches({ from: 1320, to: 60 }, 0, 120)).toBe(true);
  });

  it("un créneau de nuit (22h → 2h) écarte un horaire d'après-midi", () => {
    expect(getiTimeSlotMatches({ from: 840, to: 960 }, 1320, 120)).toBe(false);
  });

  it("un créneau de nuit garde un horaire de fin de soirée", () => {
    expect(getiTimeSlotMatches({ from: 1380, to: 60 }, 1320, 120)).toBe(true);
  });

  it("une heure seule à 1h tombe dans le créneau de nuit", () => {
    expect(getiTimeSlotMatches({ from: 60, to: null }, 1320, 120)).toBe(true);
  });

  it("une heure seule à midi n'y tombe pas", () => {
    expect(getiTimeSlotMatches({ from: 720, to: null }, 1320, 120)).toBe(false);
  });

  it("un début illisible ne recoupe rien", () => {
    expect(getiTimeSlotMatches({ from: Number.NaN, to: null }, null, null)).toBe(false);
  });

  it("une fin hors de la journée ne recoupe rien", () => {
    expect(getiTimeSlotMatches({ from: 600, to: 2000 }, null, null)).toBe(false);
  });
});

describe("matchesGetiFilter — créneau enregistré", () => {
  it("un créneau qui n'est pas un objet ne filtre rien", () => {
    const filter = { time: "22" } as unknown as GetiFilter;

    expect(matchesGetiFilter(slotPost(600, 660), filter, NOW)).toBe(true);
  });

  it("une borne écrite en texte se lit comme un nombre", () => {
    const filter = { time: { from: "1381" } } as unknown as GetiFilter;

    expect(matchesGetiFilter(slotPost(1260, 1380), filter, NOW)).toBe(false);
  });

  it("des bornes hors de la journée sont ouvertes", () => {
    expect(matchesGetiFilter(slotPost(600, 660), { time: { from: -5, to: 5000 } }, NOW)).toBe(true);
  });
});

describe("matchesGetiFilter — analyse gardée incomplète", () => {
  const partial = { text: "LFP", closed: false, category: "lfp" } as unknown as GetiParsedPost;
  const criteria: GetiFilter = {
    roles: ["TANK"],
    regions: ["EU"],
    days: ["MON"],
    time: { from: 1200 },
    ranks: { min: getiRank("DIAMOND", 3) },
  };

  it("un champ absent ne fait pas échouer le filtre : l'annonce est écartée", () => {
    expect(matchesGetiFilter(partial, criteria, NOW)).toBe(false);
  });

  it("un champ absent passe avec includeUnknown", () => {
    expect(matchesGetiFilter(partial, { ...criteria, includeUnknown: true }, NOW)).toBe(true);
  });
});

describe("page — créneau de nuit de bout en bout", () => {
  const filter = getiPageFilter("lfp", parseGetiPageQuery("lfp", { hfrom: "22", hto: "2" }));

  it("garde une annonce de 23h à 1h", () => {
    expect(matchesGetiFilter(slotPost(1380, 60), filter, NOW)).toBe(true);
  });

  it("écarte une annonce de 14h à 16h", () => {
    expect(matchesGetiFilter(slotPost(840, 960), filter, NOW)).toBe(false);
  });

  it("l'adresse garde l'ordre choisi", () => {
    expect(getiPageSearch(parseGetiPageQuery("lfp", { hfrom: "22", hto: "2" }))).toBe("?hfrom=22&hto=2");
  });

  it("l'étiquette d'un horaire de nuit est mise en avant", () => {
    const night: GetiChip = { kind: "time", from: 1380, to: 60, timezone: null };

    expect(getiChipMatches(night, filter)).toBe(true);
  });

  it("l'étiquette d'un horaire d'après-midi ne l'est pas", () => {
    const afternoon: GetiChip = { kind: "time", from: 840, to: 960, timezone: null };

    expect(getiChipMatches(afternoon, filter)).toBe(false);
  });
});

describe("getiPostChips — analyse gardée incomplète", () => {
  it("une analyse sans listes ni rangs ne donne aucune étiquette", () => {
    const partial = { text: "LFP", closed: false } as unknown as GetiParsedPost;

    expect(getiPostChips(partial)).toEqual([]);
  });
});

describe("getiChipMatches — rang par rôle", () => {
  const high = getiRank("GRANDMASTER", 3);
  const dpsChip: GetiChip = { kind: "rank", role: "DPS", min: high, max: high };
  const tankChip: GetiChip = { kind: "rank", role: "TANK", min: high, max: high };
  const globalChip: GetiChip = { kind: "rank", role: null, min: high, max: high };
  const filter: GetiFilter = { roles: ["TANK"], ranks: { min: getiRank("MASTER", 1) } };

  it("le rang d'un rôle non voulu n'est pas mis en avant", () => {
    expect(getiChipMatches(dpsChip, filter)).toBe(false);
  });

  it("le rang du rôle voulu l'est", () => {
    expect(getiChipMatches(tankChip, filter)).toBe(true);
  });

  it("un rang global l'est aussi", () => {
    expect(getiChipMatches(globalChip, filter)).toBe(true);
  });

  it("avec « Flex » seul voulu, le rang de chaque rôle compte", () => {
    expect(getiChipMatches(dpsChip, { ...filter, roles: ["FLEX"] })).toBe(true);
  });
});

describe("getiFilterSync", () => {
  it("sans changement en attente, l'état du serveur est repris", () => {
    expect(getiFilterSync(null, "?role=tank")).toEqual({ adopt: true, pending: null });
  });

  it("le rendu d'un changement plus ancien est ignoré, l'attente reste", () => {
    expect(getiFilterSync("?role=tank,dps", "?role=tank")).toEqual({ adopt: false, pending: "?role=tank,dps" });
  });

  it("le rendu du dernier changement lève l'attente", () => {
    expect(getiFilterSync("?role=tank,dps", "?role=tank,dps")).toEqual({ adopt: true, pending: null });
  });
});
