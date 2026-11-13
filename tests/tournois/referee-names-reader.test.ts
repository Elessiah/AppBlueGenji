import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  cancelScheduledNamesRead,
  createRefereeNamesReader,
  refereeNamesFailureRetries,
  resetRefereeNamesReader,
} from "@/app/(secured)/tournois/[id]/_lib/referee-names-reader";

/** État de la relecture légère des pseudos d'arbitre (EF-60, revue sécurité 1). */

describe("createRefereeNamesReader", () => {
  it("createRefereeNamesReader_fresh_returnsIdleState", () => {
    expect(createRefereeNamesReader()).toEqual({
      attempt: "",
      timer: null,
      abort: null,
      retryAt: 0,
      retryKey: "",
      deferred: false,
      pending: false,
      retries: 0,
    });
  });
});

describe("cancelScheduledNamesRead", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("cancelScheduledNamesRead_noTimer_returnsFalseAndKeepsAttempt", () => {
    const reader = { ...createRefereeNamesReader(), attempt: "5:k5" };

    expect(cancelScheduledNamesRead(reader)).toBe(false);
    expect(reader.attempt).toBe("5:k5");
  });

  it("cancelScheduledNamesRead_timerPending_clearsTimerAndForgetsAttempt", () => {
    const read = jest.fn();
    const reader = { ...createRefereeNamesReader(), attempt: "5:k5", timer: setTimeout(read, 1_000) };

    expect(cancelScheduledNamesRead(reader)).toBe(true);
    jest.advanceTimersByTime(1_000);

    expect(read).not.toHaveBeenCalled();
    expect(reader.timer).toBeNull();
    expect(reader.attempt).toBe("");
  });
});

describe("resetRefereeNamesReader", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("resetRefereeNamesReader_inFlightReadAndTimer_abortsClearsAndResets", () => {
    const read = jest.fn();
    const controller = new AbortController();
    const reader = {
      attempt: "5:k5",
      timer: setTimeout(read, 1_000),
      abort: controller,
      retryAt: 99,
      retryKey: "5:k5",
      deferred: true,
      pending: true,
      retries: 3,
    };

    resetRefereeNamesReader(reader);
    jest.advanceTimersByTime(1_000);

    expect(controller.signal.aborted).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(reader).toEqual(createRefereeNamesReader());
  });
});

describe("refereeNamesFailureRetries", () => {
  it("refereeNamesFailureRetries_429_retries", () => {
    expect(refereeNamesFailureRetries(429)).toBe(true);
  });

  it("refereeNamesFailureRetries_500_retries", () => {
    expect(refereeNamesFailureRetries(500)).toBe(true);
  });

  it("refereeNamesFailureRetries_401_doesNotRetry", () => {
    expect(refereeNamesFailureRetries(401)).toBe(false);
  });

  it("refereeNamesFailureRetries_403_doesNotRetry", () => {
    expect(refereeNamesFailureRetries(403)).toBe(false);
  });

  it("refereeNamesFailureRetries_404_doesNotRetry", () => {
    expect(refereeNamesFailureRetries(404)).toBe(false);
  });
});
