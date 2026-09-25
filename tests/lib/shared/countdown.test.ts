import { describe, expect, it } from "@jest/globals";
import { computeCountdown, countdownAccessibleLabel } from "@/lib/shared/countdown";

describe("computeCountdown", () => {
  it("décompose l'écart en jours/heures/minutes/secondes", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const target = new Date(now + 1 * 86400000 + 2 * 3600000 + 3 * 60000 + 4000).toISOString();

    expect(computeCountdown(target, now)).toEqual({ d: 1, h: 2, m: 3, s: 4 });
  });

  it("ne rend jamais un écart négatif une fois l'échéance dépassée", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const target = new Date(now - 60000).toISOString();

    expect(computeCountdown(target, now)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });
});

describe("countdownAccessibleLabel", () => {
  it("garde les deux plus grandes unités non nulles, au pluriel", () => {
    expect(countdownAccessibleLabel({ d: 1, h: 23, m: 21, s: 31 })).toBe("Début dans 1 jour 23 heures");
    expect(countdownAccessibleLabel({ d: 2, h: 0, m: 0, s: 0 })).toBe("Début dans 2 jours 0 heure");
  });

  it("descend aux heures puis aux minutes une fois les jours écoulés", () => {
    expect(countdownAccessibleLabel({ d: 0, h: 3, m: 45, s: 0 })).toBe("Début dans 3 heures 45 minutes");
    expect(countdownAccessibleLabel({ d: 0, h: 0, m: 5, s: 9 })).toBe("Début dans 5 minutes 9 secondes");
  });

  it("retombe sur les secondes seules dans la dernière minute", () => {
    expect(countdownAccessibleLabel({ d: 0, h: 0, m: 0, s: 12 })).toBe("Début dans 12 secondes");
  });

  it("ne dit jamais « dans 0 seconde » une fois l'échéance atteinte ou dépassée", () => {
    // `computeCountdown` plafonne l'écart à zéro : sans ce cas, la phrase
    // resterait « dans 0 seconde » à chaque relecture après le coup d'envoi.
    expect(countdownAccessibleLabel({ d: 0, h: 0, m: 0, s: 0 })).toBe("Début imminent");
  });
});
