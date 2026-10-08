import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournament-broadcast", () => ({ openStreamCount: jest.fn(() => 0) }));

import { openStreamCount } from "@/lib/server/tournament-broadcast";
import {
  currentSpectatorLoadLevel,
  LOOP_DELAY_SAMPLE_MS,
  LOOP_PROBE_IDLE_MS,
  recordSpectatorRead,
  resetSpectatorLoad,
  SPECTATOR_READ_WINDOW_MS,
  spectatorLoadSignals,
  spectatorReadsPerMinute,
} from "@/lib/server/spectator-load";
import { SPECTATOR_LOAD_THRESHOLDS } from "@/lib/shared/spectator-view";

/** Charge mesurée en mémoire : les horloges sont passées en paramètre. */

const T0 = 1_000_000;

afterEach(() => {
  resetSpectatorLoad();
  jest.mocked(openStreamCount).mockReturnValue(0);
});

describe("lectures publiques par minute", () => {
  it("compte les lectures de la fenêtre courante", () => {
    for (let i = 0; i < 5; i += 1) recordSpectatorRead(T0 + i);
    expect(spectatorReadsPerMinute(T0 + 10)).toBe(5);
  });

  it("garde la fenêtre précédente au prorata de ce qu'il en reste dans la minute", () => {
    for (let i = 0; i < 10; i += 1) recordSpectatorRead(T0);
    // Nouvelle fenêtre ouverte à T0 + 60 s : les dix lectures comptent entières…
    recordSpectatorRead(T0 + SPECTATOR_READ_WINDOW_MS);
    expect(spectatorReadsPerMinute(T0 + SPECTATOR_READ_WINDOW_MS)).toBe(11);
    // … puis pour moitié à mi-fenêtre.
    expect(spectatorReadsPerMinute(T0 + 1.5 * SPECTATOR_READ_WINDOW_MS)).toBe(6);
  });

  it("oublie tout après deux minutes sans lecture", () => {
    for (let i = 0; i < 10; i += 1) recordSpectatorRead(T0);
    expect(spectatorReadsPerMinute(T0 + 3 * SPECTATOR_READ_WINDOW_MS)).toBe(0);
  });
});

describe("signaux et niveau", () => {
  it("n'a pas de retard de boucle à rapporter avant la première fenêtre close", () => {
    expect(spectatorLoadSignals(T0).eventLoopDelayMs).toBeNull();
    expect(spectatorLoadSignals(T0 + 1).eventLoopDelayMs).toBeNull();
  });

  it("relève un retard de boucle une fois la fenêtre close, pas de la sonde retranché", () => {
    spectatorLoadSignals(T0);
    const delay = spectatorLoadSignals(T0 + LOOP_DELAY_SAMPLE_MS).eventLoopDelayMs;
    expect(delay).not.toBeNull();
    expect(delay).toBeGreaterThanOrEqual(0);
    // Un processus de test au repos ne doit pas lire un niveau de charge.
    expect(delay).toBeLessThan(SPECTATOR_LOAD_THRESHOLDS.eventLoopDelayMs[0]);
  });

  it("désarme la sonde après un long silence des visiteurs sans compte", () => {
    jest.useFakeTimers();
    try {
      recordSpectatorRead(T0);
      spectatorLoadSignals(T0);
      spectatorLoadSignals(T0 + LOOP_DELAY_SAMPLE_MS);
      jest.advanceTimersByTime(LOOP_PROBE_IDLE_MS);
      // Désarmée : la mesure repart de rien.
      expect(spectatorLoadSignals(T0 + 2 * LOOP_DELAY_SAMPLE_MS).eventLoopDelayMs).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("se désarme aussi quand elle n'a servi qu'à mesurer (404, 503)", () => {
    jest.useFakeTimers();
    try {
      // Aucune lecture servie : seule la mesure de charge a armé la sonde.
      spectatorLoadSignals(T0);
      spectatorLoadSignals(T0 + LOOP_DELAY_SAMPLE_MS);
      jest.advanceTimersByTime(LOOP_PROBE_IDLE_MS);
      expect(spectatorLoadSignals(T0 + 2 * LOOP_DELAY_SAMPLE_MS).eventLoopDelayMs).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("lit les flux ouverts de la diffusion", () => {
    jest.mocked(openStreamCount).mockReturnValue(123);
    expect(spectatorLoadSignals(T0).openStreams).toBe(123);
  });

  it("ralentit les visiteurs sans compte quand les flux des membres s'accumulent", () => {
    expect(currentSpectatorLoadLevel(T0)).toBe(0);
    jest.mocked(openStreamCount).mockReturnValue(SPECTATOR_LOAD_THRESHOLDS.openStreams[2]);
    expect(currentSpectatorLoadLevel(T0)).toBe(3);
  });

  it("ralentit quand les lectures publiques affluent", () => {
    for (let i = 0; i < SPECTATOR_LOAD_THRESHOLDS.spectatorReadsPerMinute[0]; i += 1) recordSpectatorRead(T0);
    expect(currentSpectatorLoadLevel(T0 + 1)).toBe(1);
  });
});
