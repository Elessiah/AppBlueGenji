import { describe, expect, it } from "@jest/globals";
import {
  defaultSelectedPhaseId,
  phaseFormatLabel,
  phaseStateLabel,
  phaseSubtitle,
  visibleRulesFormat,
} from "@/app/(secured)/tournois/[id]/_lib/phases";
import type { PhaseFormat, PhaseState, TournamentFormat, TournamentPhase } from "@/lib/shared/types";

function tournamentPhase(overrides: Partial<TournamentPhase> = {}): TournamentPhase {
  return {
    id: 1,
    tournamentId: 1,
    position: 1,
    state: "PENDING",
    format: "SINGLE",
    name: null,
    qualifierMode: "PERCENT",
    qualifierValue: 50,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: 3,
    survivalRoundsPerCut: 3,
    entrants: null,
    qualifiers: null,
    skipped: false,
    skipReason: null,
    ...overrides,
  };
}

describe("phase-view — phaseFormatLabel", () => {
  it('retourne "Ronde suisse" pour SWISS', () => {
    expect(phaseFormatLabel("SWISS")).toBe("Ronde suisse");
  });

  it('retourne "Survie" pour SURVIVAL', () => {
    expect(phaseFormatLabel("SURVIVAL")).toBe("Survie");
  });

  it('retourne "Double élimination" pour DOUBLE', () => {
    expect(phaseFormatLabel("DOUBLE")).toBe("Double élimination");
  });

  it('retourne "Simple élimination" pour SINGLE', () => {
    expect(phaseFormatLabel("SINGLE")).toBe("Simple élimination");
  });
});

describe("phase-view — phaseStateLabel", () => {
  it('retourne "À venir" pour PENDING', () => {
    expect(phaseStateLabel("PENDING")).toBe("À venir");
  });

  it('retourne "En cours" pour RUNNING', () => {
    expect(phaseStateLabel("RUNNING")).toBe("En cours");
  });

  it('retourne "Terminée" pour FINISHED', () => {
    expect(phaseStateLabel("FINISHED")).toBe("Terminée");
  });

  it('retourne "Ignorée" pour SKIPPED', () => {
    expect(phaseStateLabel("SKIPPED")).toBe("Ignorée");
  });
});

describe("phase-view — phaseSubtitle", () => {
  it("affiche un message SKIPPED", () => {
    const p = tournamentPhase({ state: "SKIPPED", entrants: 4, qualifiers: 2 });
    expect(phaseSubtitle(p, false)).toBe("Ignorée — effectif insuffisant");
  });

  it('affiche "Phase finale" quand isLast est vrai', () => {
    const p = tournamentPhase({ state: "RUNNING", entrants: 8, qualifiers: 1 });
    expect(phaseSubtitle(p, true)).toBe("Phase finale");
  });

  it("affiche le ratio entrants qualifiants quand resolue", () => {
    const p = tournamentPhase({ state: "RUNNING", entrants: 64, qualifiers: 32 });
    expect(phaseSubtitle(p, false)).toBe("64 équipes → 32 qualifiées");
  });

  it("singularise 1 entrant", () => {
    const p = tournamentPhase({ state: "RUNNING", entrants: 1, qualifiers: 1 });
    expect(phaseSubtitle(p, false)).toBe("1 équipe → 1 qualifiée");
  });

  it("singularise 1 qualifiant", () => {
    const p = tournamentPhase({ state: "RUNNING", entrants: 4, qualifiers: 1 });
    expect(phaseSubtitle(p, false)).toBe("4 équipes → 1 qualifiée");
  });

  it("retourne une chaîne vide si non résolue et non SKIPPED", () => {
    const p = tournamentPhase({ state: "PENDING", entrants: null, qualifiers: null });
    expect(phaseSubtitle(p, false)).toBe("");
  });

  it('affiche "Phase finale" meme si qualifiers/entrants est nul et isLast est vrai', () => {
    const p = tournamentPhase({ state: "PENDING", entrants: null, qualifiers: null });
    expect(phaseSubtitle(p, true)).toBe("Phase finale");
  });
});

describe("phase-view — defaultSelectedPhaseId", () => {
  it("retourne null si phases est null", () => {
    expect(defaultSelectedPhaseId(null, null)).toBeNull();
  });

  it("retourne null si phases est un tableau vide", () => {
    expect(defaultSelectedPhaseId([], null)).toBeNull();
  });

  it("préfère la phase en cours (currentPhaseId matching)", () => {
    const phases = [
      tournamentPhase({ id: 1, state: "FINISHED" }),
      tournamentPhase({ id: 2, state: "RUNNING" }),
      tournamentPhase({ id: 3, state: "PENDING" }),
    ];
    expect(defaultSelectedPhaseId(phases, 2)).toBe(2);
  });

  it("retourne la dernière phase FINISHED si pas de phase en cours", () => {
    const phases = [
      tournamentPhase({ id: 1, state: "FINISHED" }),
      tournamentPhase({ id: 2, state: "FINISHED" }),
      tournamentPhase({ id: 3, state: "PENDING" }),
    ];
    expect(defaultSelectedPhaseId(phases, null)).toBe(2);
  });

  it("retourne la première phase non-SKIPPED si rien n'a commencé", () => {
    const phases = [
      tournamentPhase({ id: 1, state: "SKIPPED" }),
      tournamentPhase({ id: 2, state: "PENDING" }),
      tournamentPhase({ id: 3, state: "PENDING" }),
    ];
    expect(defaultSelectedPhaseId(phases, null)).toBe(2);
  });

  it("retourne la première phase si toutes les autres sont SKIPPED", () => {
    const phases = [
      tournamentPhase({ id: 1, state: "SKIPPED" }),
      tournamentPhase({ id: 2, state: "SKIPPED" }),
    ];
    expect(defaultSelectedPhaseId(phases, null)).toBe(1);
  });

  it("ne retourne jamais une phase SKIPPED sauf en dernier recours", () => {
    const phases = [
      tournamentPhase({ id: 1, state: "SKIPPED" }),
      tournamentPhase({ id: 2, state: "PENDING" }),
    ];
    const selected = defaultSelectedPhaseId(phases, null);
    expect(selected).toBe(2);
  });

  it("retourne la dernière FINISHED avant la première PENDING", () => {
    const phases = [
      tournamentPhase({ id: 1, state: "FINISHED" }),
      tournamentPhase({ id: 2, state: "FINISHED" }),
      tournamentPhase({ id: 3, state: "PENDING" }),
      tournamentPhase({ id: 4, state: "PENDING" }),
    ];
    expect(defaultSelectedPhaseId(phases, null)).toBe(2);
  });

  it("retourne currentPhaseId meme si elle est SKIPPED", () => {
    const phases = [
      tournamentPhase({ id: 1, state: "FINISHED" }),
      tournamentPhase({ id: 2, state: "SKIPPED" }),
      tournamentPhase({ id: 3, state: "PENDING" }),
    ];
    expect(defaultSelectedPhaseId(phases, 2)).toBe(2);
  });
});

describe("phase-view — visibleRulesFormat", () => {
  it("retourne le format de la phase sélectionnée pour un tournoi MULTI", () => {
    const card = { format: "MULTI" as TournamentFormat };
    const selectedPhase = tournamentPhase({ format: "SWISS" });
    expect(visibleRulesFormat(card, selectedPhase)).toBe("SWISS");
  });

  it("retourne le format de la carte pour un tournoi single-format", () => {
    const card = { format: "SINGLE" as TournamentFormat };
    const selectedPhase = tournamentPhase({ format: "SWISS" });
    expect(visibleRulesFormat(card, selectedPhase)).toBe("SINGLE");
  });

  it("retourne le format de la carte quand aucune phase n'est sélectionnée", () => {
    const card = { format: "MULTI" as TournamentFormat };
    expect(visibleRulesFormat(card, null)).toBe("MULTI");
  });

  it("retourne le format de la carte même en MULTI si selectedPhase est null", () => {
    const card = { format: "DOUBLE" as TournamentFormat };
    expect(visibleRulesFormat(card, null)).toBe("DOUBLE");
  });

  it("fonctionne avec tous les formats de phase", () => {
    const card = { format: "MULTI" as TournamentFormat };
    for (const format of ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL"] as const) {
      const selectedPhase = tournamentPhase({ format });
      expect(visibleRulesFormat(card, selectedPhase)).toBe(format);
    }
  });

  it("ignore la phase sélectionnée si card n'est pas MULTI", () => {
    const card = { format: "SWISS" as TournamentFormat };
    const selectedPhase = tournamentPhase({ format: "SINGLE" });
    expect(visibleRulesFormat(card, selectedPhase)).toBe("SWISS");
  });
});
