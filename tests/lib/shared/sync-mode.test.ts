import { describe, expect, it } from "@jest/globals";
import type { ClientPowerMode } from "@/lib/shared/client-power";
import type { RefreshTier } from "@/lib/shared/refresh-tiers";
import { otherSyncModes, resolveSyncMode, SYNC_MODES, type SyncModeInput } from "@/lib/shared/sync-mode";

function input(overrides: Partial<SyncModeInput> = {}): SyncModeInput {
  return { tier: "STANDARD", power: "FULL", isLive: true, fatal: false, ...overrides };
}

describe("resolveSyncMode", () => {
  it("échec définitif : aucun mode, quels que soient flux et régime", () => {
    expect(resolveSyncMode(input({ fatal: true, power: "MATCH", tier: "PRIORITY" }))).toBeNull();
    expect(resolveSyncMode(input({ fatal: true, isLive: false }))).toBeNull();
  });

  it.each<[RefreshTier, ClientPowerMode]>([
    ["PRIORITY", "FULL"],
    ["STANDARD", "MATCH"],
    ["PRIORITY", "SLEEP"],
    ["STANDARD", "ECO"],
  ])("flux non établi (%s, %s) : relecture", (tier, power) => {
    expect(resolveSyncMode(input({ isLive: false, tier, power }))).toBe("POLLING");
  });

  it("onglet caché : veille, même prioritaire", () => {
    expect(resolveSyncMode(input({ power: "SLEEP", tier: "PRIORITY" }))).toBe("SLEEP");
  });

  it("rencontre en cours : match, même prioritaire", () => {
    expect(resolveSyncMode(input({ power: "MATCH", tier: "PRIORITY" }))).toBe("MATCH");
  });

  it("page sans animation : éco, pour les deux paliers", () => {
    expect(resolveSyncMode(input({ power: "ECO", tier: "PRIORITY" }))).toBe("ECO");
    expect(resolveSyncMode(input({ power: "ECO", tier: "STANDARD" }))).toBe("ECO");
  });

  it("régime complet : le palier décide", () => {
    expect(resolveSyncMode(input({ tier: "PRIORITY" }))).toBe("PRIORITY");
    expect(resolveSyncMode(input({ tier: "STANDARD" }))).toBe("STANDARD");
  });
});

describe("otherSyncModes", () => {
  it.each(SYNC_MODES.map((mode) => [mode]))("%s : les cinq autres, dans l'ordre", (mode) => {
    const others = otherSyncModes(mode);
    expect(others).toHaveLength(SYNC_MODES.length - 1);
    expect(others).not.toContain(mode);
    expect(others).toEqual(SYNC_MODES.filter((candidate) => candidate !== mode));
  });
});
