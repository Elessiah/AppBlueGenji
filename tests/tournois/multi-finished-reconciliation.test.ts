import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import type { TournamentPhaseStanding } from "@/lib/shared/types";

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/phases-repository");
jest.mock("@/lib/server/tournaments/finalization");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/bracket-generator");

import { reconcilePhases } from "@/lib/server/tournaments/phases";
import { finishTournament, getRegistrationRows, loadTournamentRow } from "@/lib/server/tournaments/repository";
import {
  insertPhaseTeams,
  loadPhase,
  loadPhaseTeamIds,
  loadPhaseStandings,
  loadPhases,
  savePhaseResults,
  setCurrentPhase,
  setPhaseState,
  updatePhaseResolution,
} from "@/lib/server/tournaments/phases-repository";
import {
  isEliminationPhaseComplete,
  rankEliminationPhase,
} from "@/lib/server/tournaments/finalization";
import { loadSwissRanking, reconcileSwiss } from "@/lib/server/tournaments/swiss";

/**
 * Corriger le score de la finale d'un tournoi **MULTI** terminé.
 *
 * Même défaut que celui des trois modes à classement
 * (`finished-reconciliation.test.ts`), mais à **deux gardes** au lieu d'une :
 * `reconcilePhases` sortait sur l'état du tournoi *et* sur celui de la phase
 * courante — or la phase finale d'un tournoi clos est close elle aussi, c'est
 * `reconcilePhases` qui l'a fermée juste avant de finaliser. Lever la première
 * seule n'aurait rien changé.
 *
 * Ce que ce fichier tient : **le classement se rejoue, le tournoi ne se rouvre
 * pas.** Sur un tournoi clos, le classement de la dernière phase est réécrit et
 * la finalisation rejouée ; rien d'autre n'est touché — ni la date de clôture
 * de la phase, ni le plan des phases restantes, ni le démarrage d'une suivante.
 */

type PhaseTeam = { teamId: number; seed: number; rank: number | null; qualified: boolean };

const TOURNAMENT_ID = 42;
const PHASE_1 = 421;
const PHASE_2 = 422;

/** Les équipes de chaque phase, écrites par `savePhaseResults` et relues par le classement. */
const phaseTeams = new Map<number, PhaseTeam[]>();

/** Ce que le tournoi et sa phase courante racontent d'eux-mêmes. */
let tournamentState = "FINISHED";
let currentPhaseId: number | null = PHASE_2;
let phaseStates: Record<number, string> = { [PHASE_1]: "FINISHED", [PHASE_2]: "FINISHED" };
let tournamentFormat = "MULTI";

function phaseRow(id: number, position: number) {
  return {
    id,
    tournament_id: TOURNAMENT_ID,
    position,
    name: `Phase ${position}`,
    format: "SINGLE",
    qualifier_mode: "COUNT",
    qualifier_value: position === 2 ? 1 : 2,
    has_third_place_match: 0,
    swiss_total_rounds: null,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    survival_current_round: 0,
    survival_barrage_rounds: 0,
    state: phaseStates[id],
    entrants: position === 2 ? 2 : 4,
    qualifiers: position === 2 ? 1 : 2,
    max_rounds: null,
    bracket_size: null,
    started_at: new Date(),
    finished_at: position === 2 ? new Date("2026-09-01T12:00:00Z") : new Date(),
    created_at: new Date(),
  };
}

/**
 * Connexion factice. Elle ne répond qu'à une chose : la lecture verrouillante
 * qui ouvre `reconcilePhases` (format et état du tournoi) — le reste du module
 * passe par le dépôt, ici simulé. Les rangs finaux, eux, s'écrivent en SQL et
 * se relisent donc dans les appels enregistrés.
 */
function makeConn() {
  const execute = jest.fn(async (sql: unknown) => {
    if (String(sql).includes("SELECT format, state FROM bg_tournaments")) {
      return [[{ format: tournamentFormat, state: tournamentState }], undefined];
    }
    return [[], undefined];
  });
  return { execute } as unknown as PoolConnection & { execute: jest.Mock };
}

/** Les rangs finaux écrits par la finalisation, équipe vers rang. */
function writtenFinalRanks(conn: { execute: jest.Mock }): Map<number, number> {
  const ranks = new Map<number, number>();
  for (const call of conn.execute.mock.calls) {
    const sql = String(call[0]);
    if (!sql.includes("UPDATE bg_tournament_registrations")) continue;
    const values = (call[1] ?? []) as unknown[];
    const pairs = (sql.match(/WHEN \? THEN \?/g) ?? []).length;
    for (let index = 0; index < pairs * 2; index += 2) {
      ranks.set(Number(values[index]), Number(values[index + 1]));
    }
  }
  return ranks;
}

beforeEach(() => {
  jest.clearAllMocks();

  tournamentState = "FINISHED";
  tournamentFormat = "MULTI";
  currentPhaseId = PHASE_2;
  phaseStates = { [PHASE_1]: "FINISHED", [PHASE_2]: "FINISHED" };

  // La phase finale oppose les deux qualifiées ; l'équipe 1 y est championne au
  // palmarès stocké, et c'est ce résultat que l'arbitre vient de corriger.
  phaseTeams.set(PHASE_1, [
    { teamId: 1, seed: 1, rank: 1, qualified: true },
    { teamId: 2, seed: 2, rank: 2, qualified: true },
    { teamId: 3, seed: 3, rank: 3, qualified: false },
    { teamId: 4, seed: 4, rank: 4, qualified: false },
  ]);
  phaseTeams.set(PHASE_2, [
    { teamId: 1, seed: 1, rank: 1, qualified: true },
    { teamId: 2, seed: 2, rank: 2, qualified: false },
  ]);

  (loadTournamentRow as jest.Mock).mockImplementation(async () => ({
    id: TOURNAMENT_ID,
    format: tournamentFormat,
    state: tournamentState,
    current_phase_id: currentPhaseId,
  }));
  (getRegistrationRows as jest.Mock).mockImplementation(async () =>
    [1, 2, 3, 4].map((team_id) => ({ team_id, tournament_id: TOURNAMENT_ID })),
  );
  (finishTournament as jest.Mock).mockImplementation(async () => undefined);

  (loadPhases as jest.Mock).mockImplementation(async () => [
    phaseRow(PHASE_1, 1),
    phaseRow(PHASE_2, 2),
  ]);
  (loadPhase as jest.Mock).mockImplementation(async (_conn: unknown, id: unknown) =>
    Number(id) === PHASE_1 ? phaseRow(PHASE_1, 1) : phaseRow(PHASE_2, 2),
  );
  (loadPhaseTeamIds as jest.Mock).mockImplementation(async (_conn: unknown, phaseId: unknown) =>
    (phaseTeams.get(Number(phaseId)) ?? []).map((team) => team.teamId),
  );
  (savePhaseResults as jest.Mock).mockImplementation(
    async (
      _conn: unknown,
      phaseId: unknown,
      ranked: unknown,
    ) => {
      const teams = phaseTeams.get(Number(phaseId)) ?? [];
      for (const item of ranked as PhaseTeam[] & Array<{ teamId: number; rank: number; qualified: boolean }>) {
        const team = teams.find((candidate) => candidate.teamId === item.teamId);
        if (team) {
          team.rank = item.rank;
          team.qualified = item.qualified;
        }
      }
    },
  );
  (loadPhaseStandings as jest.Mock).mockImplementation(async (_conn: unknown, phaseId: unknown) => {
    const teams = [...(phaseTeams.get(Number(phaseId)) ?? [])];
    teams.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.seed - b.seed);
    return teams.map<TournamentPhaseStanding>((team) => ({
      teamId: team.teamId,
      teamName: `Team ${team.teamId}`,
      logoUrl: null,
      seed: team.seed,
      rank: team.rank,
      qualified: team.qualified,
    }));
  });
  // Les écritures d'état sont **retenues** : `reconcilePhases` se rappelle
  // lui-même après avoir lancé une phase, et des mocks amnésiques le feraient
  // tourner en rond sur la même phase.
  (setPhaseState as jest.Mock).mockImplementation(
    async (_conn: unknown, phaseId: unknown, state: unknown) => {
      phaseStates[Number(phaseId)] = String(state);
    },
  );
  (setCurrentPhase as jest.Mock).mockImplementation(
    async (_conn: unknown, _tournamentId: unknown, phaseId: unknown) => {
      currentPhaseId = phaseId === null ? null : Number(phaseId);
    },
  );
  (updatePhaseResolution as jest.Mock).mockImplementation(async () => undefined);
  (insertPhaseTeams as jest.Mock).mockImplementation(
    async (_conn: unknown, _tournamentId: unknown, phaseId: unknown, teams: unknown) => {
      phaseTeams.set(
        Number(phaseId),
        (teams as Array<{ teamId: number; seed: number }>).map((team) => ({
          teamId: team.teamId,
          seed: team.seed,
          rank: null,
          qualified: false,
        })),
      );
    },
  );

  // La finale est jouée, et le rejeu du bracket donne désormais l'équipe 2
  // championne — c'est la correction de score que l'on suit.
  (isEliminationPhaseComplete as jest.Mock).mockImplementation(async () => true);
  (rankEliminationPhase as jest.Mock).mockImplementation(async () => [2, 1]);
});

describe("reconcilePhases sur un tournoi MULTI terminé", () => {
  it("réécrit le classement de la phase finale depuis le rejeu du bracket", async () => {
    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(savePhaseResults).toHaveBeenCalledWith(conn, PHASE_2, [
      { teamId: 2, rank: 1, qualified: true },
      { teamId: 1, rank: 2, qualified: false },
    ]);
  });

  it("porte la nouvelle championne au palmarès du tournoi", async () => {
    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    const ranks = writtenFinalRanks(conn);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(1)).toBe(2);
    // Les éliminées de la première phase restent derrière les finalistes.
    expect(ranks.get(3)).toBe(3);
    expect(ranks.get(4)).toBe(4);
    expect(finishTournament).toHaveBeenCalledWith(conn, TOURNAMENT_ID);
  });

  it("ne redate pas la clôture de la phase, déjà close", async () => {
    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(setPhaseState).not.toHaveBeenCalled();
  });

  it("ne rouvre rien : ni plan des phases, ni phase suivante", async () => {
    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(updatePhaseResolution).not.toHaveBeenCalled();
    expect(insertPhaseTeams).not.toHaveBeenCalled();
    expect(setCurrentPhase).not.toHaveBeenCalled();
  });

  it("est idempotente : un second passage écrit le même palmarès", async () => {
    const first = makeConn();
    await reconcilePhases(TOURNAMENT_ID, first);
    const second = makeConn();
    await reconcilePhases(TOURNAMENT_ID, second);

    expect(writtenFinalRanks(second)).toEqual(writtenFinalRanks(first));
    expect(setPhaseState).not.toHaveBeenCalled();
    expect(insertPhaseTeams).not.toHaveBeenCalled();
  });

  it("délègue au moteur de la phase quand elle est en ronde suisse", async () => {
    phaseStates = { [PHASE_1]: "FINISHED", [PHASE_2]: "FINISHED" };
    (loadPhase as jest.Mock).mockImplementation(async () => ({
      ...phaseRow(PHASE_2, 2),
      format: "SWISS",
      swiss_total_rounds: 3,
    }));
    (reconcileSwiss as jest.Mock).mockImplementation(async () => ({ done: true, ranked: [] }));
    (loadSwissRanking as jest.Mock).mockImplementation(async () => [2, 1]);

    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(reconcileSwiss).toHaveBeenCalledWith(TOURNAMENT_ID, conn, { phaseId: PHASE_2 });
    expect(writtenFinalRanks(conn).get(2)).toBe(1);
  });

  it("ne touche à rien si la phase n'est pas complète", async () => {
    (isEliminationPhaseComplete as jest.Mock).mockImplementation(async () => false);

    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(savePhaseResults).not.toHaveBeenCalled();
    expect(finishTournament).not.toHaveBeenCalled();
  });
});

describe("reconcilePhases — les états qui ne se relisent pas", () => {
  it("ignore un tournoi clos dont la phase courante serait encore en cours", async () => {
    // Incohérence : on ne la répare pas ici, on ne la relit pas non plus.
    phaseStates = { [PHASE_1]: "FINISHED", [PHASE_2]: "RUNNING" };

    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(savePhaseResults).not.toHaveBeenCalled();
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("ignore un tournoi clos sans phase courante (clos faute d'engagées)", async () => {
    currentPhaseId = null;

    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(savePhaseResults).not.toHaveBeenCalled();
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it.each(["UPCOMING", "REGISTRATION"])("ignore un tournoi en état %s", async (state) => {
    tournamentState = state;

    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(loadPhases).not.toHaveBeenCalled();
    expect(savePhaseResults).not.toHaveBeenCalled();
  });

  it("ignore un tournoi qui n'est pas MULTI", async () => {
    tournamentFormat = "SINGLE";

    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(loadPhases).not.toHaveBeenCalled();
    expect(savePhaseResults).not.toHaveBeenCalled();
  });
});

describe("reconcilePhases — le chemin ordinaire reste intact", () => {
  it("clôt la phase et lance la suivante sur un tournoi en cours", async () => {
    tournamentState = "RUNNING";
    phaseStates = { [PHASE_1]: "RUNNING", [PHASE_2]: "PENDING" };
    currentPhaseId = PHASE_1;
    (loadPhase as jest.Mock).mockImplementation(async () => phaseRow(PHASE_1, 1));
    (rankEliminationPhase as jest.Mock).mockImplementation(async () => [1, 2, 3, 4]);

    const conn = makeConn();
    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(setPhaseState).toHaveBeenCalledWith(conn, PHASE_1, "FINISHED", "finished_at");
    expect(updatePhaseResolution).toHaveBeenCalled();
    expect(insertPhaseTeams).toHaveBeenCalledWith(conn, TOURNAMENT_ID, PHASE_2, [
      { teamId: 1, seed: 1 },
      { teamId: 2, seed: 2 },
    ]);
  });
});
