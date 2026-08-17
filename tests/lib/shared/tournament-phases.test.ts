import { describe, expect, it } from "@jest/globals";
import {
  describePhasePlan,
  MAX_PHASES,
  MIN_PHASES,
  previousPowerOfTwo,
  resolvePhaseQualifiers,
  resolvePhasePlan,
  validatePhases,
  type PhaseConfig,
  type ResolvedPhase,
} from "@/lib/shared/tournament-phases";

function phaseConfig(overrides: Partial<PhaseConfig> = {}): PhaseConfig {
  return {
    position: 1,
    format: "SINGLE",
    name: null,
    qualifierMode: "COUNT",
    qualifierValue: 64,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    ...overrides,
  };
}

describe("tournament-phases — previousPowerOfTwo", () => {
  it("reconnaît les puissances de deux exactes", () => {
    expect(previousPowerOfTwo(1)).toBe(1);
    expect(previousPowerOfTwo(2)).toBe(2);
    expect(previousPowerOfTwo(16)).toBe(16);
    expect(previousPowerOfTwo(128)).toBe(128);
  });

  it("arrondit vers le bas pour des non-puissances de deux", () => {
    expect(previousPowerOfTwo(3)).toBe(2);
    expect(previousPowerOfTwo(17)).toBe(16);
  });

  it("retourne 1 pour 0 et nombres négatifs", () => {
    expect(previousPowerOfTwo(0)).toBe(1);
    expect(previousPowerOfTwo(-5)).toBe(1);
  });
});

describe("tournament-phases — resolvePhaseQualifiers", () => {
  it("retourne 1 pour une phase finale, quel que soit le mode", () => {
    const lastPhase = phaseConfig({ qualifierMode: "COUNT", qualifierValue: 64 });
    expect(resolvePhaseQualifiers(100, lastPhase, true)).toBe(1);

    const lastPercent = phaseConfig({ qualifierMode: "PERCENT", qualifierValue: 50 });
    expect(resolvePhaseQualifiers(100, lastPercent, true)).toBe(1);
  });

  describe("mode COUNT (non-finale)", () => {
    it("retourne la valeur demandée si elle ne dépasse pas les entrants", () => {
      const phase = phaseConfig({ qualifierMode: "COUNT", qualifierValue: 32 });
      expect(resolvePhaseQualifiers(128, phase, false)).toBe(32);
    });

    it("clame à min=1 et max=entrants", () => {
      const phase = phaseConfig({ qualifierMode: "COUNT", qualifierValue: 200 });
      expect(resolvePhaseQualifiers(128, phase, false)).toBe(128); // clamé à max

      const minPhase = phaseConfig({ qualifierMode: "COUNT", qualifierValue: 0 });
      expect(resolvePhaseQualifiers(128, minPhase, false)).toBe(1); // clamé à min
    });
  });

  describe("mode PERCENT (non-finale)", () => {
    it("calcule un pourcentage et arrondit vers le haut", () => {
      const phase = phaseConfig({ qualifierMode: "PERCENT", qualifierValue: 50 });
      expect(resolvePhaseQualifiers(128, phase, false)).toBe(64);

      // 30% de 128 = 38.4 → 39 arrondi vers le haut, puis snappé à 32 car le
      // format par défaut de `phaseConfig` est SINGLE (le snap dépend du format,
      // pas du mode de qualification — cf. le bloc « snap power-of-two »).
      const phase30 = phaseConfig({ qualifierMode: "PERCENT", qualifierValue: 30 });
      expect(resolvePhaseQualifiers(128, phase30, false)).toBe(32);

      // Sur un format sans contrainte de bracket, l'arrondi vers le haut est visible.
      const swiss30 = phaseConfig({
        format: "SWISS",
        qualifierMode: "PERCENT",
        qualifierValue: 30,
      });
      expect(resolvePhaseQualifiers(128, swiss30, false)).toBe(39);
    });

    it("clame aussi en [1, entrants]", () => {
      // 1% de 100 = 1 (pas plus bas)
      const lowPhase = phaseConfig({ qualifierMode: "PERCENT", qualifierValue: 1 });
      expect(resolvePhaseQualifiers(100, lowPhase, false)).toBe(1);

      // 99% de 100 = 99, snappé à 64 en SINGLE.
      const maxPhase = phaseConfig({ qualifierMode: "PERCENT", qualifierValue: 99 });
      expect(resolvePhaseQualifiers(100, maxPhase, false)).toBe(64);

      // Sans snap, la valeur clamée à entrants reste telle quelle.
      const maxSwiss = phaseConfig({
        format: "SWISS",
        qualifierMode: "PERCENT",
        qualifierValue: 99,
      });
      expect(resolvePhaseQualifiers(100, maxSwiss, false)).toBe(99);
    });
  });

  describe("snap power-of-two pour SINGLE", () => {
    it("réduit à une puissance de deux pour un SINGLE non-finale", () => {
      // 75 qualifiants → 64 (puissance de deux inférieure)
      const singlePhase = phaseConfig({ format: "SINGLE", qualifierMode: "COUNT", qualifierValue: 75 });
      expect(resolvePhaseQualifiers(128, singlePhase, false)).toBe(64);

      // 50 qualifiants → 32
      const single50 = phaseConfig({ format: "SINGLE", qualifierMode: "COUNT", qualifierValue: 50 });
      expect(resolvePhaseQualifiers(128, single50, false)).toBe(32);
    });

    it("n'applique pas le snap pour la phase finale même en SINGLE", () => {
      // Jamais atteint car isLast retourne 1, mais testons le chemin directement
      const finalSingle = phaseConfig({ format: "SINGLE", qualifierMode: "COUNT", qualifierValue: 75 });
      expect(resolvePhaseQualifiers(128, finalSingle, true)).toBe(1);
    });

    it("n'applique pas le snap pour SWISS ou SURVIVAL", () => {
      const swissPhase = phaseConfig({ format: "SWISS", qualifierMode: "COUNT", qualifierValue: 75 });
      expect(resolvePhaseQualifiers(128, swissPhase, false)).toBe(75);

      const survivalPhase = phaseConfig({ format: "SURVIVAL", qualifierMode: "COUNT", qualifierValue: 50 });
      expect(resolvePhaseQualifiers(100, survivalPhase, false)).toBe(50);
    });
  });
});

describe("tournament-phases — resolvePhasePlan", () => {
  it("résout le scénario de référence : 128 → swiss 64 → survie 16 → double final", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({
        position: 1,
        format: "SINGLE",
        qualifierMode: "COUNT",
        qualifierValue: 64,
      }),
      phaseConfig({
        position: 2,
        format: "SWISS",
        qualifierMode: "COUNT",
        qualifierValue: 16,
        swissTotalRounds: 4,
      }),
      phaseConfig({
        position: 3,
        format: "SURVIVAL",
        qualifierMode: "COUNT",
        qualifierValue: 4,
        survivalRoundsBeforeFirstCut: 2,
        survivalRoundsPerCut: 1,
      }),
      phaseConfig({
        position: 4,
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 1, // ignoré pour la finale
      }),
    ];

    const resolved = resolvePhasePlan(128, phases);

    expect(resolved).toHaveLength(4);

    // Phase 1 : SINGLE 128 → 64
    expect(resolved[0].entrants).toBe(128);
    expect(resolved[0].qualifiers).toBe(64);
    expect(resolved[0].skipped).toBe(false);
    expect(resolved[0].maxRounds).toBe(1); // log2(128 / 64) = 1

    // Phase 2 : SWISS 64 → 16
    expect(resolved[1].entrants).toBe(64);
    expect(resolved[1].qualifiers).toBe(16);
    expect(resolved[1].skipped).toBe(false);
    expect(resolved[1].maxRounds).toBeNull(); // SWISS n'a pas maxRounds

    // Phase 3 : SURVIVAL 16 → 4
    expect(resolved[2].entrants).toBe(16);
    expect(resolved[2].qualifiers).toBe(4);
    expect(resolved[2].skipped).toBe(false);
    expect(resolved[2].maxRounds).toBeNull(); // SURVIVAL n'a pas maxRounds

    // Phase 4 : DOUBLE 4 → 1 (finale)
    expect(resolved[3].entrants).toBe(4);
    expect(resolved[3].qualifiers).toBe(1);
    expect(resolved[3].skipped).toBe(false);
    expect(resolved[3].maxRounds).toBeNull(); // Phase finale
  });

  describe("cas sous-remplis (COUNT fixe)", () => {
    it("saute une phase quand le cut n'éliminerait personne (NO_CUT)", () => {
      const phases: PhaseConfig[] = [
        phaseConfig({
          position: 1,
          format: "SINGLE",
          qualifierMode: "COUNT",
          qualifierValue: 100, // Plus que les 50 entrants
        }),
        phaseConfig({
          position: 2,
          format: "DOUBLE",
          qualifierMode: "COUNT",
          qualifierValue: 1,
        }),
      ];

      const resolved = resolvePhasePlan(50, phases);

      expect(resolved[0].entrants).toBe(50);
      expect(resolved[0].qualifiers).toBe(50);
      expect(resolved[0].skipped).toBe(true);
      expect(resolved[0].skipReason).toBe("NO_CUT");

      // Les 50 équipes passent à la phase suivante
      expect(resolved[1].entrants).toBe(50);
    });

    it("fait cascader les équipes à travers les phases sautées", () => {
      const phases: PhaseConfig[] = [
        phaseConfig({
          position: 1,
          format: "SINGLE",
          qualifierMode: "COUNT",
          qualifierValue: 200,
        }),
        phaseConfig({
          position: 2,
          format: "SWISS",
          qualifierMode: "COUNT",
          qualifierValue: 150,
        }),
        phaseConfig({
          position: 3,
          format: "DOUBLE",
          qualifierMode: "COUNT",
          qualifierValue: 1,
        }),
      ];

      const resolved = resolvePhasePlan(50, phases);

      // Phases 1 et 2 sautées
      expect(resolved[0].skipped).toBe(true);
      expect(resolved[0].skipReason).toBe("NO_CUT");
      expect(resolved[1].skipped).toBe(true);
      expect(resolved[1].skipReason).toBe("NO_CUT");

      // Les 50 arrivent en finale
      expect(resolved[2].entrants).toBe(50);
      expect(resolved[2].qualifiers).toBe(1);
    });
  });

  describe("cas en pourcentage (PERCENT)", () => {
    it("applique le pourcentage au lieu de sauter quand le cut dépasse les entrants", () => {
      const phases: PhaseConfig[] = [
        phaseConfig({
          position: 1,
          format: "SINGLE",
          qualifierMode: "PERCENT",
          qualifierValue: 100, // 100% = tout
        }),
        phaseConfig({
          position: 2,
          format: "DOUBLE",
          qualifierMode: "COUNT",
          qualifierValue: 1,
        }),
      ];

      const resolved = resolvePhasePlan(50, phases);

      // En PERCENT, 100% ne saute pas, clame à entrants
      expect(resolved[0].entrants).toBe(50);
      expect(resolved[0].qualifiers).toBe(50); // Math.min(Math.ceil(50*100/100), 50) = 50
      expect(resolved[0].skipped).toBe(false);
    });

    it("réduit en puissance de deux même en pourcentage pour SINGLE", () => {
      const phases: PhaseConfig[] = [
        phaseConfig({
          position: 1,
          format: "SINGLE",
          qualifierMode: "PERCENT",
          qualifierValue: 50, // 50% de 100 = 50, snap → 32
        }),
        phaseConfig({
          position: 2,
          format: "DOUBLE",
          qualifierMode: "COUNT",
          qualifierValue: 1,
        }),
      ];

      const resolved = resolvePhasePlan(100, phases);
      expect(resolved[0].qualifiers).toBe(32); // Snappé à puissance de deux
    });
  });

  describe("cas dégénérés (0 ou 1 équipe)", () => {
    it("saute toutes les phases avec TOO_FEW_TEAMS pour 0 entrants", () => {
      const phases: PhaseConfig[] = [
        phaseConfig({ position: 1, format: "SINGLE" }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];

      const resolved = resolvePhasePlan(0, phases);

      for (const phase of resolved) {
        expect(phase.skipped).toBe(true);
        expect(phase.skipReason).toBe("TOO_FEW_TEAMS");
      }
    });

    it("saute toutes les phases avec TOO_FEW_TEAMS pour 1 entrant", () => {
      const phases: PhaseConfig[] = [
        phaseConfig({ position: 1, format: "SINGLE" }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];

      const resolved = resolvePhasePlan(1, phases);

      for (const phase of resolved) {
        expect(phase.skipped).toBe(true);
        expect(phase.skipReason).toBe("TOO_FEW_TEAMS");
      }
    });
  });

  it("calcule maxRounds = log2(entrantsPow / qualifiers) pour SINGLE non-sautée", () => {
    // Phase SINGLE avec 100 entrants → 32 qualifiants
    // entrantsPow = nextPowerOfTwo(100) = 128
    // maxRounds = log2(128 / 32) = log2(4) = 2
    const phases: PhaseConfig[] = [
      phaseConfig({
        position: 1,
        format: "SINGLE",
        qualifierMode: "COUNT",
        qualifierValue: 32,
      }),
      phaseConfig({
        position: 2,
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 1,
      }),
    ];

    const resolved = resolvePhasePlan(100, phases);
    expect(resolved[0].maxRounds).toBe(2);
  });

  it("ne calcule pas maxRounds pour SWISS ou SURVIVAL", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({
        position: 1,
        format: "SWISS",
        qualifierMode: "COUNT",
        qualifierValue: 32,
      }),
      phaseConfig({
        position: 2,
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 1,
      }),
    ];

    const resolved = resolvePhasePlan(64, phases);
    expect(resolved[0].maxRounds).toBeNull();
  });

  it("ne calcule pas maxRounds pour la phase finale", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({
        position: 1,
        format: "SINGLE",
        qualifierMode: "COUNT",
        qualifierValue: 16,
      }),
      phaseConfig({
        position: 2,
        format: "SINGLE",
        qualifierMode: "COUNT",
        qualifierValue: 1, // finale
      }),
    ];

    const resolved = resolvePhasePlan(32, phases);
    expect(resolved[1].maxRounds).toBeNull();
  });
});

describe("tournament-phases — validatePhases", () => {
  it("accepte un plan valide", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({ position: 1 }),
      phaseConfig({
        position: 2,
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 1,
      }),
    ];

    expect(validatePhases(phases)).toBeNull();
  });

  it("rejette si le nombre de phases < MIN_PHASES ou > MAX_PHASES", () => {
    const tooFew = [phaseConfig({ position: 1 })];
    expect(validatePhases(tooFew)).toBe("INVALID_PHASE_COUNT");

    const tooMany = Array.from({ length: MAX_PHASES + 1 }, (_, i) =>
      phaseConfig({
        position: i + 1,
        format: i === MAX_PHASES ? "DOUBLE" : "SINGLE",
        qualifierValue: 64,
      }),
    );
    expect(validatePhases(tooMany)).toBe("INVALID_PHASE_COUNT");
  });

  it("rejette si les positions ne sont pas exactement 1..n", () => {
    const gapped = [
      phaseConfig({ position: 1 }),
      phaseConfig({ position: 3, format: "DOUBLE" }), // position 2 manque
    ];
    expect(validatePhases(gapped)).toBe("INVALID_PHASE_POSITIONS");

    const outOfOrder = [
      phaseConfig({ position: 2 }),
      phaseConfig({ position: 1, format: "DOUBLE" }),
    ];
    expect(validatePhases(outOfOrder)).toBe("INVALID_PHASE_POSITIONS");
  });

  it("rejette un format invalide", () => {
    const invalid = [
      phaseConfig({ position: 1, format: "INVALID" as any }),
      phaseConfig({ position: 2, format: "DOUBLE" }),
    ];
    expect(validatePhases(invalid)).toBe("INVALID_PHASE_FORMAT");
  });

  it("rejette si DOUBLE n'est pas la dernière phase", () => {
    const doubleNotLast = [
      phaseConfig({ position: 1, format: "DOUBLE" }),
      phaseConfig({ position: 2, format: "SINGLE" }),
    ];
    expect(validatePhases(doubleNotLast)).toBe("DOUBLE_MUST_BE_LAST_PHASE");
  });

  describe("validations de qualifiants", () => {
    it("rejette COUNT < 1 en phase non-finale", () => {
      const invalidCount = [
        phaseConfig({ position: 1, qualifierMode: "COUNT", qualifierValue: 0 }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(invalidCount)).toBe("INVALID_PHASE_QUALIFIER");
    });

    it("rejette PERCENT hors [1, 99]", () => {
      const percent0 = [
        phaseConfig({ position: 1, qualifierMode: "PERCENT", qualifierValue: 0 }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(percent0)).toBe("INVALID_PHASE_QUALIFIER");

      const percent100 = [
        phaseConfig({ position: 1, qualifierMode: "PERCENT", qualifierValue: 100 }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(percent100)).toBe("INVALID_PHASE_QUALIFIER");
    });

    it("n'applique pas la validation de qualifiants à la phase finale", () => {
      const finalAny = [
        phaseConfig({ position: 1 }),
        phaseConfig({
          position: 2,
          format: "DOUBLE",
          qualifierMode: "COUNT",
          qualifierValue: 999, // quelconque, pas validé
        }),
      ];
      expect(validatePhases(finalAny)).toBeNull();
    });
  });

  describe("validations SWISS", () => {
    it("accepte SWISS sans rounds (null)", () => {
      const validSwiss = [
        phaseConfig({
          position: 1,
          format: "SWISS",
          swissTotalRounds: null,
        }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(validSwiss)).toBeNull();
    });

    it("accepte SWISS avec rounds en [1, 20]", () => {
      const valid1 = [
        phaseConfig({ position: 1, format: "SWISS", swissTotalRounds: 1 }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(valid1)).toBeNull();

      const valid20 = [
        phaseConfig({ position: 1, format: "SWISS", swissTotalRounds: 20 }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(valid20)).toBeNull();
    });

    it("rejette SWISS hors [1, 20]", () => {
      const invalid0 = [
        phaseConfig({ position: 1, format: "SWISS", swissTotalRounds: 0 }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(invalid0)).toBe("INVALID_PHASE_SWISS_ROUNDS");

      const invalid21 = [
        phaseConfig({ position: 1, format: "SWISS", swissTotalRounds: 21 }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(invalid21)).toBe("INVALID_PHASE_SWISS_ROUNDS");
    });
  });

  describe("validations SURVIVAL", () => {
    it("accepte SURVIVAL avec cadences nulles", () => {
      const validNull = [
        phaseConfig({
          position: 1,
          format: "SURVIVAL",
          survivalRoundsBeforeFirstCut: null,
          survivalRoundsPerCut: null,
        }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(validNull)).toBeNull();
    });

    it("accepte SURVIVAL avec cadences en [1, 50]", () => {
      const valid = [
        phaseConfig({
          position: 1,
          format: "SURVIVAL",
          survivalRoundsBeforeFirstCut: 2,
          survivalRoundsPerCut: 1,
        }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(valid)).toBeNull();
    });

    it("rejette survivalRoundsBeforeFirstCut hors [1, 50]", () => {
      const invalid0 = [
        phaseConfig({
          position: 1,
          format: "SURVIVAL",
          survivalRoundsBeforeFirstCut: 0,
        }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(invalid0)).toBe("INVALID_PHASE_SURVIVAL_ROUNDS");

      const invalid51 = [
        phaseConfig({
          position: 1,
          format: "SURVIVAL",
          survivalRoundsBeforeFirstCut: 51,
        }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(invalid51)).toBe("INVALID_PHASE_SURVIVAL_ROUNDS");
    });

    it("rejette survivalRoundsPerCut hors [1, 50]", () => {
      const invalid0 = [
        phaseConfig({
          position: 1,
          format: "SURVIVAL",
          survivalRoundsPerCut: 0,
        }),
        phaseConfig({ position: 2, format: "DOUBLE" }),
      ];
      expect(validatePhases(invalid0)).toBe("INVALID_PHASE_SURVIVAL_ROUNDS");
    });
  });

  it("rejette deux COUNT consécutifs non-décroissants", () => {
    const nonDecreasing = [
      phaseConfig({ position: 1, qualifierMode: "COUNT", qualifierValue: 64 }),
      phaseConfig({ position: 2, qualifierMode: "COUNT", qualifierValue: 64 }), // égal, pas <
      phaseConfig({ position: 3, format: "DOUBLE" }),
    ];
    expect(validatePhases(nonDecreasing)).toBe("NON_DECREASING_PHASE_QUALIFIERS");

    const increasing = [
      phaseConfig({ position: 1, qualifierMode: "COUNT", qualifierValue: 32 }),
      phaseConfig({ position: 2, qualifierMode: "COUNT", qualifierValue: 64 }), // >
      phaseConfig({ position: 3, format: "DOUBLE" }),
    ];
    expect(validatePhases(increasing)).toBe("NON_DECREASING_PHASE_QUALIFIERS");

    const properlyDecreasing = [
      phaseConfig({ position: 1, qualifierMode: "COUNT", qualifierValue: 64 }),
      phaseConfig({ position: 2, qualifierMode: "COUNT", qualifierValue: 32 }), // < OK
      phaseConfig({ position: 3, format: "DOUBLE" }),
    ];
    expect(validatePhases(properlyDecreasing)).toBeNull();
  });

  it("ignore la décroissance quand une phase n'est pas COUNT", () => {
    const mixedOk = [
      phaseConfig({ position: 1, qualifierMode: "COUNT", qualifierValue: 32 }),
      phaseConfig({ position: 2, qualifierMode: "PERCENT", qualifierValue: 50 }), // pas COUNT
      phaseConfig({ position: 3, format: "DOUBLE" }),
    ];
    expect(validatePhases(mixedOk)).toBeNull();
  });
});

describe("tournament-phases — describePhasePlan", () => {
  it("génère une phrase française par phase", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({
        position: 1,
        format: "SINGLE",
        qualifierMode: "COUNT",
        qualifierValue: 64,
      }),
      phaseConfig({
        position: 2,
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 1,
      }),
    ];

    const resolved = resolvePhasePlan(128, phases);
    const descriptions = describePhasePlan(resolved);

    expect(descriptions).toHaveLength(2);

    // Phase 1 : non-finale avec qualifiants
    expect(descriptions[0]).toContain("Phase 1");
    expect(descriptions[0]).toContain("Élimination simple");
    expect(descriptions[0]).toContain("128 équipes");
    expect(descriptions[0]).toContain("64 qualifiée");

    // Phase 2 : finale
    expect(descriptions[1]).toContain("Phase 2");
    expect(descriptions[1]).toContain("Finale");
    expect(descriptions[1]).toContain("Double élimination");
    expect(descriptions[1]).toContain("64 équipes");
  });

  it("marque les phases sautées avec la raison", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({
        position: 1,
        format: "SINGLE",
        qualifierMode: "COUNT",
        qualifierValue: 200, // > 50, sera sautée
      }),
      phaseConfig({
        position: 2,
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 1,
      }),
    ];

    const resolved = resolvePhasePlan(50, phases);
    const descriptions = describePhasePlan(resolved);

    expect(descriptions[0]).toContain("ignorée");
    expect(descriptions[0]).toContain("pas d'élimination");
  });

  it("utilise le bon pluriel pour les équipes et qualifiées", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({
        position: 1,
        format: "SINGLE",
        qualifierMode: "COUNT",
        qualifierValue: 1,
      }),
      phaseConfig({
        position: 2,
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 1,
      }),
    ];

    const resolved = resolvePhasePlan(1, phases);
    const descriptions = describePhasePlan(resolved);

    // Les deux phases sautées avec TOO_FEW_TEAMS
    expect(descriptions[0]).toContain("1 équipe"); // singulier
    expect(descriptions[1]).toContain("1 équipe");
  });

  it("décrit tous les formats avec leur nom français", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({ position: 1, format: "SINGLE", qualifierValue: 8 }),
      phaseConfig({ position: 2, format: "SWISS", qualifierValue: 4, swissTotalRounds: 3 }),
      phaseConfig({ position: 3, format: "SURVIVAL", qualifierValue: 2, survivalRoundsBeforeFirstCut: 1, survivalRoundsPerCut: 1 }),
      phaseConfig({ position: 4, format: "DOUBLE" }),
    ];

    const resolved = resolvePhasePlan(16, phases);
    const descriptions = describePhasePlan(resolved);

    expect(descriptions[0]).toContain("Élimination simple");
    expect(descriptions[1]).toContain("Ronde suisse");
    expect(descriptions[2]).toContain("Survie");
    expect(descriptions[3]).toContain("Double élimination");
  });

  it("marque TOO_FEW_TEAMS quand ≤1 équipe", () => {
    const phases: PhaseConfig[] = [
      phaseConfig({ position: 1, format: "SINGLE" }),
      phaseConfig({ position: 2, format: "DOUBLE" }),
    ];

    const resolved = resolvePhasePlan(0, phases);
    const descriptions = describePhasePlan(resolved);

    expect(descriptions[0]).toContain("ignorée");
    expect(descriptions[0]).toContain("effectif insuffisant");
  });
});
