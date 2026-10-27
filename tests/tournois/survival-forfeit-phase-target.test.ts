import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * `forfeitSurvivalTeam` dans une phase : la réconciliation revient à
 * `reconcilePhases` (l'appelant), seule à connaître la cible de qualifiées.
 * Réconcilier ici avec la cible par défaut (1) coupait ou clôturait la phase
 * sur une cible fausse. Dans un tournoi simple, l'abandon réconcilie lui-même.
 */

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/match-maps");
jest.mock("@/lib/server/tournaments/departed-notices");

import { forfeitSurvivalTeam } from "@/lib/server/tournaments/survival";
import { finishTournament, forfeitMatchScores } from "@/lib/server/tournaments/repository";
import { type SqlQuery, fakeConnection } from "../helpers/sql-double";

let sqls: string[] = [];
let tournamentFormat = "SURVIVAL";
let tournamentState = "RUNNING";
let standingStatus: string | null = "ACTIVE";

const execute = jest.fn<SqlQuery>(async (sql) => {
  const text = sql.replace(/\s+/g, " ").trim();
  sqls.push(text);
  if (text.startsWith("SELECT format, state")) {
    return [
      [
        {
          format: tournamentFormat,
          state: tournamentState,
          survival_rounds_before_first_cut: 1,
          survival_rounds_per_cut: 1,
          survival_current_round: 2,
          survival_barrage_rounds: 0,
        },
      ],
      [],
    ];
  }
  if (text.startsWith("SELECT status FROM bg_survival_standings")) {
    return [standingStatus === null ? [] : [{ status: standingStatus }], []];
  }
  if (text.startsWith("SELECT id, team1_id, team2_id FROM bg_matches")) {
    return [[{ id: 900, team1_id: 3, team2_id: 4 }], []];
  }
  if (text.startsWith("SELECT")) return [[], []];
  return [{ affectedRows: 1 }, []];
});
const connection = fakeConnection({ execute });

const tournamentLoads = () => sqls.filter((sql) => sql.startsWith("SELECT format, state")).length;
const FORFEIT_WRITE = "UPDATE bg_survival_standings SET status = 'FORFEIT'";

beforeEach(() => {
  jest.clearAllMocks();
  sqls = [];
  tournamentFormat = "SURVIVAL";
  tournamentState = "RUNNING";
  standingStatus = "ACTIVE";
  jest.mocked(forfeitMatchScores).mockResolvedValue({ team1Score: 0, team2Score: 3 });
});

describe("forfeitSurvivalTeam — cible de la réconciliation", () => {
  it("dans une phase, s'arrête au statut FORFEIT sans réconcilier sur la cible par défaut", async () => {
    await forfeitSurvivalTeam(5, 3, connection, 22);

    expect(tournamentLoads()).toBe(1);
    expect(sqls[0]).toContain("FROM bg_tournament_phases WHERE id = ?");
    expect(sqls[sqls.length - 1]).toContain(FORFEIT_WRITE);
    expect(finishTournament).not.toHaveBeenCalled();
    // Le match ouvert est bien résolu en faveur de l'adversaire.
    expect(sqls.some((sql) => sql.startsWith("UPDATE bg_matches SET status = 'COMPLETED'"))).toBe(true);
  });

  it("dans un tournoi simple, réconcilie lui-même après l'abandon", async () => {
    await forfeitSurvivalTeam(5, 3, connection);

    const forfeitAt = sqls.findIndex((sql) => sql.startsWith(FORFEIT_WRITE));
    expect(forfeitAt).toBeGreaterThan(-1);
    expect(sqls.slice(forfeitAt + 1).some((sql) => sql.startsWith("SELECT format, state"))).toBe(true);
  });

  it("refuse toujours une équipe déjà sortie, phase ou non", async () => {
    standingStatus = "FORFEIT";
    await expect(forfeitSurvivalTeam(5, 3, connection, 22)).rejects.toThrow("TEAM_ALREADY_OUT");
    await expect(forfeitSurvivalTeam(5, 3, connection)).rejects.toThrow("TEAM_ALREADY_OUT");
    expect(sqls.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
  });

  it("refuse une phase qui n'est pas en Survie ou pas en cours", async () => {
    tournamentFormat = "SWISS";
    await expect(forfeitSurvivalTeam(5, 3, connection, 22)).rejects.toThrow("NOT_SURVIVAL");
    tournamentFormat = "SURVIVAL";
    tournamentState = "FINISHED";
    await expect(forfeitSurvivalTeam(5, 3, connection, 22)).rejects.toThrow("TOURNAMENT_NOT_RUNNING");
  });
});
