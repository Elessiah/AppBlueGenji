import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/finalization");
jest.mock("@/lib/server/tournaments/bracket-generator");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/bg-survie");
jest.mock("@/lib/server/tournaments/phases");

import { syncTournamentState } from "@/lib/server/tournaments/state";
import { loadTournamentRow, updateTournamentState } from "@/lib/server/tournaments/repository";
import {
  finalizeUnderfilledTournament,
  finalizeTournamentIfDone,
  resolveExpiredScoreReports,
} from "@/lib/server/tournaments/finalization";
import { createBracketIfMissing } from "@/lib/server/tournaments/bracket-generator";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { initializeSwissTournament, reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { initializeSurvivalTournament } from "@/lib/server/tournaments/survival";
import { initializeEnduranceTournament } from "@/lib/server/tournaments/bg-survie";
import { initializeMultiTournament } from "@/lib/server/tournaments/phases";

type Row = Record<string, unknown>;

const PAST = new Date(Date.now() - 86_400_000);
const FUTURE = new Date(Date.now() + 86_400_000);

/** Tournoi dont le coup d'envoi est passé : `computeTournamentState` dit RUNNING. */
function startingRow(overrides: Row = {}): Row {
  return {
    id: 7,
    state: "REGISTRATION",
    format: "SINGLE",
    finished_at: null,
    registration_open_at: PAST,
    registration_close_at: PAST,
    start_at: PAST,
    bracket_size: null,
    ...overrides,
  };
}

const connection = {} as never;

describe("syncTournamentState — coup d'envoi sans adversaires", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createBracketIfMissing as jest.Mock).mockResolvedValue({ finished: false } as never);
    (resolveExpiredScoreReports as jest.Mock).mockResolvedValue(undefined as never);
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
    (finalizeTournamentIfDone as jest.Mock).mockResolvedValue(undefined as never);
    (finalizeUnderfilledTournament as jest.Mock).mockResolvedValue(false as never);
  });

  /** Clôture acceptée : la relecture rend la ligne close. */
  function closesImmediately(row: Row): Row {
    const closed = { ...row, state: "FINISHED", finished_at: new Date() };
    (loadTournamentRow as jest.Mock)
      .mockResolvedValueOnce(row as never)
      .mockResolvedValueOnce(closed as never);
    (finalizeUnderfilledTournament as jest.Mock).mockResolvedValue(true as never);
    return closed;
  }

  it("clôt le tournoi au lieu de le passer en cours", async () => {
    const closed = closesImmediately(startingRow());

    const result = await syncTournamentState(connection, 7);

    expect(finalizeUnderfilledTournament).toHaveBeenCalledWith(connection, 7);
    expect(result.row).toBe(closed);
    expect(result.stateChanged).toBe(true);
    // Le tournoi ne passe jamais par `RUNNING` : il saute l'étape.
    expect(updateTournamentState).not.toHaveBeenCalled();
  });

  it.each([
    ["SWISS", initializeSwissTournament],
    ["SURVIVAL", initializeSurvivalTournament],
    ["BG_SURVIE", initializeEnduranceTournament],
    ["MULTI", initializeMultiTournament],
  ])("n'initialise aucun moteur %s pour un plateau sans match", async (format, initialize) => {
    closesImmediately(startingRow({ format }));

    await syncTournamentState(connection, 7);

    expect(initialize).not.toHaveBeenCalled();
    expect(createBracketIfMissing).not.toHaveBeenCalled();
    expect(reconcileSwiss).not.toHaveBeenCalled();
  });

  it("rattrape aussi le tournoi sorti des inscriptions sans avoir démarré", async () => {
    // Entre la clôture des inscriptions et l'heure de début, l'état stocké est
    // `UPCOMING` : c'est de là que part la bascule réelle vers `RUNNING`, et un
    // contrôle limité à `REGISTRATION → RUNNING` la manquerait.
    closesImmediately(startingRow({ state: "UPCOMING" }));

    const result = await syncTournamentState(connection, 7);

    expect(finalizeUnderfilledTournament).toHaveBeenCalledWith(connection, 7);
    expect(result.stateChanged).toBe(true);
  });

  it("rattrape le tournoi déjà annoncé en cours", async () => {
    closesImmediately(startingRow({ state: "RUNNING" }));

    const result = await syncTournamentState(connection, 7);

    expect(result.stateChanged).toBe(true);
    // L'entretien d'un tournoi en cours n'a plus lieu d'être : rien à jouer.
    expect(createBracketIfMissing).not.toHaveBeenCalled();
    expect(tryAutoResolveByes).not.toHaveBeenCalled();
    expect(finalizeTournamentIfDone).not.toHaveBeenCalled();
  });

  it("laisse partir un tournoi qui a de quoi être joué", async () => {
    const row = startingRow({ format: "SWISS" });
    (loadTournamentRow as jest.Mock).mockResolvedValue(row as never);
    (finalizeUnderfilledTournament as jest.Mock).mockResolvedValue(false as never);

    const result = await syncTournamentState(connection, 7);

    expect(initializeSwissTournament).toHaveBeenCalledWith(7, connection);
    expect(updateTournamentState).toHaveBeenCalledWith(connection, 7, "RUNNING");
    expect(result.stateChanged).toBe(true);
  });

  it("ne contrôle rien tant que le coup d'envoi n'est pas atteint", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      startingRow({
        state: "REGISTRATION",
        registration_close_at: FUTURE,
        start_at: FUTURE,
      }) as never,
    );

    await syncTournamentState(connection, 7);

    expect(finalizeUnderfilledTournament).not.toHaveBeenCalled();
  });

  it("ne rouvre pas un tournoi déjà terminé", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      startingRow({ state: "FINISHED", finished_at: PAST }) as never,
    );

    await syncTournamentState(connection, 7);

    expect(finalizeUnderfilledTournament).not.toHaveBeenCalled();
  });
});
