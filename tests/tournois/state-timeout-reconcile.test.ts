import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/bracket-generator");
jest.mock("@/lib/server/tournaments/finalization");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/bg-survie");
jest.mock("@/lib/server/tournaments/phases");

import { syncTournamentState } from "@/lib/server/tournaments/state";
import { loadTournamentRow } from "@/lib/server/tournaments/repository";
import { createBracketIfMissing } from "@/lib/server/tournaments/bracket-generator";
import {
  finalizeTournamentIfDone,
  resolveExpiredScoreReports,
} from "@/lib/server/tournaments/finalization";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { reconcileSurvival } from "@/lib/server/tournaments/survival";
import { reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie";
import { reconcilePhases } from "@/lib/server/tournaments/phases";

type Row = Record<string, unknown>;

function runningRow(overrides: Row = {}): Row {
  const past = new Date(Date.now() - 86_400_000);
  return {
    id: 5,
    state: "RUNNING",
    format: "SWISS",
    finished_at: null,
    registration_open_at: past,
    registration_close_at: past,
    start_at: past,
    bracket_size: 8,
    ...overrides,
  };
}

const connection = {} as never;

const reconcilers = {
  SURVIVAL: reconcileSurvival,
  SWISS: reconcileSwiss,
  BG_SURVIE: reconcileEndurance,
  MULTI: reconcilePhases,
} as const;

function resetMocks(): void {
  jest.clearAllMocks();
  (createBracketIfMissing as jest.Mock).mockResolvedValue({
    finished: false,
    created: false,
  } as never);
  (resolveExpiredScoreReports as jest.Mock).mockResolvedValue(0 as never);
  (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
  (finalizeTournamentIfDone as jest.Mock).mockResolvedValue(undefined as never);
  for (const reconcile of Object.values(reconcilers)) {
    (reconcile as jest.Mock).mockResolvedValue(undefined as never);
  }
}

/**
 * Une manche close par le **délai** n'a traversé aucun chemin d'écriture : ni
 * report de score, ni arbitrage, donc aucune réconciliation derrière elle. Les
 * modes à classement et le multi-phases ne posent pourtant leur manche suivante
 * qu'en réconciliant — sans ce rappel, la dernière manche d'une ronde tranchée
 * par le délai laissait le tournoi définitivement en cours, et sortait au
 * passage du champ de `findTournamentsNeedingSync` : plus rien ne le revisitait.
 */
describe("syncTournamentState — réconciliation après un report tranché par le délai", () => {
  beforeEach(resetMocks);
  afterEach(() => jest.restoreAllMocks());

  it.each(Object.keys(reconcilers))(
    "rappelle le moteur %s quand une manche vient d'être tranchée",
    async (format) => {
      (loadTournamentRow as jest.Mock).mockResolvedValue(runningRow({ format }) as never);
      (resolveExpiredScoreReports as jest.Mock).mockResolvedValue(1 as never);

      await syncTournamentState(connection, 5);

      expect(reconcilers[format as keyof typeof reconcilers]).toHaveBeenCalledWith(5, connection);

      // Un seul moteur est rappelé : les autres n'ont rien à faire là, et quatre
      // imports dynamiques par balayage se paieraient sur un chemin chaud.
      for (const [otherFormat, reconcile] of Object.entries(reconcilers)) {
        if (otherFormat === format) continue;
        expect(reconcile).not.toHaveBeenCalled();
      }
    },
  );

  it.each(Object.keys(reconcilers))(
    "ne rappelle pas le moteur %s quand aucun report n'a expiré",
    async (format) => {
      (loadTournamentRow as jest.Mock).mockResolvedValue(runningRow({ format }) as never);

      await syncTournamentState(connection, 5);

      expect(reconcilers[format as keyof typeof reconcilers]).not.toHaveBeenCalled();
    },
  );

  it.each(["SINGLE", "DOUBLE"])(
    "ne rappelle aucun moteur pour un tournoi %s : le plateau se propage seul",
    async (format) => {
      (loadTournamentRow as jest.Mock).mockResolvedValue(runningRow({ format }) as never);
      (resolveExpiredScoreReports as jest.Mock).mockResolvedValue(2 as never);

      await syncTournamentState(connection, 5);

      for (const reconcile of Object.values(reconcilers)) {
        expect(reconcile).not.toHaveBeenCalled();
      }
      expect(finalizeTournamentIfDone).toHaveBeenCalledWith(connection, 5);
    },
  );

  it("réconcilie avant de finaliser", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(runningRow({ format: "SWISS" }) as never);
    (resolveExpiredScoreReports as jest.Mock).mockResolvedValue(1 as never);

    const order: string[] = [];
    (reconcileSwiss as jest.Mock).mockImplementation((() => {
      order.push("reconcile");
      return Promise.resolve();
    }) as never);
    (finalizeTournamentIfDone as jest.Mock).mockImplementation((() => {
      order.push("finalize");
      return Promise.resolve();
    }) as never);

    await syncTournamentState(connection, 5);

    // La clôture générique sort d'elle-même pour ces formats, mais l'ordre reste
    // celui de `reportMatchScorePublic` : le classement d'abord, la clôture
    // ensuite.
    expect(order).toEqual(["reconcile", "finalize"]);
  });

  it("ne réconcilie rien tant que le tournoi n'est pas en cours", async () => {
    const future = new Date(Date.now() + 86_400_000);
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      runningRow({
        format: "SWISS",
        state: "UPCOMING",
        registration_open_at: future,
        registration_close_at: future,
        start_at: future,
      }) as never,
    );
    (resolveExpiredScoreReports as jest.Mock).mockResolvedValue(1 as never);

    await syncTournamentState(connection, 5);

    expect(resolveExpiredScoreReports).not.toHaveBeenCalled();
    expect(reconcileSwiss).not.toHaveBeenCalled();
  });
});

/**
 * `contentChanged` existe pour que l'appelant publie **après son commit** : le
 * moteur ne réveille plus la salle SSE depuis le fond d'une transaction.
 */
describe("syncTournamentState — `contentChanged`", () => {
  beforeEach(resetMocks);
  afterEach(() => jest.restoreAllMocks());

  it("est vrai quand le plateau vient d'être créé", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(runningRow({ format: "SINGLE" }) as never);
    (createBracketIfMissing as jest.Mock).mockResolvedValue({
      finished: false,
      created: true,
    } as never);

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(true);
    expect(result.stateChanged).toBe(false);
  });

  it("est vrai quand une manche a été tranchée par le délai", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(runningRow({ format: "SWISS" }) as never);
    (resolveExpiredScoreReports as jest.Mock).mockResolvedValue(1 as never);

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(true);
  });

  it("est faux quand l'entretien n'a rien écrit", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(runningRow({ format: "SINGLE" }) as never);

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(false);
  });

  it("est faux hors d'un tournoi en cours", async () => {
    const future = new Date(Date.now() + 86_400_000);
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      runningRow({
        state: "UPCOMING",
        registration_open_at: future,
        registration_close_at: future,
        start_at: future,
      }) as never,
    );

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(false);
  });
});
