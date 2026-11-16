import { describe, expect, it, jest } from "@jest/globals";
import { onSessionChanged, signalSessionChanged } from "@/lib/shared/session-change-signal";

describe("session-change-signal", () => {
  it("signalSessionChanged_listenerRegistered_callsIt", () => {
    const listener = jest.fn();
    const stop = onSessionChanged(listener);

    signalSessionChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("signalSessionChanged_listenerStopped_notCalled", () => {
    const listener = jest.fn();
    onSessionChanged(listener)();

    signalSessionChanged();

    expect(listener).not.toHaveBeenCalled();
  });

  it("signalSessionChanged_listenerStopsItselfWhileCalled_othersStillCalled", () => {
    const second = jest.fn();
    const stopFirst = onSessionChanged(() => stopFirst());
    const stopSecond = onSessionChanged(second);

    signalSessionChanged();
    signalSessionChanged();

    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });
});
