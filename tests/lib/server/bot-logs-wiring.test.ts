import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/state");

import { queueBotLog } from "@/lib/server/tournaments/bot-logs";
import { finalizeMatch, reportMatchScore } from "@/lib/server/tournaments/scoring";
import { finishTournament } from "@/lib/server/tournaments/repository";
import { finalizeUnderfilledTournament } from "@/lib/server/tournaments/finalization";
import { registerCurrentUserTeam, registerTeamById } from "@/lib/server/tournaments/registration";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { syncTournamentState } from "@/lib/server/tournaments/state";

/**
 * Les évènements sont réservés **au point de passage unique** de chaque fait —
 * pas chez l'appelant, où l'un des cinq moteurs finirait par l'oublier. Ces
 * tests tiennent ces points : ils échouent si une clôture, une inscription ou
 * une fin de match cesse d'y passer.
 */

type Queued = { kind: string } & Record<string, unknown>;

function queued(): Queued[] {
  return (queueBotLog as jest.Mock).mock.calls.map((call) => call[1] as Queued);
}

/** Connexion factice : `rows` répond aux SELECT, les UPDATE sont comptés. */
function fakeConnection(options: {
  rows?: (sql: string) => unknown[] | null;
  affectedRows?: number;
}): PoolConnection {
  return {
    execute: async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("UPDATE") || q.startsWith("INSERT")) {
        return [{ affectedRows: options.affectedRows ?? 1, insertId: 1 }, []];
      }
      return [options.rows?.(q) ?? [], []];
    },
  } as unknown as PoolConnection;
}

/** Ce que `syncTournamentState` rend au module testé. */
function mockTournamentState(row: Record<string, unknown>): void {
  (syncTournamentState as jest.Mock).mockResolvedValue({ row, stateChanged: false } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
});

describe("finishTournament", () => {
  it("réserve la clôture quand elle a bien eu lieu", async () => {
    await finishTournament(fakeConnection({ affectedRows: 1 }), 12);

    expect(queued()).toEqual([{ kind: "tournament_finished", tournamentId: 12 }]);
  });

  it("ne réserve rien sur un tournoi déjà clos", async () => {
    // `affectedRows: 0` = la clause `state <> 'FINISHED'` a filtré la ligne :
    // c'est le cas de l'arbitre qui corrige le score d'une archive et rejoue
    // toute la finalisation.
    await finishTournament(fakeConnection({ affectedRows: 0 }), 12);

    expect(queueBotLog).not.toHaveBeenCalled();
  });
});

describe("finalizeUnderfilledTournament", () => {
  it("réserve une ligne distincte pour un tournoi clos faute d'adversaires", async () => {
    const connection = fakeConnection({
      rows: (q) => (q.includes("bg_tournament_registrations") ? [{ team_id: 101 }] : []),
    });

    await expect(finalizeUnderfilledTournament(connection, 12)).resolves.toBe(true);
    expect(queued()).toEqual([{ kind: "tournament_underfilled", tournamentId: 12 }]);
  });

  it("ne réserve rien quand le tournoi a de quoi être joué", async () => {
    const connection = fakeConnection({
      rows: (q) =>
        q.includes("bg_tournament_registrations") ? [{ team_id: 101 }, { team_id: 102 }] : [],
    });

    await expect(finalizeUnderfilledTournament(connection, 12)).resolves.toBe(false);
    expect(queueBotLog).not.toHaveBeenCalled();
  });
});

describe("inscription", () => {
  const TOURNAMENT = { id: 12, state: "REGISTRATION", max_teams: 16, participant_type: "TEAM" };

  /** Base minimale : tournoi ouvert, aucune inscrite, équipe existante. */
  function registrationConnection(): PoolConnection {
    return fakeConnection({
      rows: (q) => {
        if (q.includes("COUNT(*)")) return [{ c: 0 }];
        if (q.includes("FROM bg_teams")) return [{ deleted_at: null }];
        if (q.includes("FROM bg_tournaments")) return [TOURNAMENT];
        return [];
      },
    });
  }

  beforeEach(() => {
    mockTournamentState(TOURNAMENT);
  });

  it("réserve une ligne d'inscription joueur", async () => {
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 101 } as never);

    await registerCurrentUserTeam(registrationConnection(), 12, 42);

    expect(queued()).toEqual([
      { kind: "registration", tournamentId: 12, teamId: 101, byStaff: false },
    ]);
  });

  it("marque l'inscription d'une équipe fantôme comme venant du staff", async () => {
    await registerTeamById(registrationConnection(), 12, 900);

    expect(queued()).toEqual([
      { kind: "registration", tournamentId: 12, teamId: 900, byStaff: true },
    ]);
  });

  it("ne réserve rien quand l'inscription est refusée", async () => {
    const connection = fakeConnection({
      rows: (q) => {
        if (q.includes("COUNT(*)")) return [{ c: 1 }]; // déjà inscrite
        if (q.includes("FROM bg_tournaments")) return [TOURNAMENT];
        return [];
      },
    });
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 101 } as never);

    await expect(registerCurrentUserTeam(connection, 12, 42)).rejects.toThrow("ALREADY_REGISTERED");
    expect(queueBotLog).not.toHaveBeenCalled();
  });
});

describe("finalizeMatch", () => {
  it("réserve le résultat de tout match tranché", async () => {
    await finalizeMatch(
      fakeConnection({}),
      12,
      {
        id: 31,
        team1_id: 101,
        team2_id: 102,
        next_winner_match_id: null,
        next_winner_slot: null,
        next_loser_match_id: null,
        next_loser_slot: null,
      },
      { team1Score: 2, team2Score: 1, winnerTeamId: 101, loserTeamId: 102 },
    );

    expect(queued()).toEqual([{ kind: "match_finished", matchId: 31 }]);
  });
});

describe("reportMatchScore", () => {
  const MATCH = {
    id: 31,
    tournament_id: 12,
    team1_id: 101,
    team2_id: 102,
    team1_report_score: null,
    team1_report_opponent_score: null,
    team2_report_score: null,
    team2_report_opponent_score: null,
    score_deadline_at: null,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    winner_team_id: null,
    status: "READY",
  };

  /**
   * @param opponentReport Report déjà posé par l'adversaire, `null` s'il n'a
   *   pas encore saisi. La seconde lecture du match (après écriture) le porte.
   */
  function reportConnection(opponentReport: { score: number; opponent: number } | null) {
    let matchReads = 0;
    return fakeConnection({
      rows: (q) => {
        if (q.includes("FROM bg_matches")) {
          matchReads += 1;
          if (matchReads === 1) {
            return [{ ...MATCH, team2_report_score: opponentReport?.score ?? null }];
          }
          return [
            {
              ...MATCH,
              team1_report_score: 2,
              team1_report_opponent_score: 1,
              team2_report_score: opponentReport?.score ?? null,
              team2_report_opponent_score: opponentReport?.opponent ?? null,
            },
          ];
        }
        return [];
      },
    });
  }

  beforeEach(() => {
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 101 } as never);
    mockTournamentState({
      id: 12,
      state: "RUNNING",
      participant_type: "TEAM",
      match_format_type: null,
      match_format_value: null,
    });
  });

  it("ne réserve rien sur un premier report : le match n'est pas tranché", async () => {
    await reportMatchScore(reportConnection(null), 12, 31, 42, 2, 1);

    expect(queueBotLog).not.toHaveBeenCalled();
  });

  it("réserve le résultat quand les deux reports concordent", async () => {
    await reportMatchScore(reportConnection({ score: 1, opponent: 2 }), 12, 31, 42, 2, 1);

    expect(queued()).toEqual([{ kind: "match_finished", matchId: 31 }]);
  });

  it("réserve un conflit quand les deux reports se contredisent", async () => {
    await reportMatchScore(reportConnection({ score: 2, opponent: 0 }), 12, 31, 42, 2, 1);

    expect(queued()).toEqual([{ kind: "score_conflict", matchId: 31 }]);
  });
});
