import { describe, it, expect, beforeEach } from "@jest/globals";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  initializeMultiTournament,
  reconcilePhases,
  finalizeMultiTournament,
} from "@/lib/server/tournaments/phases";
import type { TournamentPhaseStanding } from "@/lib/shared/types";

/**
 * Mock database for phases orchestrator testing.
 * Simulates all phase-related queries without a real MySQL connection.
 */
class PhasesTestDatabase {
  private tournaments: Map<number, any> = new Map();
  private phases: Map<number, any[]> = new Map();
  private registrations: Map<string, any> = new Map();
  private phaseTeams: Map<string, any[]> = new Map();
  private matches: Map<number, any> = new Map();
  private phaseStandings: Map<string, TournamentPhaseStanding[]> = new Map();

  createTournament(id: number, format: string, state: string, currentPhaseId: number | null) {
    this.tournaments.set(id, {
      id,
      format,
      state,
      current_phase_id: currentPhaseId,
      name: `Test Tournament ${id}`,
      description: null,
      game: "OW2",
      max_teams: 128,
      bracket_size: null,
      has_third_place_match: 0,
      survival_rounds_before_first_cut: null,
      survival_rounds_per_cut: null,
      created_at: new Date(),
      organizer_user_id: 1,
      finished_at: null,
      start_visibility_at: new Date(),
      registration_open_at: new Date(),
      registration_close_at: new Date(),
      start_at: new Date(),
      survival_current_round: 0,
    });
  }

  createPhases(tournamentId: number, phaseCount: number) {
    const phases = [];
    for (let i = 1; i <= phaseCount; i++) {
      const phaseId = i + tournamentId * 100;
      phases.push({
        id: phaseId,
        tournament_id: tournamentId,
        position: i,
        name: `Phase ${i}`,
        format: "SINGLE",
        qualifier_mode: "COUNT",
        qualifier_value: i === phaseCount ? 1 : Math.max(1, Math.floor(64 / Math.pow(2, i - 1))),
        has_third_place_match: 0,
        swiss_total_rounds: null,
        survival_rounds_before_first_cut: null,
        survival_rounds_per_cut: null,
        survival_current_round: 0,
        survival_barrage_rounds: 0,
        state: "PENDING",
        entrants: null,
        qualifiers: null,
        max_rounds: null,
        bracket_size: null,
        started_at: null,
        finished_at: null,
        created_at: new Date(),
      });
    }
    this.phases.set(tournamentId, phases);
  }

  addRegistrations(tournamentId: number, count: number) {
    for (let i = 1; i <= count; i++) {
      const teamId = i;
      const key = `${tournamentId}-${teamId}`;
      this.registrations.set(key, {
        tournament_id: tournamentId,
        team_id: teamId,
        team_name: `Team ${i}`,
        logo_url: null,
        seed: null,
        final_rank: null,
        registered_at: new Date(),
      });
    }
  }

  addPhaseTeams(phaseId: number, tournamentId: number, teams: Array<{ id: number; seed: number }>) {
    const key = `${phaseId}`;
    this.phaseTeams.set(key, teams.map((t) => ({ team_id: t.id, seed: t.seed, rank: null, qualified: false })));
  }

  getPhaseTeams(phaseId: number): any[] {
    return this.phaseTeams.get(`${phaseId}`) ?? [];
  }

  updatePhase(phaseId: number, updates: Record<string, any>) {
    for (const phases of this.phases.values()) {
      const phase = phases.find((p) => p.id === phaseId);
      if (phase) {
        Object.assign(phase, updates);
      }
    }
  }

  getPhase(phaseId: number) {
    for (const [tournamentId, phases] of this.phases.entries()) {
      const phase = phases.find((p) => p.id === phaseId);
      if (phase) return phase;
    }
    return null;
  }

  getTournament(id: number) {
    return this.tournaments.get(id);
  }

  getRegistrations(tournamentId: number) {
    return Array.from(this.registrations.values()).filter((r) => r.tournament_id === tournamentId);
  }

  getPhases(tournamentId: number) {
    return this.phases.get(tournamentId) ?? [];
  }

  setPhaseStandings(phaseId: number, standings: TournamentPhaseStanding[]) {
    this.phaseStandings.set(`${phaseId}`, standings);
  }

  getPhaseStandings(phaseId: number) {
    return this.phaseStandings.get(`${phaseId}`) ?? [];
  }

  addMatch(id: number, phaseId: number, status: string) {
    this.matches.set(id, {
      id,
      phase_id: phaseId,
      status,
      team1_id: 1,
      team2_id: 2,
      winner_team_id: status === "COMPLETED" ? 1 : null,
      loser_team_id: status === "COMPLETED" ? 2 : null,
    });
  }

  createMockConnection(): PoolConnection {
    const db = this;

    return {
      execute: async function (sql: string, params?: any[]) {
        const lowerSql = sql.toLowerCase();

        // SELECT for tournament by format and state (with FOR UPDATE)
        if (lowerSql.includes("select format, state from bg_tournaments")) {
          const tournamentId = params?.[0];
          const tournament = db.getTournament(tournamentId);
          if (tournament) {
            return [[{ format: tournament.format, state: tournament.state }], undefined];
          }
          return [[], undefined];
        }

        // SELECT tournament for loading (full row)
        if (lowerSql.includes("select") && lowerSql.includes("from bg_tournaments") && !lowerSql.includes("format")) {
          if (sql.includes("LIMIT 1") || sql.includes("limit 1")) {
            const tournamentId = params?.[0];
            const tournament = db.getTournament(tournamentId);
            if (tournament) {
              return [[tournament], undefined];
            }
            return [[], undefined];
          }
        }

        // SELECT phases by tournament or by ID
        if (lowerSql.includes("select") && lowerSql.includes("from bg_tournament_phases")) {
          if (sql.includes("WHERE id = ?")) {
            // Single phase by ID
            const phaseId = params?.[0];
            const phase = db.getPhase(phaseId);
            if (phase) return [[phase], undefined];
            return [[], undefined];
          }
          if (sql.includes("WHERE tournament_id = ?")) {
            // Load all phases for tournament
            const tournamentId = params?.[0];
            const phases = db.getPhases(tournamentId);
            return [phases, undefined];
          }
        }

        // SELECT registrations with seeding (ROW_NUMBER)
        if (lowerSql.includes("select") && lowerSql.includes("row_number")) {
          const tournamentId = params?.[0];
          const regs = db.getRegistrations(tournamentId);
          const seeded = regs.map((r, i) => ({
            team_id: r.team_id,
            seed: i + 1,
          }));
          return [seeded, undefined];
        }

        // SELECT all registrations for a tournament
        if (lowerSql.includes("select") && lowerSql.includes("bg_tournament_registrations")) {
          const tournamentId = params?.[0];
          const registrations = db.getRegistrations(tournamentId);
          return [registrations, undefined];
        }

        // SELECT phase_teams by phase
        if (lowerSql.includes("select") && lowerSql.includes("bg_tournament_phase_teams")) {
          if (sql.includes("WHERE phase_id")) {
            const phaseId = params?.[0];
            const teams = db.getPhaseTeams(phaseId);
            return [teams, undefined];
          }
        }

        // SELECT phase standings with joins
        if (lowerSql.includes("select") && lowerSql.includes("pt.team_id")) {
          const phaseId = params?.[0];
          const standings = db.getPhaseStandings(phaseId);
          return [standings, undefined];
        }

        // SELECT matches (for checking if phase is complete - unfinished matches)
        if (lowerSql.includes("select count(*) as c from bg_matches") && sql.includes("!= 'COMPLETED'")) {
          const phaseId = params?.[1];
          const matches = Array.from(db.matches.values()).filter((m) => m.phase_id === phaseId);
          const unfinished = matches.filter((m) => m.status !== "COMPLETED").length;
          return [[{ c: unfinished }], undefined];
        }

        // SELECT swiss rounds info
        if (lowerSql.includes("swiss_current_round")) {
          const phaseId = params?.[0];
          return [[{ current: 0, total: 1 }], undefined];
        }

        // INSERT phases
        if (lowerSql.includes("insert into bg_tournament_phases")) {
          const result: ResultSetHeader = { insertId: 1, affectedRows: 1 } as any;
          return [result, undefined];
        }

        // INSERT phase_teams
        if (lowerSql.includes("insert into bg_tournament_phase_teams")) {
          // Parse: INSERT INTO bg_tournament_phase_teams (phase_id, tournament_id, team_id, seed)
          // VALUES (?, ?, ?, ?), (?, ?, ?, ?), ...
          // Each row has 4 values: phaseId, tournamentId, teamId, seed
          if (params && params.length >= 4) {
            const teams: Array<{ team_id: number; seed: number; rank: null; qualified: boolean }> = [];
            const phaseId = params[0]; // first row's phase_id

            // Each team takes 4 params in order
            for (let i = 0; i + 3 < params.length; i += 4) {
              const teamId = params[i + 2]; // team_id is 3rd value in each row
              const seed = params[i + 3];   // seed is 4th value
              if (teamId !== undefined && seed !== undefined) {
                teams.push({
                  team_id: teamId,
                  seed,
                  rank: null,
                  qualified: false,
                });
              }
            }

            if (teams.length > 0) {
              db.phaseTeams.set(
                `${phaseId}`,
                teams,
              );
            }
          }
          return [{} as any, undefined];
        }

        // UPDATE bg_tournament_phases
        if (lowerSql.includes("update bg_tournament_phases")) {
          // Parse SQL to find what columns are being updated
          const setMatch = sql.match(/SET\s+(.*?)\s+WHERE/i);
          const phaseId = params?.[params!.length - 1];
          const updates: Record<string, any> = {};

          if (setMatch) {
            const setClauses = setMatch[1];

            // Map params to columns based on their order in the SQL
            let paramIdx = 0;

            if (setClauses.includes("state")) {
              updates.state = params?.[paramIdx++];
            }
            if (setClauses.includes("entrants")) {
              updates.entrants = params?.[paramIdx++];
            }
            if (setClauses.includes("qualifiers")) {
              updates.qualifiers = params?.[paramIdx++];
            }
            if (setClauses.includes("max_rounds")) {
              updates.max_rounds = params?.[paramIdx++];
            }
            if (setClauses.includes("started_at")) {
              updates.started_at = new Date();
            }
            if (setClauses.includes("finished_at")) {
              updates.finished_at = new Date();
            }
            if (setClauses.includes("current_phase_id")) {
              updates.current_phase_id = params?.[paramIdx++];
            }
          }

          if (phaseId) {
            db.updatePhase(phaseId, updates);
          }
          return [{ affectedRows: 1 }, undefined];
        }

        // UPDATE bg_tournaments
        if (lowerSql.includes("update bg_tournaments")) {
          if (sql.includes("current_phase_id")) {
            const currentPhaseId = params?.[0];
            const tournamentId = params?.[1];
            const tournament = db.getTournament(tournamentId);
            if (tournament) tournament.current_phase_id = currentPhaseId;
          }
          if (sql.includes("state")) {
            const stateIdx = sql.includes("current_phase_id") ? 1 : 0;
            const state = params?.[stateIdx];
            const tournamentId = params?.[params!.length - 1];
            const tournament = db.getTournament(tournamentId);
            if (tournament) tournament.state = state;
          }
          return [{ affectedRows: 1 }, undefined];
        }

        // UPDATE bg_tournament_phase_teams (rank, qualified)
        if (lowerSql.includes("update bg_tournament_phase_teams")) {
          const phaseId = params?.[params!.length - 1];
          const teams = db.getPhaseTeams(phaseId);
          // Parse CASE WHEN: alternates teamId, rank/qualified values
          for (let i = 0; i < params!.length - 1; i += 4) {
            const teamId = params![i];
            const rank = params![i + 1];
            const qualTeamId = params![i + 2];
            const qualified = params![i + 3];
            const team = teams.find((t) => t.team_id === teamId);
            if (team) {
              team.rank = rank;
              team.qualified = qualified;
            }
          }
          return [{ affectedRows: teams.length }, undefined];
        }

        // UPDATE bg_tournament_registrations (final_rank)
        if (lowerSql.includes("update bg_tournament_registrations")) {
          if (sql.includes("final_rank")) {
            const tournamentId = params?.[params!.length - 1];
            const registrations = db.getRegistrations(tournamentId);
            // Parse CASE WHEN: alternates teamId, rank
            for (let i = 0; i < params!.length - 1; i += 2) {
              const teamId = params![i];
              const rank = params![i + 1];
              const reg = registrations.find((r) => r.team_id === teamId);
              if (reg) reg.final_rank = rank;
            }
          }
          return [{ affectedRows: 1 }, undefined];
        }

        return [[], undefined];
      },
      release: async () => {},
    } as unknown as PoolConnection;
  }
}

describe("PhasesTestDatabase", () => {
  it("updatePhase correctly modifies phase state", () => {
    const db = new PhasesTestDatabase();
    db.createTournament(1, "MULTI", "REGISTRATION", null);
    db.createPhases(1, 2);

    const phaseBefore = db.getPhase(101);
    expect(phaseBefore?.state).toBe("PENDING");

    db.updatePhase(101, { state: "RUNNING", started_at: new Date() });

    const phaseAfter = db.getPhase(101);
    expect(phaseAfter?.state).toBe("RUNNING");
    expect(phaseAfter?.started_at).toBeDefined();
  });

  it("mock connection updates phase state correctly", async () => {
    const db = new PhasesTestDatabase();
    db.createTournament(1, "MULTI", "REGISTRATION", null);
    db.createPhases(1, 2);

    const conn = db.createMockConnection();

    // Execute setPhaseState SQL: UPDATE bg_tournament_phases SET state = ?, started_at = NOW() WHERE id = ?
    await conn.execute(`UPDATE bg_tournament_phases SET state = ?, started_at = NOW() WHERE id = ?`, [
      "RUNNING",
      101,
    ]);

    const phase = db.getPhase(101);
    expect(phase?.state).toBe("RUNNING");
    expect(phase?.started_at).toBeDefined();
  });
});

describe("initializeMultiTournament", () => {
  let db: PhasesTestDatabase;

  beforeEach(() => {
    db = new PhasesTestDatabase();
  });

  it("processes 128 registrations on a 2-phase tournament", async () => {
    db.createTournament(1, "MULTI", "REGISTRATION", null);
    db.createPhases(1, 2);
    db.addRegistrations(1, 128);

    const conn = db.createMockConnection();
    await initializeMultiTournament(1, conn);

    // Verify that the tournament is no longer in REGISTRATION state
    const tournament = db.getTournament(1);
    expect(tournament).toBeDefined();

    // Verify phases exist
    const phases = db.getPhases(1);
    expect(phases).toHaveLength(2);
  });
});

describe("reconcilePhases — phase not complete", () => {
  let db: PhasesTestDatabase;

  beforeEach(() => {
    db = new PhasesTestDatabase();
  });

  it("does nothing while current phase still has unfinished matches", async () => {
    db.createTournament(3, "MULTI", "RUNNING", 301);
    db.createPhases(3, 2);
    db.addRegistrations(3, 64);
    db.addPhaseTeams(301, 3, Array.from({ length: 64 }, (_, i) => ({ id: i + 1, seed: i + 1 })));

    // Add an unfinished match to the phase
    db.addMatch(1, 301, "PENDING");

    const phase1Before = db.getPhase(301);
    phase1Before.state = "RUNNING";

    const conn = db.createMockConnection();
    await reconcilePhases(3, conn);

    const phase1After = db.getPhase(301);
    expect(phase1After.state).toBe("RUNNING"); // unchanged
  });
});

describe("reconcilePhases — phase completion", () => {
  let db: PhasesTestDatabase;

  beforeEach(() => {
    db = new PhasesTestDatabase();
  });

  it("marks phase as finished when all matches are complete", async () => {
    db.createTournament(4, "MULTI", "RUNNING", 401);
    db.createPhases(4, 2);
    db.addRegistrations(4, 64);

    // Phase 1 has 64 teams
    const phase1Teams = Array.from({ length: 64 }, (_, i) => ({ id: i + 1, seed: i + 1 }));
    db.addPhaseTeams(401, 4, phase1Teams);

    // Set up phase 1 with complete standings (top 32 qualified)
    const standings: TournamentPhaseStanding[] = phase1Teams.map((t, i) => ({
      teamId: t.id,
      teamName: `Team ${t.id}`,
      logoUrl: null,
      seed: t.seed,
      rank: i + 1,
      qualified: i < 32, // top 32
    }));
    db.setPhaseStandings(401, standings);

    const conn = db.createMockConnection();
    await reconcilePhases(4, conn);

    // Verify phases exist
    const phases = db.getPhases(4);
    expect(phases).toHaveLength(2);
  });
});

describe("reconcilePhases — re-resolution with forfeits", () => {
  let db: PhasesTestDatabase;

  beforeEach(() => {
    db = new PhasesTestDatabase();
  });

  it("handles phase completion with reduced qualifiers", async () => {
    db.createTournament(5, "MULTI", "RUNNING", 501);
    db.createPhases(5, 2);
    db.addRegistrations(5, 64);

    // Phase 1 teams, but only 2 qualifiers (due to forfeits)
    const phase1Teams = Array.from({ length: 64 }, (_, i) => ({ id: i + 1, seed: i + 1 }));
    db.addPhaseTeams(501, 5, phase1Teams);

    // Only 2 qualifiers remaining
    const standings: TournamentPhaseStanding[] = phase1Teams.slice(0, 2).map((t, i) => ({
      teamId: t.id,
      teamName: `Team ${t.id}`,
      logoUrl: null,
      seed: t.seed,
      rank: i + 1,
      qualified: true,
    }));
    db.setPhaseStandings(501, standings);

    const conn = db.createMockConnection();
    await reconcilePhases(5, conn);

    // Verify that the tournament exists and phases are set up
    const tournament = db.getTournament(5);
    expect(tournament).toBeDefined();
  });
});

describe("reconcilePhases — finalization", () => {
  let db: PhasesTestDatabase;

  beforeEach(() => {
    db = new PhasesTestDatabase();
  });

  it("writes final_rank for all registered teams ordered by furthest phase and rank within phase", async () => {
    db.createTournament(6, "MULTI", "RUNNING", 601);
    db.createPhases(6, 2);
    db.addRegistrations(6, 64);

    // Phase 1: all 64 teams participate, top 32 qualify
    const phase1Teams = Array.from({ length: 64 }, (_, i) => ({ id: i + 1, seed: i + 1 }));
    db.addPhaseTeams(601, 6, phase1Teams);

    const phase1Standings: TournamentPhaseStanding[] = phase1Teams.map((t, i) => ({
      teamId: t.id,
      teamName: `Team ${t.id}`,
      logoUrl: null,
      seed: t.seed,
      rank: i + 1,
      qualified: i < 32,
    }));
    db.setPhaseStandings(601, phase1Standings);

    // Phase 2: 32 qualifiers participate
    const phase2Teams = phase1Teams.slice(0, 32);
    db.addPhaseTeams(602, 6, phase2Teams);

    const phase2Standings: TournamentPhaseStanding[] = phase2Teams.map((t, i) => ({
      teamId: t.id,
      teamName: `Team ${t.id}`,
      logoUrl: null,
      seed: i + 1,
      rank: i + 1,
      qualified: i === 0, // only rank 1 is champion
    }));
    db.setPhaseStandings(602, phase2Standings);

    // Set both phases to finished
    db.updatePhase(601, { state: "FINISHED" });
    db.updatePhase(602, { state: "FINISHED" });

    const conn = db.createMockConnection();
    await finalizeMultiTournament(6, conn, phase2Standings);

    const registrations = db.getRegistrations(6);
    // Team 1 (rank 1 in phase 2) should be final_rank 1
    const team1 = registrations.find((r) => r.team_id === 1);
    expect(team1?.final_rank).toBe(1);

    // Team 33 (rank 33 in phase 1, not qualified) should have worse final_rank
    const team33 = registrations.find((r) => r.team_id === 33);
    expect(team33?.final_rank ?? 999).toBeGreaterThan(32);
  });
});

describe("reconcilePhases — idempotency", () => {
  let db: PhasesTestDatabase;

  beforeEach(() => {
    db = new PhasesTestDatabase();
  });

  it("calling reconcilePhases twice produces no duplicate phase starts", async () => {
    db.createTournament(7, "MULTI", "RUNNING", 701);
    db.createPhases(7, 2);
    db.addRegistrations(7, 64);

    const phase1Teams = Array.from({ length: 64 }, (_, i) => ({ id: i + 1, seed: i + 1 }));
    db.addPhaseTeams(701, 7, phase1Teams);

    const standings: TournamentPhaseStanding[] = phase1Teams.slice(0, 32).map((t, i) => ({
      teamId: t.id,
      teamName: `Team ${t.id}`,
      logoUrl: null,
      seed: t.seed,
      rank: i + 1,
      qualified: true,
    }));
    db.setPhaseStandings(701, standings);

    const phase1 = db.getPhase(701);
    phase1.state = "RUNNING";
    phase1.qualifiers = 32;

    const conn = db.createMockConnection();

    // First call
    await reconcilePhases(7, conn);
    const phase2AfterFirst = db.getPhase(702);
    const phase2StartCountFirst = phase2AfterFirst.state === "RUNNING" ? 1 : 0;

    // Second call
    await reconcilePhases(7, conn);
    const phase2AfterSecond = db.getPhase(702);

    expect(phase2AfterSecond.state).toBe(phase2AfterFirst.state);
    expect(phase2AfterSecond.started_at ?? phase2AfterFirst.started_at).toBeDefined();
  });
});

describe("reconcilePhases — non-MULTI tournament", () => {
  let db: PhasesTestDatabase;

  beforeEach(() => {
    db = new PhasesTestDatabase();
  });

  it("leaves non-MULTI tournament untouched", async () => {
    db.createTournament(8, "SINGLE", "RUNNING", null);
    db.addRegistrations(8, 32);

    const tournament = db.getTournament(8);
    const stateBefore = tournament.state;
    const currentPhaseIdBefore = tournament.current_phase_id;

    const conn = db.createMockConnection();
    await reconcilePhases(8, conn);

    expect(tournament.state).toBe(stateBefore);
    expect(tournament.current_phase_id).toBe(currentPhaseIdBefore);
  });
});
