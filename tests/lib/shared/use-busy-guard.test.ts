import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/shared/hooks/useBusyGuard.ts", "utf8");

describe("useBusyGuard (contrat de rendu)", () => {
  it("useBusyGuard_result_memoizedWithIsMounted", () => {
    expect(source).toMatch(/useMemo\(\(\) => \(\{ busy, isBusy, run, isMounted \}\), \[busy, isBusy, run, isMounted\]\)/);
    // Les attributs des boutons viennent de `BusyButton`, plus du hook.
    expect(source).not.toMatch(/busyProps|BUSY_PROPS|IDLE_PROPS/);
  });

  it("useBusyGuard_callbacks_areStableAndFlagIsARef", () => {
    expect(source).toMatch(/const flag = useRef\(false\)/);
    expect(source).toMatch(/const isBusy = useCallback\(\(\) => flag\.current, \[\]\)/);
    expect(source).toMatch(/useCallback<BusyRun>\(\(task\) => runExclusive\(flag, setBusy, task\), \[setBusy\]\)/);
  });

  it("useBusyGuard_isMounted_readsMountedRef", () => {
    expect(source).toMatch(/const isMounted = useCallback\(\(\) => mounted\.current, \[\]\)/);
  });

  it("useBusyGuard_unmountedMidRequest_skipsStateUpdate", () => {
    expect(source).toMatch(/if \(mounted\.current\) setBusyState\(next\)/);
    expect(source).toMatch(/return \(\) => \{\s+mounted\.current = false;/);
  });
});
