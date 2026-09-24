import { describe, expect, it } from "@jest/globals";
import {
  countdownRemaining,
  isCountdownHeld,
  pauseCountdown,
  resumeCountdown,
  startCountdown,
} from "@/lib/shared/pausable-countdown";

describe("compte à rebours suspendable", () => {
  it("décompte le temps écoulé depuis le départ", () => {
    const countdown = startCountdown(5000, 1000);
    expect(countdownRemaining(countdown, 1000)).toBe(5000);
    expect(countdownRemaining(countdown, 3000)).toBe(3000);
  });

  it("ne descend jamais sous zéro", () => {
    expect(countdownRemaining(startCountdown(5000, 0), 9000)).toBe(0);
    expect(countdownRemaining(startCountdown(-10, 0), 0)).toBe(0);
  });

  it("ignore une horloge qui recule", () => {
    expect(countdownRemaining(startCountdown(5000, 1000), 500)).toBe(5000);
  });

  it("retient le temps restant à la pause et ne le consomme plus", () => {
    const paused = pauseCountdown(startCountdown(5000, 0), 2000);
    expect(paused).toEqual({ remainingMs: 3000, runningSince: null });
    expect(countdownRemaining(paused, 60_000)).toBe(3000);
  });

  it("reprend là où il s'était arrêté", () => {
    const resumed = resumeCountdown(pauseCountdown(startCountdown(5000, 0), 2000), 10_000);
    expect(countdownRemaining(resumed, 10_000)).toBe(3000);
    expect(countdownRemaining(resumed, 11_000)).toBe(2000);
  });

  it("cumule plusieurs pauses sans perdre ni gagner de temps", () => {
    let countdown = startCountdown(5000, 0);
    countdown = pauseCountdown(countdown, 1000); // 4000 restants
    countdown = resumeCountdown(countdown, 5000);
    countdown = pauseCountdown(countdown, 6500); // 2500 restants
    countdown = resumeCountdown(countdown, 20_000);
    expect(countdownRemaining(countdown, 21_000)).toBe(1500);
  });

  it("une pause redoublée ou une reprise redoublée est sans effet", () => {
    const paused = pauseCountdown(startCountdown(5000, 0), 1000);
    expect(pauseCountdown(paused, 4000)).toBe(paused);
    const running = startCountdown(5000, 0);
    expect(resumeCountdown(running, 3000)).toBe(running);
  });
});

describe("isCountdownHeld", () => {
  it("suspend au survol ou au focus quand le lecteur n'a rien choisi", () => {
    expect(isCountdownHeld(null, false, false)).toBe(false);
    expect(isCountdownHeld(null, true, false)).toBe(true);
    expect(isCountdownHeld(null, false, true)).toBe(true);
  });

  it("« Pause » tient le décompte arrêté, pointeur parti ou non", () => {
    expect(isCountdownHeld("PAUSED", false, false)).toBe(true);
    expect(isCountdownHeld("PAUSED", true, true)).toBe(true);
  });

  it("« Reprendre » relance même sous le pointeur qui vient de cliquer", () => {
    expect(isCountdownHeld("RUNNING", true, true)).toBe(false);
  });
});
