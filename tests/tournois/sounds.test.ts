import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { CHIME_CLOSE_FALLBACK_MS, playAlertChime } from "@/app/(secured)/tournois/[id]/_lib/sounds";

/**
 * Signal sonore (`_lib/sounds.ts`). Jest tourne sous Node, sans Web Audio : un
 * `AudioContext` factice suffit à tenir la seule règle qui compte ici — chaque
 * contexte ouvert est refermé, y compris celui que le navigateur crée suspendu.
 */

type FakeContext = {
  state: "running" | "suspended";
  currentTime: number;
  close: jest.Mock<() => Promise<void>>;
  started: boolean;
  onended: (() => void) | null;
};

const created: FakeContext[] = [];
let nextState: FakeContext["state"] = "running";

class FakeAudioContext {
  state = nextState;
  currentTime = 0;
  destination = {};
  close = jest.fn(() => Promise.resolve());
  started = false;
  onended: (() => void) | null = null;
  constructor() {
    created.push(this as unknown as FakeContext);
  }
  createOscillator() {
    const oscillator = {
      frequency: { value: 0 },
      type: "sine",
      connect: () => undefined,
      start: () => {
        this.started = true;
      },
      stop: () => undefined,
    };
    // `onended` est posé par le code testé : on le relaie au contexte factice.
    Object.defineProperty(oscillator, "onended", {
      set: (fn: () => void) => {
        this.onended = fn;
      },
    });
    return oscillator;
  }
  createGain() {
    return {
      gain: { value: 0, exponentialRampToValueAtTime: () => undefined },
      connect: () => undefined,
    };
  }
}

const g = globalThis as unknown as { AudioContext?: unknown };

beforeEach(() => {
  created.length = 0;
  nextState = "running";
  g.AudioContext = FakeAudioContext;
  jest.useFakeTimers();
});

afterEach(() => {
  delete g.AudioContext;
  jest.useRealTimers();
});

describe("playAlertChime", () => {
  it("joue la note puis referme le contexte à la fin", () => {
    playAlertChime("MATCH_READY");
    const [context] = created;
    expect(context.started).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
    context.onended?.();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("joue même sur un contexte encore suspendu à sa construction", () => {
    // La spécification laisse tout contexte neuf à « suspended » jusqu'au
    // démarrage effectif du rendu : le refermer là couperait le signal.
    nextState = "suspended";
    playAlertChime("SCORE_TO_CONFIRM");
    const [context] = created;
    expect(context.started).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
  });

  it("referme un contexte resté suspendu, dont la note ne finit jamais", () => {
    // Son bloqué faute de geste sur la page : l'horloge n'avance pas et
    // `onended` ne vient pas — seul le filet de sécurité le referme.
    nextState = "suspended";
    playAlertChime("SCORE_TO_CONFIRM");
    const [context] = created;
    jest.advanceTimersByTime(CHIME_CLOSE_FALLBACK_MS);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("referme le contexte au plus tard après le filet de sécurité", () => {
    playAlertChime("MATCH_READY");
    const [context] = created;
    jest.advanceTimersByTime(CHIME_CLOSE_FALLBACK_MS);
    expect(context.close).toHaveBeenCalledTimes(1);
    // La fin de note arrivée après coup ne le referme pas une seconde fois.
    context.onended?.();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("n'ouvre aucun contexte pour un évènement sans signal", () => {
    playAlertChime("ROUND_STARTED");
    playAlertChime("TOURNAMENT_STARTED");
    expect(created).toHaveLength(0);
  });

  it("ne lève jamais, même sans Web Audio", () => {
    delete g.AudioContext;
    expect(() => playAlertChime("MATCH_READY")).not.toThrow();
  });
});
