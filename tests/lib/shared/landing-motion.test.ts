import { describe, expect, it } from "@jest/globals";
import { COUNT_UP_MS, countUpValue, shouldDeferReveal } from "@/lib/shared/landing-motion";
import { powerPolicy } from "@/lib/shared/client-power";

const base = { motion: true, observerSupported: true, top: 1200, viewportHeight: 800 };

describe("shouldDeferReveal", () => {
  it("masque une section sous la ligne de flottaison quand le mouvement est permis", () => {
    expect(shouldDeferReveal(base)).toBe(true);
  });

  it("ne masque jamais ce qui est déjà à l'écran (aucun éclair, aucun recul du LCP)", () => {
    expect(shouldDeferReveal({ ...base, top: 0 })).toBe(false);
    expect(shouldDeferReveal({ ...base, top: 799 })).toBe(false);
    expect(shouldDeferReveal({ ...base, top: 800 })).toBe(true);
  });

  it("ne masque rien sans observateur : la section ne réapparaîtrait pas", () => {
    expect(shouldDeferReveal({ ...base, observerSupported: false })).toBe(false);
  });

  it("ne masque rien quand le mouvement est coupé", () => {
    expect(shouldDeferReveal({ ...base, motion: false })).toBe(false);
  });

  it("suit le régime de charge : mouvement réduit, menu d'accessibilité, onglet caché, machine à la peine", () => {
    const focused = { attention: "FOCUSED", matchFocus: false } as const;
    expect(powerPolicy(focused).decorativeMotion).toBe(true);
    for (const input of [
      { ...focused, reducedMotion: true },
      { ...focused, motionSetting: true },
      { ...focused, performanceLimited: true },
      { attention: "BACKGROUND", matchFocus: false } as const,
    ]) {
      const motion = powerPolicy(input).decorativeMotion;
      expect(motion).toBe(false);
      expect(shouldDeferReveal({ ...base, motion })).toBe(false);
    }
  });
});

describe("countUpValue", () => {
  it("part de 0 et arrive exactement à la cible", () => {
    expect(countUpValue(347, 0)).toBe(0);
    expect(countUpValue(347, 1)).toBe(347);
    expect(countUpValue(347, 2)).toBe(347);
  });

  it("décélère : plus de la moitié du chemin à mi-temps, sans jamais dépasser", () => {
    const half = countUpValue(1000, 0.5);
    expect(half).toBeGreaterThan(500);
    expect(half).toBeLessThan(1000);
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const value = countUpValue(1000, step / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1000);
      previous = value;
    }
  });

  it("borne les entrées invalides", () => {
    expect(countUpValue(50, -1)).toBe(0);
    expect(countUpValue(50, Number.NaN)).toBe(50);
    expect(countUpValue(Number.NaN, 0.5)).toBe(0);
    expect(countUpValue(0, 0.5)).toBe(0);
  });

  it("dure un peu plus d'une seconde", () => {
    expect(COUNT_UP_MS).toBeGreaterThanOrEqual(800);
    expect(COUNT_UP_MS).toBeLessThanOrEqual(2000);
  });
});
