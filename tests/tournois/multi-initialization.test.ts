/**
 * `initializeMultiTournament` — branches du coup d'envoi d'un multi-phases :
 * tournoi vide, toutes phases sautées, seeding par classement ou à la main.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/phases-repository");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/ranking-service");
jest.mock("@/lib/server/tournaments/bracket-generator");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/finalization");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/survival");

import { initializeMultiTournament } from "@/lib/server/tournaments/phases";
import {
  insertPhaseTeams,
  loadPhase,
  loadPhases,
  updatePhaseResolution,
} from "@/lib/server/tournaments/phases-repository";
import {
  finishTournament,
  getRegistrationRows,
  loadTournamentRow,
} from "@/lib/server/tournaments/repository";
import { loadEntrantsBySiteRanking } from "@/lib/server/ranking-service";
import type { RankedEntrant } from "@/lib/server/ranking-service";
import { connectionMock, fakeConnection } from "../helpers/sql-double";
import { phaseRow, registrationRow, tournamentRow } from "../helpers/tournament-rows";

const TOURNAMENT_ID = 7;

function setup(registered: number[], options: { manualSeeding?: boolean } = {}) {
  const conn = connectionMock();
  // Après le lancement de la première phase, `reconcilePhases` relit le
  // tournoi : une ligne absente l'arrête net.
  conn.execute.mockResolvedValue([[]]);
  jest.mocked(loadTournamentRow).mockResolvedValue(
    tournamentRow({ id: TOURNAMENT_ID, format: "MULTI", manual_seeding: options.manualSeeding ? 1 : 0 }),
  );
  jest.mocked(loadPhases).mockResolvedValue([
    phaseRow({ id: 11, position: 1, format: "SWISS", swiss_total_rounds: 3, qualifier_value: 4 }),
    phaseRow({ id: 12, position: 2, format: "SINGLE", qualifier_value: 1 }),
  ]);
  jest.mocked(getRegistrationRows).mockResolvedValue(
    registered.map((teamId) => registrationRow({ team_id: teamId })),
  );
  jest.mocked(loadEntrantsBySiteRanking).mockResolvedValue(
    registered.map((teamId) => ({ teamId }) as RankedEntrant),
  );
  jest.mocked(loadPhase).mockResolvedValue(null);
  return conn;
}

describe("initializeMultiTournament", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ne fait rien hors format MULTI", async () => {
    const conn = connectionMock();
    jest.mocked(loadTournamentRow).mockResolvedValue(tournamentRow({ format: "SINGLE" }));
    await initializeMultiTournament(TOURNAMENT_ID, fakeConnection(conn));
    expect(loadPhases).not.toHaveBeenCalled();
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("clôt un tournoi sans inscrite, toutes ses phases sautées", async () => {
    const conn = setup([]);
    await initializeMultiTournament(TOURNAMENT_ID, fakeConnection(conn));
    expect(updatePhaseResolution).toHaveBeenCalledTimes(2);
    expect(jest.mocked(updatePhaseResolution).mock.calls.map(([, , r]) => r.state)).toEqual([
      "SKIPPED",
      "SKIPPED",
    ]);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(insertPhaseTeams).not.toHaveBeenCalled();
    expect(finishTournament).toHaveBeenCalledWith(conn, TOURNAMENT_ID);
  });

  it("déclare première l'unique inscrite quand toutes les phases sont sautées", async () => {
    const conn = setup([5]);
    await initializeMultiTournament(TOURNAMENT_ID, fakeConnection(conn));
    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET final_rank = 1"),
      [TOURNAMENT_ID, 5],
    );
    expect(insertPhaseTeams).not.toHaveBeenCalled();
    expect(finishTournament).toHaveBeenCalledWith(conn, TOURNAMENT_ID);
  });

  it("seed la première phase par le classement du site", async () => {
    const conn = setup([9, 3, 4, 8, 1, 2, 6, 5]);
    await initializeMultiTournament(TOURNAMENT_ID, fakeConnection(conn));
    expect(insertPhaseTeams).toHaveBeenCalledWith(
      conn,
      TOURNAMENT_ID,
      11,
      [9, 3, 4, 8, 1, 2, 6, 5].map((teamId, index) => ({ teamId, seed: index + 1 })),
    );
    expect(finishTournament).not.toHaveBeenCalled();
    // Le lancement relit la phase, puis la réconciliation verrouille le tournoi.
    expect(loadPhase).toHaveBeenCalledWith(conn, 11);
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), [TOURNAMENT_ID]);
  });

  it("garde l'ordre saisi par le staff quand le seeding est manuel", async () => {
    const conn = setup([1, 2, 3, 4, 5, 6, 7, 8], { manualSeeding: true });
    conn.execute.mockResolvedValueOnce([
      [
        { team_id: 4, seed: 1 },
        { team_id: 2, seed: 2 },
      ],
    ]);
    await initializeMultiTournament(TOURNAMENT_ID, fakeConnection(conn));
    expect(loadEntrantsBySiteRanking).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls[0][0]).toContain("ROW_NUMBER()");
    expect(insertPhaseTeams).toHaveBeenCalledWith(conn, TOURNAMENT_ID, 11, [
      { teamId: 4, seed: 1 },
      { teamId: 2, seed: 2 },
    ]);
  });
});
