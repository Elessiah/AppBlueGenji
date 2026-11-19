import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Jest tourne en environnement `node`, sans rendu : un hook n'y est pas
 * montable. Restent les garanties de structure (comme `useTournamentNow`) :
 * le module s'importe, un seul minuteur ponctuel, délai plafonné, et un réveil
 * relit l'heure réelle au lieu de supposer l'instant atteint.
 */

const SOURCE = join(__dirname, "..", "..", "lib", "shared", "hooks", "useInstantClock.ts");

describe("useInstantClock", () => {
  it("useInstantClock_imports_exposesHookTakingOneArgument", () => {
    const module = require("@/lib/shared/hooks/useInstantClock");

    expect(typeof module.useInstantClock).toBe("function");
    expect(module.useInstantClock).toHaveLength(1);
  });

  it("useInstantClock_source_capsDelayAndRereadsRealTime", () => {
    const source = readFileSync(SOURCE, "utf8");

    expect(source).toContain("MAX_TIMEOUT_MS = 2_147_483_647");
    expect(source).toMatch(/setTimeout\(\(\) => setNow\(Date\.now\(\)\), delay\)/);
    expect(source).not.toContain("setInterval");
  });

  it("useInstantClock_source_noTimerOnceReached", () => {
    const source = readFileSync(SOURCE, "utf8");

    expect(source).toMatch(/if \(boundary === null\) return;/);
  });

  it("useInstantClock_source_skipsClockReadWithoutInstant", () => {
    const source = readFileSync(SOURCE, "utf8");

    expect(source).toMatch(/if \(at === null\) return;\r?\n\s+setNow\(Date\.now\(\)\);/);
  });
});

describe("nextInstantBoundary", () => {
  const { nextInstantBoundary } = require("@/lib/shared/hooks/useInstantClock");
  const HOUR = 3_600_000;

  it("nextInstantBoundary_noInstant_returnsNull", () => {
    expect(nextInstantBoundary(1000, null, 24 * HOUR)).toBeNull();
  });

  it("nextInstantBoundary_reachedInstant_returnsNull", () => {
    expect(nextInstantBoundary(5000, 5000)).toBeNull();
    expect(nextInstantBoundary(6000, 5000, HOUR)).toBeNull();
  });

  it("nextInstantBoundary_noLead_returnsInstant", () => {
    expect(nextInstantBoundary(1000, 5000)).toBe(5000);
  });

  it("nextInstantBoundary_farAhead_returnsLeadThenInstant", () => {
    const at = 100 * HOUR;
    expect(nextInstantBoundary(0, at, 24 * HOUR)).toBe(76 * HOUR);
    expect(nextInstantBoundary(76 * HOUR, at, 24 * HOUR)).toBe(at);
    expect(nextInstantBoundary(80 * HOUR, at, 24 * HOUR)).toBe(at);
  });

  it("nextInstantBoundary_negativeLead_treatedAsNone", () => {
    expect(nextInstantBoundary(0, 5000, -10)).toBe(5000);
  });
});

describe("useInstantClock — régime de charge", () => {
  it("useInstantClock_source_gatesTimerOnClientPowerClocks", () => {
    const source = readFileSync(SOURCE, "utf8");

    expect(source).toContain("const { clocks } = useClientPower();");
    expect(source).toContain("if (now === null || !clocks) return;");
    // Retour au premier plan : l'heure relue aussitôt.
    expect(source).toMatch(/setNow\(Date\.now\(\)\);\r?\n\s+\}, \[at, clocks\]\);/);
  });
});
