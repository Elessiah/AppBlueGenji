import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/shared/hooks/useBusyGuard.ts", "utf8");

describe("useBusyGuard (contrat de rendu)", () => {
  it("useBusyGuard_result_isMemoizedSoKeystrokesDoNotChangeIt", () => {
    expect(source).toMatch(/useMemo\(\(\) => \(\{ busy, isBusy, run, busyProps: busy \? BUSY_PROPS : IDLE_PROPS \}\), \[busy, isBusy, run\]\)/);
  });

  it("useBusyGuard_callbacks_areStableAndFlagIsARef", () => {
    expect(source).toMatch(/const flag = useRef\(false\)/);
    expect(source).toMatch(/const isBusy = useCallback\(\(\) => flag\.current, \[\]\)/);
    expect(source).toMatch(/useCallback<BusyRun>\(\(task\) => runExclusive\(flag, setBusy, task\), \[setBusy\]\)/);
  });

  it("useBusyGuard_unmountedMidRequest_skipsStateUpdate", () => {
    expect(source).toMatch(/if \(mounted\.current\) setBusyState\(next\)/);
    expect(source).toMatch(/return \(\) => \{\s+mounted\.current = false;/);
  });

  it("useBusyGuard_busyProps_areSharedConstants", () => {
    expect(source).toContain('const BUSY_PROPS: BusyProps = { "aria-disabled": true, "aria-busy": true };');
    expect(source).toContain('const IDLE_PROPS: BusyProps = { "aria-disabled": undefined, "aria-busy": undefined };');
  });
});
