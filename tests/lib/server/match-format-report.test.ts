import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/byes");

import { reportMatchScore } from "@/lib/server/tournaments/scoring";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";

/**
 * Connexion factice : elle reconnaît les requêtes de `reportMatchScore` à leur
 * fragment distinctif et renvoie un match prêt à être reporté. Objectif : voir
 * le garde-fou de format s'appliquer **avant** toute écriture.
 */
function fakeConnection(): { conn: PoolConnection; writes: string[] } {
  const writes: string[] = [];
  const match = {
    id: 10,
    tournament_id: 1,
    team1_id: 100,
    team2_id: 200,
    team1_report_score: null,
    team1_report_opponent_score: null,
    team1_reported_at: null,
    team2_report_score: null,
    team2_report_opponent_score: null,
    team2_reported_at: null,
    score_deadline_at: null,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    winner_team_id: null,
    status: "READY",
  };

  const conn = {
    execute: async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("UPDATE")) {
        writes.push(q);
        return [{ affectedRows: 1 }, []];
      }
      if (q.includes("FROM bg_matches")) return [[{ ...match }], []];
      return [[], []];
    },
  } as unknown as PoolConnection;

  return { conn, writes };
}

function mockTournament(matchFormat: { type: string; value: number } | null): void {
  (syncTournamentState as jest.Mock).mockResolvedValue({
    row: {
      id: 1,
      state: "RUNNING",
      match_format_type: matchFormat?.type ?? null,
      match_format_value: matchFormat?.value ?? null,
    },
    stateChanged: false,
  } as never);
}

describe("reportMatchScore — respect du format de match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 100 } as never);
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
  });

  it("accepte un 3-1 en BO5", async () => {
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes } = fakeConnection();

    await expect(reportMatchScore(conn, 1, 10, 42, 3, 1)).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });

  it("refuse un score au-dessus de l'objectif, sans rien écrire", async () => {
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes } = fakeConnection();

    await expect(reportMatchScore(conn, 1, 10, 42, 4, 1)).rejects.toThrow(
      "SCORE_EXCEEDS_MATCH_FORMAT",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse un score qui n'atteint pas l'objectif", async () => {
    mockTournament({ type: "FT", value: 3 });
    const { conn, writes } = fakeConnection();

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 1)).rejects.toThrow(
      "SCORE_BELOW_MATCH_FORMAT",
    );
    expect(writes).toHaveLength(0);
  });

  it("laisse passer n'importe quel score décisif en saisie libre", async () => {
    mockTournament(null);
    const { conn, writes } = fakeConnection();

    await expect(reportMatchScore(conn, 1, 10, 42, 7, 2)).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });

  it("refuse toujours l'égalité avant même de regarder le format", async () => {
    mockTournament({ type: "BO", value: 5 });
    const { conn } = fakeConnection();

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 2)).rejects.toThrow("DRAW_NOT_ALLOWED");
  });
});
