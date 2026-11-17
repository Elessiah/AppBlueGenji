import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/shared/hooks/useBusyGuard.ts", "utf8");

describe("useBusyGuard (contrat de rendu)", () => {
  it("useBusyGuard_result_memoizedWithIsMounted", () => {
    expect(source).toMatch(
      /useMemo\(\s*\(\) => \(\{ busy: shown, isBusy, run, isMounted, hold, whenIdle \}\),\s*\[shown, isBusy, run, isMounted, hold, whenIdle\],\s*\)/,
    );
    // Les attributs des boutons viennent de `BusyButton`, plus du hook.
    expect(source).not.toMatch(/busyProps|BUSY_PROPS|IDLE_PROPS/);
  });

  it("useBusyGuard_callbacks_areStableAndFlagIsARef", () => {
    expect(source).toMatch(/const flag = useRef\(false\)/);
    expect(source).toMatch(/const isBusy = useCallback\(\(\) => flag\.current \|\| heldRef\.current, \[\]\)/);
    expect(source).toMatch(/\(heldRef\.current \? Promise\.resolve\(undefined\) : runExclusive\(flag, setBusy, task\)\)/);
  });

  it("useBusyGuard_whenIdle_readsSynchronousGuardAtGesture", () => {
    expect(source).toMatch(/if \(!isBusy\(\)\) handler\(\.\.\.args\);/);
    expect(source).toMatch(/\[isBusy\],\s*\);/);
  });

  it("useBusyGuard_isMounted_readsMountedRef", () => {
    expect(source).toMatch(/const isMounted = useCallback\(\(\) => mounted\.current, \[\]\)/);
  });

  it("useBusyGuard_unmountedMidRequest_skipsStateUpdate", () => {
    expect(source).toMatch(/if \(mounted\.current\) setBusyState\(next\)/);
    expect(source).toMatch(/return \(\) => \{\s+mounted\.current = false;/);
  });
});
