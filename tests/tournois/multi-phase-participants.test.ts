import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import type { TournamentPhaseStanding } from "@/lib/shared/types";

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/phases-repository");
jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/bracket-generator");
jest.mock("@/lib/server/ranking-service");
jest.mock("@/lib/shared/survival", () => ({ computeFinalRanks: jest.fn() }));

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
import { loadSwissRanking, reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { reconcileSurvival } from "@/lib/server/tournaments/survival";
import { computeFinalRanks } from "@/lib/shared/survival";
import type { PhaseRow, TournamentRow } from "@/lib/server/tournaments/_internal";
import { phaseRow, registrationRow, tournamentRow } from "../helpers/tournament-rows";
import { type SqlMock, fakeConnection } from "../helpers/sql-double";

/**
 * Une phase à élimination d'un tournoi **MULTI** ne range et ne qualifie que
 * **ses** équipes.
 *
 * Le reste du classement d'un tableau (`rankEliminationPhase`) partait de
 * toutes les inscriptions du tournoi. Dans une phase qui n'est pas la
 * première, une équipe sortie plus tôt y figurait sur 0 V – 0 D : devant les
 * perdantes 0 V – 1 D de la phase, elle décalait leurs rangs — que la
 * finalisation reporte dans `final_rank` — et, la qualification se comptant
 * par index, pouvait prendre une place et rentrer dans la phase suivante.
 *
 * Le moteur des phases et le classement d'un tableau tournent ici **pour de
 * vrai** ; seuls les moteurs Suisse et Survie (qui rendent un ordre déjà
 * restreint à la phase), le générateur de tableau et la base sont simulés. La
 * base simulée rejoue les requêtes du tableau sur une liste de matchs en
 * mémoire, et le reste du classement **suit la jointure écrite dans le SQL** :
 * facultative, elle ramène toutes les inscriptions ; stricte, les seules
 * équipes de la phase.
 */

type PhaseTeam = { teamId: number; seed: number; rank: number | null; qualified: boolean };

type Match = {
  phaseId: number;
  bracket: "UPPER" | "LOWER" | "GRAND" | "THIRD_PLACE";
  round: number;
  team1: number | null;
  team2: number | null;
  winner: number | null;
  doubleForfeit?: boolean;
};

const TOURNAMENT_ID = 77;
const TEAMS = [1, 2, 3, 4, 5, 6, 7, 8];

let phases: PhaseRow[];
let phaseTeams: Map<number, PhaseTeam[]>;
let matches: Match[];
let tournamentState: TournamentRow["state"];
let currentPhaseId: number | null;
/** Fait rendre au reste du classement toutes les inscriptions, quelle que soit la jointure. */
let looseRest: boolean;

const loserOf = (m: Match): number | null => {
  if (m.winner === null || m.doubleForfeit) return null;
  return m.winner === m.team1 ? m.team2 : m.team1;
};
const BRACKET_ORDER = ["UPPER", "LOWER", "GRAND", "THIRD_PLACE"];

function podiumRow(m: Match | undefined) {
  if (!m) return [];
  return [
    {
      team1_id: m.team1,
      team2_id: m.team2,
      winner_team_id: m.winner,
      loser_team_id: loserOf(m),
      status: "COMPLETED",
      double_forfeit: m.doubleForfeit ? 1 : 0,
    },
  ];
}

/** Bilan d'une équipe dans une phase, comme le calcule la requête du reste. */
function restRow(teamId: number, phaseId: number, seed: number | null) {
  let wins = 0;
  let losses = 0;
  let lastStage: number | null = null;
  for (const m of matches.filter((candidate) => candidate.phaseId === phaseId)) {
    const involved = m.team1 === teamId || m.team2 === teamId;
    const won = m.winner === teamId;
    const lost = loserOf(m) === teamId || (Boolean(m.doubleForfeit) && involved);
    if (won) wins += 1;
    if (lost) losses += 1;
    if (won || lost) {
      const stage = (BRACKET_ORDER.indexOf(m.bracket) + 1) * 1000 + m.round;
      lastStage = Math.max(lastStage ?? 0, stage);
    }
  }
  return { team_id: teamId, seed, wins, losses, last_stage: lastStage };
}

/** Les requêtes SQL du classement d'un tableau, rejouées sur `matches`. */
function answer(rawSql: string, params: unknown[]): unknown[] {
  const sql = rawSql.replace(/\s+/g, " ").trim();
  const phaseId = Number(params[1]);
  const inPhase = matches.filter((m) => m.phaseId === phaseId);

  if (sql.startsWith("SELECT format, state FROM bg_tournaments")) {
    return [{ format: "MULTI", state: tournamentState }];
  }
  if (sql.includes("COUNT(*) AS c") && sql.includes("winner_team_id IS NULL")) {
    return [{ c: inPhase.filter((m) => m.winner === null && !m.doubleForfeit).length }];
  }
  if (sql.includes("COUNT(*) AS c FROM bg_matches")) return [{ c: inPhase.length }];
  if (sql.includes("bracket = 'GRAND' AND round_number = 1")) {
    return podiumRow(inPhase.find((m) => m.bracket === "GRAND" && m.round === 1));
  }
  if (sql.includes("bracket = 'UPPER' ORDER BY round_number DESC")) {
    const upper = inPhase.filter((m) => m.bracket === "UPPER").sort((a, b) => b.round - a.round);
    return podiumRow(upper[0]);
  }
  if (sql.includes("bracket = 'THIRD_PLACE'")) {
    return podiumRow(inPhase.find((m) => m.bracket === "THIRD_PLACE"));
  }
  if (sql.startsWith("SELECT team1_id AS team_id FROM bg_matches")) {
    const forfeited = new Set(
      inPhase.filter((m) => m.doubleForfeit).flatMap((m) => [m.team1, m.team2]),
    );
    forfeited.delete(null);
    return [...forfeited].map((team_id) => ({ team_id }));
  }
  if (sql.startsWith("SELECT r.team_id,")) {
    // params : phase (seed), phase (matchs), tournoi, puis les équipes placées.
    const restPhase = Number(params[0]);
    const placed = new Set(params.slice(3).map(Number));
    const ownTeams = phaseTeams.get(restPhase) ?? [];
    const strict = !looseRest && !sql.includes("LEFT JOIN bg_tournament_phase_teams");
    const base = strict ? ownTeams.map((team) => team.teamId) : TEAMS;
    return base
      .filter((teamId) => !placed.has(teamId))
      .map((teamId) =>
        restRow(teamId, restPhase, ownTeams.find((team) => team.teamId === teamId)?.seed ?? null),
      );
  }
  return [];
}

let execute: SqlMock;
const conn = (): PoolConnection => fakeConnection({ execute });

/** Les rangs finaux écrits par la finalisation, équipe vers rang. */
function finalRanks(): Map<number, number> {
  const ranks = new Map<number, number>();
  for (const [sql, params] of execute.mock.calls) {
    if (!sql.includes("UPDATE bg_tournament_registrations")) continue;
    const values = (params ?? []) as unknown[];
    for (let index = 0; index + 1 < values.length; index += 2) {
      ranks.set(Number(values[index]), Number(values[index + 1]));
    }
  }
  return ranks;
}

/** Rang et qualification écrits pour une phase, dans l'ordre du classement. */
function savedResults(phaseId: number) {
  const call = jest.mocked(savePhaseResults).mock.calls.find(([, id]) => id === phaseId);
  return call?.[2] ?? [];
}

/** Équipes engagées dans une phase lancée en cours de route. */
function insertedTeams(phaseId: number): number[] {
  const call = jest.mocked(insertPhaseTeams).mock.calls.find(([, , id]) => id === phaseId);
  return (call?.[3] ?? []).map((team) => team.teamId);
}

function phase(overrides: Parameters<typeof phaseRow>[0]): PhaseRow {
  return phaseRow({ tournament_id: TOURNAMENT_ID, qualifier_mode: "COUNT", ...overrides });
}

/** Plateau de la phase 1 : toutes les inscrites, seedées dans l'ordre. */
function seedFirstPhase(phaseId: number) {
  phaseTeams.set(
    phaseId,
    TEAMS.map((teamId, index) => ({ teamId, seed: index + 1, rank: null, qualified: false })),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  phaseTeams = new Map();
  matches = [];
  tournamentState = "RUNNING";
  looseRest = false;
  execute = jest.fn<(sql: string, params?: unknown) => Promise<unknown>>(async (sql, params) => [
    answer(sql, (params ?? []) as unknown[]),
    undefined,
  ]);

  jest.mocked(loadTournamentRow).mockImplementation(async () =>
    tournamentRow({
      id: TOURNAMENT_ID,
      format: "MULTI",
      state: tournamentState,
      current_phase_id: currentPhaseId,
    }),
  );
  jest.mocked(getRegistrationRows).mockImplementation(async () =>
    TEAMS.map((team_id) => registrationRow({ team_id })),
  );
  jest.mocked(finishTournament).mockImplementation(async () => {
    tournamentState = "FINISHED";
  });

  const phaseById = (id: number) => phases.find((p) => p.id === id) ?? null;
  jest.mocked(loadPhases).mockImplementation(async () => phases.map((p) => ({ ...p })));
  jest.mocked(loadPhase).mockImplementation(async (_conn, id) => {
    const found = phaseById(Number(id));
    return found ? { ...found } : null;
  });
  jest.mocked(setPhaseState).mockImplementation(async (_conn, id, state) => {
    const found = phaseById(id);
    if (found) found.state = state;
  });
  jest.mocked(setCurrentPhase).mockImplementation(async (_conn, _tournamentId, id) => {
    currentPhaseId = id;
  });
  jest.mocked(updatePhaseResolution).mockImplementation(async (_conn, id, params) => {
    const found = phaseById(id);
    if (!found) return;
    if (params.entrants !== undefined) found.entrants = params.entrants;
    if (params.qualifiers !== undefined) found.qualifiers = params.qualifiers;
    if (params.maxRounds !== undefined) found.max_rounds = params.maxRounds;
    if (params.state !== undefined) found.state = params.state;
  });
  jest.mocked(insertPhaseTeams).mockImplementation(async (_conn, _tournamentId, id, teams) => {
    phaseTeams.set(
      id,
      teams.map((team) => ({ teamId: team.teamId, seed: team.seed, rank: null, qualified: false })),
    );
  });
  jest.mocked(loadPhaseTeamIds).mockImplementation(async (_conn, id) =>
    (phaseTeams.get(id) ?? []).map((team) => team.teamId),
  );
  jest.mocked(savePhaseResults).mockImplementation(async (_conn, id, ranked) => {
    for (const item of ranked) {
      const team = phaseTeams.get(id)?.find((candidate) => candidate.teamId === item.teamId);
      if (team) {
        team.rank = item.rank;
        team.qualified = item.qualified;
      }
    }
  });
  jest.mocked(loadPhaseStandings).mockImplementation(async (_conn, id) =>
    [...(phaseTeams.get(id) ?? [])]
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.seed - b.seed)
      .map<TournamentPhaseStanding>((team) => ({
        teamId: team.teamId,
        teamName: `Équipe ${team.teamId}`,
        logoUrl: null,
        seed: team.seed,
        rank: team.rank,
        qualified: team.qualified,
      })),
  );
});

/** Une phase Suisse close, dont le moteur rend ce classement. */
function swissPhaseDone(order: number[]) {
  jest.mocked(reconcileSwiss).mockResolvedValue({ done: true, ranked: [] });
  jest.mocked(loadSwissRanking).mockResolvedValue(order);
}

/** Une phase Survie close, dont le moteur rend ce classement. */
function survivalPhaseDone(order: number[]) {
  jest.mocked(reconcileSurvival).mockResolvedValue({ done: true, standings: [] });
  jest.mocked(computeFinalRanks).mockReturnValue(new Map(order.map((teamId, i) => [teamId, i + 1])));
}

describe("phase à élimination après une Ronde suisse (deux phases)", () => {
  beforeEach(() => {
    phases = [
      phase({ id: 11, position: 1, format: "SWISS", qualifier_value: 4, state: "RUNNING", entrants: 8, qualifiers: 4 }),
      phase({ id: 12, position: 2, format: "SINGLE", qualifier_value: 1, entrants: 4, qualifiers: 1 }),
    ];
    currentPhaseId = 11;
    seedFirstPhase(11);
    swissPhaseDone([3, 1, 4, 2, 5, 6, 7, 8]);
    // Tableau final : 3 (seed 1), 1 (seed 2), 4 (seed 3), 2 (seed 4).
    matches = [
      { phaseId: 12, bracket: "UPPER", round: 1, team1: 3, team2: 2, winner: 3 },
      { phaseId: 12, bracket: "UPPER", round: 1, team1: 1, team2: 4, winner: 4 },
      { phaseId: 12, bracket: "UPPER", round: 2, team1: 3, team2: 4, winner: 4 },
    ];
  });

  it("range les seules équipes de la phase, sans trou après le podium", async () => {
    await reconcilePhases(TOURNAMENT_ID, conn());

    expect(insertedTeams(12)).toEqual([3, 1, 4, 2]);
    // Les demi-finalistes battues (0 V – 1 D) suivent le podium aux rangs 3 et
    // 4 ; les équipes sorties en Suisse (0 V – 0 D ici) n'y figurent pas.
    expect(savedResults(12)).toEqual([
      { teamId: 4, rank: 1, qualified: true },
      { teamId: 3, rank: 2, qualified: false },
      { teamId: 1, rank: 3, qualified: false },
      { teamId: 2, rank: 4, qualified: false },
    ]);
  });

  it("classe le tournoi phase par phase, chaque sortie sur sa propre phase", async () => {
    await reconcilePhases(TOURNAMENT_ID, conn());

    expect(tournamentState).toBe("FINISHED");
    expect(Object.fromEntries(finalRanks())).toEqual({
      4: 1, 3: 2, 1: 3, 2: 4,
      // Sorties en Suisse : leur rang de la Ronde suisse, à la suite.
      5: 5, 6: 6, 7: 7, 8: 8,
    });
  });

  it("ne lit dans la phase que ses équipes", async () => {
    await reconcilePhases(TOURNAMENT_ID, conn());

    const rest = execute.mock.calls.find(([sql]) => sql.includes("SELECT\n      r.team_id"));
    expect(rest?.[0]).toMatch(/\n\s+JOIN bg_tournament_phase_teams pt ON pt\.phase_id = \?/);
  });
});

describe("Ronde suisse, puis double élimination finale à exemption et double forfait (deux phases)", () => {
  beforeEach(() => {
    phases = [
      phase({ id: 21, position: 1, format: "SWISS", qualifier_value: 4, state: "RUNNING", entrants: 8, qualifiers: 4 }),
      phase({ id: 22, position: 2, format: "DOUBLE", qualifier_value: 1, entrants: 4, qualifiers: 1 }),
    ];
    currentPhaseId = 21;
    seedFirstPhase(21);
    swissPhaseDone([1, 2, 3, 4, 5, 6, 7, 8]);
    matches = [
      { phaseId: 22, bracket: "UPPER", round: 1, team1: 1, team2: 4, winner: 1 },
      { phaseId: 22, bracket: "UPPER", round: 1, team1: 2, team2: 3, winner: 2 },
      { phaseId: 22, bracket: "UPPER", round: 2, team1: 1, team2: 2, winner: 1 },
      // Les deux perdantes du premier tour déclarent forfait l'une contre l'autre…
      { phaseId: 22, bracket: "LOWER", round: 1, team1: 4, team2: 3, winner: null, doubleForfeit: true },
      // … et la finale du bas de tableau se gagne par exemption.
      { phaseId: 22, bracket: "LOWER", round: 2, team1: 2, team2: null, winner: 2 },
      { phaseId: 22, bracket: "GRAND", round: 1, team1: 1, team2: 2, winner: 2 },
    ];
  });

  it("range les équipes du double forfait juste derrière le podium", async () => {
    await reconcilePhases(TOURNAMENT_ID, conn());

    // 3 et 4 : 0 V – 2 D, sorties au premier tour du bas de tableau, départagées
    // par leur seed de phase. Les sorties de la Ronde suisse n'y figurent pas.
    expect(savedResults(22)).toEqual([
      { teamId: 2, rank: 1, qualified: true },
      { teamId: 1, rank: 2, qualified: false },
      { teamId: 3, rank: 3, qualified: false },
      { teamId: 4, rank: 4, qualified: false },
    ]);
  });

  it("finalise sur la phase atteinte, puis sur le rang qu'on y a obtenu", async () => {
    await reconcilePhases(TOURNAMENT_ID, conn());

    expect(Object.fromEntries(finalRanks())).toEqual({
      2: 1, 1: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8,
    });
  });
});

/**
 * Plan à trois phases : Survie, élimination simple **intermédiaire** (bracket
 * tronqué à une manche), double élimination finale. Le tableau intermédiaire
 * compte trois engagées : la tête de série passe par exemption, les deux
 * autres s'affrontent.
 *
 * Les rencontres d'une manche tronquée sont toutes au même tour : laquelle la
 * requête « finale » relève n'est pas fixée par la base. La base simulée rend
 * la première de la liste — l'exemption, posée en tête ici.
 */
describe("Survie, puis élimination simple tronquée, puis double élimination (trois phases)", () => {
  function plan(secondMatch: Match) {
    phases = [
      phase({ id: 41, position: 1, format: "SURVIVAL", qualifier_value: 3, state: "RUNNING", entrants: 8, qualifiers: 3 }),
      phase({ id: 42, position: 2, format: "SINGLE", qualifier_value: 2, entrants: 3, qualifiers: 2, max_rounds: 1 }),
      phase({ id: 43, position: 3, format: "DOUBLE", qualifier_value: 1, entrants: 2, qualifiers: 1 }),
    ];
    currentPhaseId = 41;
    seedFirstPhase(41);
    survivalPhaseDone([1, 2, 3, 4, 5, 6, 7, 8]);
    matches = [
      { phaseId: 42, bracket: "UPPER", round: 1, team1: 1, team2: null, winner: 1 },
      secondMatch,
      { phaseId: 43, bracket: "UPPER", round: 1, team1: 1, team2: 2, winner: 1 },
      { phaseId: 43, bracket: "GRAND", round: 1, team1: 1, team2: 2, winner: 2 },
    ];
  }

  it("qualifie l'exemptée et la gagnante, et range la battue juste derrière", async () => {
    plan({ phaseId: 42, bracket: "UPPER", round: 1, team1: 2, team2: 3, winner: 2 });

    await reconcilePhases(TOURNAMENT_ID, conn());

    // Battue sur 0 V – 1 D, l'équipe 3 est 3ᵉ de la phase — et non derrière les
    // cinq sorties de Survie, toutes à 0 V – 0 D dans ce tableau.
    expect(savedResults(42)).toEqual([
      { teamId: 1, rank: 1, qualified: true },
      { teamId: 2, rank: 2, qualified: true },
      { teamId: 3, rank: 3, qualified: false },
    ]);
    expect(insertedTeams(43)).toEqual([1, 2]);
    expect(Object.fromEntries(finalRanks())).toEqual({
      2: 1, 1: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8,
    });
  });

  describe("quand l'autre rencontre se clôt sur un double forfait", () => {
    const doubleForfeit: Match = {
      phaseId: 42, bracket: "UPPER", round: 1, team1: 2, team2: 3, winner: null, doubleForfeit: true,
    };

    it("ne qualifie aucune équipe sortie en Survie à la place laissée libre", async () => {
      plan(doubleForfeit);

      await reconcilePhases(TOURNAMENT_ID, conn());

      // Cible de 2 : la seconde place revient à une équipe du double forfait,
      // qui n'est jamais qualifiée. Elle n'est pas repêchée — et surtout pas par
      // une sortie de Survie, sans match dans ce tableau.
      expect(savedResults(42)).toEqual([
        { teamId: 1, rank: 1, qualified: true },
        { teamId: 2, rank: 3, qualified: false },
        { teamId: 3, rank: 4, qualified: false },
      ]);
      // Une seule qualifiée : la finale n'a plus lieu d'être, le tournoi se clôt.
      expect(insertedTeams(43)).toEqual([]);
      expect(phases.find((p) => p.id === 43)?.state).toBe("SKIPPED");
      expect(tournamentState).toBe("FINISHED");
      expect(finalRanks().get(1)).toBe(1);
    });

    it("écarte encore une équipe étrangère à la phase que le classement lui rendrait", async () => {
      // Seconde garde : même si le classement du tableau ramenait les sorties de
      // Survie, la qualification ne compte que les équipes de la phase.
      looseRest = true;
      plan(doubleForfeit);

      await reconcilePhases(TOURNAMENT_ID, conn());

      expect(savedResults(42).map((r) => r.teamId)).toEqual([1, 2, 3]);
      expect(phases.find((p) => p.id === 43)?.state).toBe("SKIPPED");
    });
  });
});

describe("Ronde suisse, puis finale à demi-finale en double forfait (deux phases)", () => {
  beforeEach(() => {
    phases = [
      phase({ id: 31, position: 1, format: "SWISS", qualifier_value: 4, state: "RUNNING", entrants: 8, qualifiers: 4 }),
      phase({ id: 32, position: 2, format: "SINGLE", qualifier_value: 1, entrants: 4, qualifiers: 1 }),
    ];
    currentPhaseId = 31;
    seedFirstPhase(31);
    swissPhaseDone([1, 2, 3, 4, 5, 6, 7, 8]);
    matches = [
      { phaseId: 32, bracket: "UPPER", round: 1, team1: 1, team2: 4, winner: 1 },
      { phaseId: 32, bracket: "UPPER", round: 1, team1: 2, team2: 3, winner: null, doubleForfeit: true },
      // La finale se gagne par exemption : son adversaire n'a jamais été désignée.
      { phaseId: 32, bracket: "UPPER", round: 2, team1: 1, team2: null, winner: 1 },
    ];
  });

  it("garde aux seules équipes du tableau les places derrière la championne", async () => {
    await reconcilePhases(TOURNAMENT_ID, conn());

    const results = savedResults(32);
    expect(results.map((r) => r.teamId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(results[0]).toEqual({ teamId: 1, rank: 1, qualified: true });
    // 2ᵉ place vacante (finale sans adversaire, plateau marqué par un double
    // forfait) : les trois battues se suivent à partir du rang 3.
    expect(results.slice(1).map((r) => r.rank)).toEqual([3, 4, 5]);
  });

  it("place les sorties de la Ronde suisse derrière tout le tableau final", async () => {
    await reconcilePhases(TOURNAMENT_ID, conn());

    const ranks = finalRanks();
    const finalists = [1, 2, 3, 4].map((teamId) => ranks.get(teamId) ?? 0);
    const swissExits = [5, 6, 7, 8].map((teamId) => ranks.get(teamId) ?? 0);
    expect(ranks.get(1)).toBe(1);
    expect(Math.max(...finalists)).toBeLessThan(Math.min(...swissExits));
    expect(swissExits).toEqual([6, 7, 8, 9]);
  });
});
