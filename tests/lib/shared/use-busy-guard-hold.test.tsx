import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { HOLD_RELEASE_MS, useBusyGuard, type BusyGuard } from "@/lib/shared/hooks/useBusyGuard";

/**
 * `hold()` (`docs/features/BUSY_BUTTONS.md`) : un geste réussi suivi d'une
 * navigation garde l'écran en attente. Environnement Node : le hook est capté
 * dans un composant rendu côté serveur ; `isBusy()` et `run()` lisent des refs,
 * leur comportement se vérifie donc sans DOM.
 */
function captureGuard(): BusyGuard {
  let captured: BusyGuard | null = null;
  function Probe() {
    captured = useBusyGuard();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (captured === null) throw new Error("hook not rendered");
  return captured;
}

describe("useBusyGuard — hold", () => {
  it("useBusyGuard_initial_isNotBusy", () => {
    const guard = captureGuard();

    expect(guard.busy).toBe(false);
    expect(guard.isBusy()).toBe(false);
  });

  it("hold_called_isBusyTrue", () => {
    const guard = captureGuard();

    guard.hold();

    expect(guard.isBusy()).toBe(true);
  });

  it("run_afterHold_skipsTaskAndResolvesUndefined", async () => {
    const guard = captureGuard();
    const task = jest.fn<() => Promise<number>>().mockResolvedValue(7);
    guard.hold();

    const result = await guard.run(task);

    expect(task).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("run_notHeld_runsTask", async () => {
    const guard = captureGuard();
    const task = jest.fn<() => Promise<number>>().mockResolvedValue(7);

    const result = await guard.run(task);

    expect(task).toHaveBeenCalledTimes(1);
    expect(result).toBe(7);
  });

  describe("auto-release", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("hold_beforeDelay_stillBusy", () => {
      jest.useFakeTimers();
      const guard = captureGuard();
      guard.hold();

      jest.advanceTimersByTime(HOLD_RELEASE_MS - 1);

      expect(guard.isBusy()).toBe(true);
    });

    it("hold_afterDelay_releasedAndRunsAgain", async () => {
      jest.useFakeTimers();
      const guard = captureGuard();
      const task = jest.fn<() => Promise<number>>().mockResolvedValue(3);
      guard.hold();

      jest.advanceTimersByTime(HOLD_RELEASE_MS);
      const result = await guard.run(task);

      expect(guard.isBusy()).toBe(false);
      expect(result).toBe(3);
    });
  });
});
