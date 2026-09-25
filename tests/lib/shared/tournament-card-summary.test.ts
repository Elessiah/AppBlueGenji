import { describe, expect, it } from "@jest/globals";
import {
  pickChampion,
  runningProgressFrom,
  type RunningProgressSource,
} from "@/lib/shared/tournament-card-summary";
import { computeRunningRatio } from "@/lib/shared/tournament-progress";

/**
 * Résumé d'une carte de tournoi : le vainqueur d'un tournoi clos et
 * l'avancement d'un tournoi en cours. L'avancement doit rester **exactement**
 * celui de la frise de la fiche — la liste ne lit que des comptes de matchs,
 * c'est cette traduction qui est tenue ici.
 */

function source(overrides: Partial<RunningProgressSource> = {}): RunningProgressSource {
  return {
    format: "SINGLE",
    swissTotalRounds: null,
    swissCurrentRound: 0,
    currentPhaseId: null,
    matchCounts: [],
    survivalStatuses: [],
    enduranceStatuses: [],
    phases: [],
    ...overrides,
  };
}

describe("pickChampion", () => {
  it("désigne l'unique engagé classé premier", () => {
    expect(
      pickChampion([
        { teamId: 3, name: "Troisième", finalRank: 3 },
        { teamId: 1, name: "Première", finalRank: 1 },
        { teamId: 2, name: "Deuxième", finalRank: 2 },
      ]),
    ).toEqual({ teamId: 1, name: "Première" });
  });

  it("ne désigne personne sans premier (finale en double forfait)", () => {
    expect(
      pickChampion([
        { teamId: 1, name: "A", finalRank: 2 },
        { teamId: 2, name: "B", finalRank: 2 },
      ]),
    ).toBeNull();
  });

  it("ne choisit pas entre deux premiers ex æquo", () => {
    expect(
      pickChampion([
        { teamId: 1, name: "A", finalRank: 1 },
        { teamId: 2, name: "B", finalRank: 1 },
      ]),
    ).toBeNull();
  });

  it("ne désigne personne sans classement (tournoi sans inscrite, rangs absents)", () => {
    expect(pickChampion([])).toBeNull();
    expect(pickChampion([{ teamId: 1, name: "A", finalRank: null }])).toBeNull();
  });
});

describe("runningProgressFrom", () => {
  it("mesure une élimination à ses matchs terminés", () => {
    const ratio = runningProgressFrom(
      source({
        matchCounts: [
          { phaseId: 0, roundNumber: 1, total: 4, completed: 4 },
          { phaseId: 0, roundNumber: 2, total: 2, completed: 1 },
          { phaseId: 0, roundNumber: 3, total: 1, completed: 0 },
        ],
      }),
    );
    expect(ratio).toBeCloseTo(5 / 7);
  });

  it("rend null sur un plateau sans match, comme la fiche", () => {
    expect(runningProgressFrom(source({ format: "DOUBLE" }))).toBeNull();
  });

  it("mesure une ronde suisse à ses rondes, la ronde courante en fraction", () => {
    const ratio = runningProgressFrom(
      source({
        format: "SWISS",
        swissTotalRounds: 4,
        swissCurrentRound: 2,
        matchCounts: [
          { phaseId: 0, roundNumber: 1, total: 4, completed: 4 },
          { phaseId: 0, roundNumber: 2, total: 4, completed: 2 },
        ],
      }),
    );
    // Une ronde et demie sur quatre, et non 6 matchs sur 8.
    expect(ratio).toBeCloseTo(1.5 / 4);
  });

  it("retombe sur les matchs d'une ronde suisse sans nombre de rondes", () => {
    const ratio = runningProgressFrom(
      source({
        format: "SWISS",
        swissTotalRounds: null,
        swissCurrentRound: 1,
        matchCounts: [{ phaseId: 0, roundNumber: 1, total: 4, completed: 1 }],
      }),
    );
    expect(ratio).toBeCloseTo(1 / 4);
  });

  it("mesure une survie à ses éliminations, jamais à ses matchs", () => {
    const ratio = runningProgressFrom(
      source({
        format: "SURVIVAL",
        // Même une manche entièrement jouée n'annonce pas 100 %.
        matchCounts: [{ phaseId: 0, roundNumber: 1, total: 3, completed: 3 }],
        survivalStatuses: ["ACTIVE", "ACTIVE", "ELIMINATED", "FORFEIT", "ACTIVE"],
      }),
    );
    expect(ratio).toBeCloseTo(2 / 4);
  });

  it("mesure une BG Survie à ses sorties, hors course compris", () => {
    const ratio = runningProgressFrom(
      source({
        format: "BG_SURVIE",
        enduranceStatuses: ["ACTIVE", "OUT_OF_CONTENTION", "ELIMINATED", "ACTIVE", "ACTIVE"],
      }),
    );
    expect(ratio).toBeCloseTo(2 / 4);
  });

  it("mesure un multi-phases à ses phases réglées plus la phase courante", () => {
    const ratio = runningProgressFrom(
      source({
        format: "MULTI",
        currentPhaseId: 11,
        phases: [
          { id: 10, state: "FINISHED", format: "SWISS", swissTotalRounds: 3 },
          { id: 11, state: "RUNNING", format: "SINGLE", swissTotalRounds: null },
          { id: 12, state: "PENDING", format: "DOUBLE", swissTotalRounds: null },
        ],
        matchCounts: [
          // Phase close : ignorée, seule la courante compte en fraction.
          { phaseId: 10, roundNumber: 1, total: 4, completed: 4 },
          { phaseId: 11, roundNumber: 1, total: 2, completed: 1 },
        ],
      }),
    );
    expect(ratio).toBeCloseTo((1 + 0.5) / 3);
  });

  it("borne des comptes incohérents plutôt que de fausser la mesure", () => {
    const ratio = runningProgressFrom(
      source({
        matchCounts: [
          { phaseId: 0, roundNumber: 1, total: 2, completed: 5 },
          { phaseId: 0, roundNumber: 2, total: -1, completed: 0 },
        ],
      }),
    );
    expect(ratio).toBe(1);
  });

  it("rend la même valeur que la frise de la fiche sur les mêmes matchs", () => {
    const matches = [
      { status: "COMPLETED" as const, roundNumber: 1, phaseId: 0 },
      { status: "COMPLETED" as const, roundNumber: 1, phaseId: 0 },
      { status: "READY" as const, roundNumber: 2, phaseId: 0 },
      { status: "AWAITING_CONFIRMATION" as const, roundNumber: 2, phaseId: 0 },
      { status: "PENDING" as const, roundNumber: 3, phaseId: 0 },
    ];
    const fromDetail = computeRunningRatio({ format: "SINGLE", matches });
    const fromCounts = runningProgressFrom(
      source({
        matchCounts: [
          { phaseId: 0, roundNumber: 1, total: 2, completed: 2 },
          { phaseId: 0, roundNumber: 2, total: 2, completed: 0 },
          { phaseId: 0, roundNumber: 3, total: 1, completed: 0 },
        ],
      }),
    );
    expect(fromCounts).toBe(fromDetail);
  });
});
