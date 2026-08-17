import { describe, expect, it } from "@jest/globals";
import {
  addPhase,
  createDefaultPhase,
  movePhase,
  phaseErrorMessage,
  phaseFormatLabel,
  phaseSummary,
  removePhase,
} from "@/app/(secured)/tournois/creer/phase-form";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import { validatePhases } from "@/lib/shared/tournament-phases";

function phase(overrides: Partial<PhaseConfig> = {}): PhaseConfig {
  return {
    position: 1,
    format: "SINGLE",
    name: null,
    qualifierMode: "PERCENT",
    qualifierValue: 50,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: 3,
    survivalRoundsPerCut: 3,
    ...overrides,
  };
}

describe("phase-form — createDefaultPhase", () => {
  it("crée une phase avec la position et le format spécifiés", () => {
    const p = createDefaultPhase(1, "SWISS");
    expect(p.position).toBe(1);
    expect(p.format).toBe("SWISS");
  });

  it("initialise des valeurs cohérentes", () => {
    const p = createDefaultPhase(1, "SINGLE");
    expect(p.name).toBeNull();
    expect(p.qualifierMode).toBe("PERCENT");
    expect(p.qualifierValue).toBe(50);
    expect(p.hasThirdPlaceMatch).toBe(false);
  });

  it("fixe qualifierValue à 100 pour SURVIVAL", () => {
    const p = createDefaultPhase(1, "SURVIVAL");
    expect(p.qualifierValue).toBe(100);
  });

  it("initialise les cadences SURVIVAL à 3", () => {
    const p = createDefaultPhase(1, "SURVIVAL");
    expect(p.survivalRoundsBeforeFirstCut).toBe(3);
    expect(p.survivalRoundsPerCut).toBe(3);
  });

  it("génère une phase validable avec validatePhases quand couplée à une phase finale", () => {
    const phases = [
      createDefaultPhase(1, "SWISS"),
      createDefaultPhase(2, "SINGLE"),
    ];
    expect(validatePhases(phases)).toBeNull();
  });
});

describe("phase-form — movePhase", () => {
  it("échange deux phases et renumérote les positions", () => {
    const phases = [phase({ position: 1 }), phase({ position: 2 }), phase({ position: 3 })];
    const moved = movePhase(phases, 0, 1);
    expect(moved[0].position).toBe(1);
    expect(moved[1].position).toBe(2);
    expect(moved[2].position).toBe(3);
    expect(moved[1].format).toBe("SINGLE");
    expect(moved[0].format).toBe("SINGLE");
  });

  it("déplace une phase vers le bas", () => {
    const phases = [
      phase({ position: 1, format: "SWISS" }),
      phase({ position: 2, format: "SINGLE" }),
      phase({ position: 3, format: "DOUBLE" }),
    ];
    const moved = movePhase(phases, 0, 1);
    expect(moved[0].format).toBe("SINGLE");
    expect(moved[1].format).toBe("SWISS");
    expect(moved[2].format).toBe("DOUBLE");
  });

  it("déplace une phase vers le haut", () => {
    const phases = [
      phase({ position: 1, format: "SWISS" }),
      phase({ position: 2, format: "SINGLE" }),
      phase({ position: 3, format: "DOUBLE" }),
    ];
    const moved = movePhase(phases, 2, -1);
    expect(moved[0].format).toBe("SWISS");
    expect(moved[1].format).toBe("DOUBLE");
    expect(moved[2].format).toBe("SINGLE");
  });

  it("ignorerait un mouvement de la première phase vers le haut", () => {
    const phases = [phase({ position: 1, format: "SWISS" }), phase({ position: 2, format: "SINGLE" })];
    const moved = movePhase(phases, 0, -1);
    expect(moved).toEqual(phases);
  });

  it("ignorerait un mouvement de la dernière phase vers le bas", () => {
    const phases = [phase({ position: 1, format: "SWISS" }), phase({ position: 2, format: "SINGLE" })];
    const moved = movePhase(phases, 1, 1);
    expect(moved).toEqual(phases);
  });

  it("renumérote correctement après plusieurs mouvements", () => {
    let phases = [
      phase({ position: 1, format: "SWISS" }),
      phase({ position: 2, format: "SINGLE" }),
      phase({ position: 3, format: "DOUBLE" }),
    ];
    phases = movePhase(phases, 0, 1);
    phases = movePhase(phases, 1, 1);
    expect(phases.map((p) => p.position)).toEqual([1, 2, 3]);
  });
});

describe("phase-form — removePhase", () => {
  it("supprime une phase et renumérote les survivantes", () => {
    const phases = [phase({ position: 1 }), phase({ position: 2 }), phase({ position: 3 })];
    const removed = removePhase(phases, 1);
    expect(removed.length).toBe(2);
    expect(removed[0].position).toBe(1);
    expect(removed[1].position).toBe(2);
  });

  it("peut supprimer la première phase", () => {
    const phases = [
      phase({ position: 1, format: "SWISS" }),
      phase({ position: 2, format: "SINGLE" }),
    ];
    const removed = removePhase(phases, 0);
    expect(removed.length).toBe(1);
    expect(removed[0].format).toBe("SINGLE");
    expect(removed[0].position).toBe(1);
  });

  it("peut supprimer la dernière phase", () => {
    const phases = [
      phase({ position: 1, format: "SWISS" }),
      phase({ position: 2, format: "SINGLE" }),
    ];
    const removed = removePhase(phases, 1);
    expect(removed.length).toBe(1);
    expect(removed[0].format).toBe("SWISS");
    expect(removed[0].position).toBe(1);
  });
});

describe("phase-form — addPhase", () => {
  it("ajoute une phase avec une position cohérente", () => {
    const phases = [phase({ position: 1 }), phase({ position: 2 })];
    const added = addPhase(phases, "SURVIVAL");
    expect(added.length).toBe(3);
    expect(added[2].position).toBe(3);
    expect(added[2].format).toBe("SURVIVAL");
  });

  it("ajoute avec le bon format", () => {
    const phases = [phase({ position: 1, format: "SWISS" })];
    const added = addPhase(phases, "DOUBLE");
    expect(added[1].format).toBe("DOUBLE");
  });

  it("peut ajouter à une liste vide", () => {
    const added = addPhase([], "SINGLE");
    expect(added.length).toBe(1);
    expect(added[0].position).toBe(1);
  });
});

describe("phase-form — phaseFormatLabel", () => {
  it('retourne "Élimination simple" pour SINGLE', () => {
    expect(phaseFormatLabel("SINGLE")).toBe("Élimination simple");
  });

  it('retourne "Double élimination" pour DOUBLE', () => {
    expect(phaseFormatLabel("DOUBLE")).toBe("Double élimination");
  });

  it('retourne "Ronde suisse" pour SWISS', () => {
    expect(phaseFormatLabel("SWISS")).toBe("Ronde suisse");
  });

  it('retourne "Survie" pour SURVIVAL', () => {
    expect(phaseFormatLabel("SURVIVAL")).toBe("Survie");
  });
});

describe("phase-form — phaseSummary", () => {
  it("indique la phase finale", () => {
    const p = phase({ format: "SINGLE" });
    expect(phaseSummary(p, true)).toBe("Élimination simple — phase finale");
  });

  it("indique le nombre fixe d'équipes en COUNT", () => {
    const p = phase({ qualifierMode: "COUNT", qualifierValue: 8 });
    expect(phaseSummary(p, false)).toBe("Élimination simple — 8 équipes");
  });

  it("singularise pour 1 équipe", () => {
    const p = phase({ qualifierMode: "COUNT", qualifierValue: 1 });
    expect(phaseSummary(p, false)).toBe("Élimination simple — 1 équipe");
  });

  it("indique le pourcentage en PERCENT", () => {
    const p = phase({ qualifierMode: "PERCENT", qualifierValue: 75 });
    expect(phaseSummary(p, false)).toBe("Élimination simple — 75 % qualifiées");
  });

  it("singularise pour 1 %", () => {
    const p = phase({ qualifierMode: "PERCENT", qualifierValue: 1 });
    expect(phaseSummary(p, false)).toBe("Élimination simple — 1 % qualifiées");
  });

  it("fonctionne avec chaque format", () => {
    for (const format of ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL"] as const) {
      const p = phase({ format, qualifierMode: "COUNT", qualifierValue: 4 });
      const summary = phaseSummary(p, false);
      expect(summary).toMatch(/— 4 équipes$/);
    }
  });
});

describe("phase-form — phaseErrorMessage", () => {
  it("retourne un message non-vide pour chaque code de validation", () => {
    const codes = [
      "INVALID_PHASE_COUNT",
      "INVALID_PHASE_POSITIONS",
      "INVALID_PHASE_FORMAT",
      "DOUBLE_MUST_BE_LAST_PHASE",
      "INVALID_PHASE_QUALIFIER",
      "NON_DECREASING_PHASE_QUALIFIERS",
      "INVALID_PHASE_SWISS_ROUNDS",
      "INVALID_PHASE_SURVIVAL_ROUNDS",
    ];
    for (const code of codes) {
      const msg = phaseErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it("retourne un message par défaut pour un code inconnu", () => {
    const msg = phaseErrorMessage("UNKNOWN_CODE");
    expect(msg).toBe("Erreur de configuration des phases.");
  });

  it("retourne du texte français pour INVALID_PHASE_COUNT", () => {
    const msg = phaseErrorMessage("INVALID_PHASE_COUNT");
    expect(msg).toMatch(/Nombre de phases/i);
  });

  it("retourne du texte français pour DOUBLE_MUST_BE_LAST_PHASE", () => {
    const msg = phaseErrorMessage("DOUBLE_MUST_BE_LAST_PHASE");
    expect(msg).toMatch(/double.*dernière/i);
  });
});
