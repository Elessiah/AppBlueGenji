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

    expect(source).toMatch(/if \(at === null \|\| now === null \|\| now >= at\) return;/);
  });
});
