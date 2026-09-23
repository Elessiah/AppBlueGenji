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
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import type { RowOverrides } from "../helpers/row-overrides";
import { tournamentRow } from "../helpers/tournament-rows";

function runningRow(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  const past = new Date(Date.now() - 86_400_000);
  return tournamentRow({
    id: 5,
    state: "RUNNING",
    format: "SWISS",
    finished_at: null,
    registration_open_at: past,
    registration_close_at: past,
    start_at: past,
    bracket_size: 8,
    ...overrides,
  });
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
  jest.mocked(createBracketIfMissing).mockResolvedValue({
    finished: false,
    created: false,
  });
  jest.mocked(resolveExpiredScoreReports).mockResolvedValue(0);
  jest.mocked(tryAutoResolveByes).mockResolvedValue(undefined);
  jest.mocked(finalizeTournamentIfDone).mockResolvedValue(undefined);
  jest.mocked(reconcileSurvival).mockResolvedValue({ done: false, standings: [] });
  jest.mocked(reconcileSwiss).mockResolvedValue({ done: false, ranked: [] });
  jest.mocked(reconcileEndurance).mockResolvedValue(undefined);
  jest.mocked(reconcilePhases).mockResolvedValue(undefined);
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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(Object.keys(reconcilers) as (keyof typeof reconcilers)[])(
    "rappelle le moteur %s quand une manche vient d'être tranchée",
    async (format) => {
      jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format }));
      jest.mocked(resolveExpiredScoreReports).mockResolvedValue(1);

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

  it.each(Object.keys(reconcilers) as (keyof typeof reconcilers)[])(
    "ne rappelle pas le moteur %s quand aucun report n'a expiré",
    async (format) => {
      jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format }));

      await syncTournamentState(connection, 5);

      expect(reconcilers[format as keyof typeof reconcilers]).not.toHaveBeenCalled();
    },
  );

  it.each<TournamentRow["format"]>(["SINGLE", "DOUBLE"])(
    "ne rappelle aucun moteur pour un tournoi %s : le plateau se propage seul",
    async (format) => {
      jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format }));
      jest.mocked(resolveExpiredScoreReports).mockResolvedValue(2);

      await syncTournamentState(connection, 5);

      for (const reconcile of Object.values(reconcilers)) {
        expect(reconcile).not.toHaveBeenCalled();
      }
      expect(finalizeTournamentIfDone).toHaveBeenCalledWith(connection, 5);
    },
  );

  it("réconcilie avant de finaliser", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format: "SWISS" }));
    jest.mocked(resolveExpiredScoreReports).mockResolvedValue(1);

    const order: string[] = [];
    jest.mocked(reconcileSwiss).mockImplementation((() => {
      order.push("reconcile");
      return Promise.resolve({ done: false, ranked: [] });
    }));
    jest.mocked(finalizeTournamentIfDone).mockImplementation((() => {
      order.push("finalize");
      return Promise.resolve();
    }));

    await syncTournamentState(connection, 5);

    // La clôture générique sort d'elle-même pour ces formats, mais l'ordre reste
    // celui de `reportMatchScorePublic` : le classement d'abord, la clôture
    // ensuite.
    expect(order).toEqual(["reconcile", "finalize"]);
  });

  it("ne réconcilie rien tant que le tournoi n'est pas en cours", async () => {
    const future = new Date(Date.now() + 86_400_000);
    jest.mocked(loadTournamentRow).mockResolvedValue(
      runningRow({
        format: "SWISS",
        state: "UPCOMING",
        registration_open_at: future,
        registration_close_at: future,
        start_at: future,
      }),
    );
    jest.mocked(resolveExpiredScoreReports).mockResolvedValue(1);

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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("est vrai quand le plateau vient d'être créé", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format: "SINGLE" }));
    jest.mocked(createBracketIfMissing).mockResolvedValue({
      finished: false,
      created: true,
    });

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(true);
    expect(result.stateChanged).toBe(false);
  });

  it("est vrai quand une manche a été tranchée par le délai", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format: "SWISS" }));
    jest.mocked(resolveExpiredScoreReports).mockResolvedValue(1);

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(true);
  });

  it("est faux quand l'entretien n'a rien écrit", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format: "SINGLE" }));

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(false);
  });

  it("est faux hors d'un tournoi en cours", async () => {
    const future = new Date(Date.now() + 86_400_000);
    jest.mocked(loadTournamentRow).mockResolvedValue(
      runningRow({
        state: "UPCOMING",
        registration_open_at: future,
        registration_close_at: future,
        start_at: future,
      }),
    );

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(false);
  });
});
