import { describe, expect, it } from "@jest/globals";
import {
  BLIZZARD_BATTLETAG_SET_SQL,
  battletagFromBlizzard,
  battletagFromBlizzardSql,
  verifiedBattletagSql,
} from "@/lib/server/battletag-origin";

/**
 * D'où vient le BattleTag (D3, `docs/features/BATTLETAG_ORIGIN.md`) : un tag
 * tapé, gardé sous un Battle.net qui n'en donnait aucun, n'est jamais vérifié.
 */

describe("battletagFromBlizzard", () => {
  it("battletagFromBlizzard_battleNetLinkedAndTagFromIt_returnsTrue", () => {
    expect(battletagFromBlizzard({ blizzard_sub: "bz-1", overwatch_battletag_typed: 0 })).toBe(true);
  });

  it("battletagFromBlizzard_typedTagUnderBattleNet_returnsFalse", () => {
    expect(battletagFromBlizzard({ blizzard_sub: "bz-1", overwatch_battletag_typed: 1 })).toBe(false);
  });

  it("battletagFromBlizzard_driverReturnsBoolean_readsItLikeANumber", () => {
    expect(battletagFromBlizzard({ blizzard_sub: "bz-1", overwatch_battletag_typed: true })).toBe(false);
    expect(battletagFromBlizzard({ blizzard_sub: "bz-1", overwatch_battletag_typed: false })).toBe(true);
  });

  it("battletagFromBlizzard_rowReadWithoutTheColumn_countsAsFromBlizzard", () => {
    // Ligne antérieure à la colonne, ou lue sans elle : la règle d'avant.
    expect(battletagFromBlizzard({ blizzard_sub: "bz-1" })).toBe(true);
    expect(battletagFromBlizzard({ blizzard_sub: "bz-1", overwatch_battletag_typed: null })).toBe(true);
  });

  it("battletagFromBlizzard_noBattleNet_returnsFalse", () => {
    expect(battletagFromBlizzard({ blizzard_sub: null, overwatch_battletag_typed: 0 })).toBe(false);
  });
});

describe("battletagFromBlizzardSql / verifiedBattletagSql", () => {
  it("battletagFromBlizzardSql_withoutAlias_readsBareColumns", () => {
    expect(battletagFromBlizzardSql()).toBe("(blizzard_sub IS NOT NULL AND overwatch_battletag_typed = 0)");
  });

  it("battletagFromBlizzardSql_withAlias_prefixesEveryColumn", () => {
    expect(battletagFromBlizzardSql("u")).toBe("(u.blizzard_sub IS NOT NULL AND u.overwatch_battletag_typed = 0)");
  });

  it("verifiedBattletagSql_withAlias_addsANonEmptyTag", () => {
    expect(verifiedBattletagSql("u")).toBe(
      "((u.blizzard_sub IS NOT NULL AND u.overwatch_battletag_typed = 0) AND COALESCE(u.overwatch_battletag, '') <> '')",
    );
  });
});

describe("BLIZZARD_BATTLETAG_SET_SQL", () => {
  it("BLIZZARD_BATTLETAG_SET_SQL_noTagFromBlizzard_keepsTheTypedOneMarkedTyped", () => {
    expect(BLIZZARD_BATTLETAG_SET_SQL).toContain("overwatch_battletag = COALESCE(?, overwatch_battletag)");
    expect(BLIZZARD_BATTLETAG_SET_SQL).toContain("overwatch_battletag_typed = CASE WHEN ? IS NULL THEN 1 ELSE 0 END");
  });

  it("BLIZZARD_BATTLETAG_SET_SQL_takesExactlyTwoParameters", () => {
    expect(BLIZZARD_BATTLETAG_SET_SQL.split("?")).toHaveLength(3);
  });
});
