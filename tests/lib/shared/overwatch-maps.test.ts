import { describe, expect, it } from "@jest/globals";
import {
  OVERWATCH_MAP_MODES,
  OVERWATCH_MAPS,
  filterOverwatchMaps,
  isOverwatchMap,
} from "@/lib/shared/overwatch-maps";

/** Liste des cartes d'Overwatch de la fenêtre « Cartes et bans » (`docs/features/ROUND_MAPS.md`). */

describe("filterOverwatchMaps", () => {
  it("filterOverwatchMaps_emptyQuery_returnsEveryModeInOrder", () => {
    expect(filterOverwatchMaps("").map((group) => group.mode)).toEqual([...OVERWATCH_MAP_MODES]);
  });

  it("filterOverwatchMaps_queryWithoutAccents_matchesAccentedMap", () => {
    expect(filterOverwatchMaps("grimsvotn")).toEqual([{ mode: "ESCORT", maps: ["Watchpoint: Grímsvötn"] }]);
  });

  it("filterOverwatchMaps_caseAndSpaces_ignored", () => {
    expect(filterOverwatchMaps("  ILIOS ")).toEqual([{ mode: "CONTROL", maps: ["Ilios"] }]);
  });

  it("filterOverwatchMaps_noMatch_returnsNoGroup", () => {
    expect(filterOverwatchMaps("zzz")).toEqual([]);
  });
});

describe("isOverwatchMap", () => {
  it("isOverwatchMap_knownNameOtherCase_returnsTrue", () => {
    expect(isOverwatchMap("king's row")).toBe(true);
  });

  it("isOverwatchMap_unknownName_returnsFalse", () => {
    expect(isOverwatchMap("Tokyo")).toBe(false);
  });
});

describe("OVERWATCH_MAPS", () => {
  it("OVERWATCH_MAPS_names_areUniqueAcrossModes", () => {
    const names = OVERWATCH_MAP_MODES.flatMap((mode) => OVERWATCH_MAPS[mode]);
    expect(new Set(names).size).toBe(names.length);
  });
});
