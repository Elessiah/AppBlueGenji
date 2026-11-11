import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { loadSwissMeta } from "@/lib/server/tournaments/swiss";
import { loadSurvivalMeta } from "@/lib/server/tournaments/survival";
import { fakeConnection, type SqlQuery } from "../helpers/sql-double";

/**
 * Régression : la requête du classement suisse porte deux placeholders
 * (`tournament_id` et `phase_id`) mais ne recevait qu'un paramètre. MySQL
 * répondait `ER_MALFORMED_PACKET`, et la fiche de tout tournoi en ronde suisse
 * restait bloquée sur « Chargement du tournoi… ».
 */
describe("loadSwissMeta — paramètres de la requête de classement", () => {
  const tournamentRow = {
    format: "SWISS",
    state: "RUNNING",
    swiss_total_rounds: 3,
    swiss_current_round: 1,
    swiss_points_win: 3,
    swiss_points_draw: 1,
    swiss_points_loss: 0,
    swiss_points_bye: 3,
    swiss_tiebreakers_json: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passe bien (tournamentId, phaseId) au classement", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[tournamentRow]]) // loadTournament
      .mockResolvedValueOnce([[]]); // classement
    const conn = { execute } as never;

    await loadSwissMeta(conn, 42);

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/FROM bg_swiss_standings/);
    expect(sql.match(/\?/g) ?? []).toHaveLength(params.length);
    expect(params).toEqual([42, 0]);
  });

  it("cible la phase demandée dans un tournoi multi-phases", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[tournamentRow]]) // phase
      .mockResolvedValueOnce([[tournamentRow]]) // réglages du tournoi
      .mockResolvedValueOnce([[]]); // classement
    const conn = { execute } as never;

    await loadSwissMeta(conn, 42, 7);

    const [, params] = execute.mock.calls[execute.mock.calls.length - 1] as [string, unknown[]];
    expect(params).toEqual([42, 7]);
  });

  it("renvoie null hors mode suisse", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ ...tournamentRow, format: "SINGLE" }]]);
    const conn = { execute } as never;

    await expect(loadSwissMeta(conn, 42)).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("loadSwissMeta_lastInputRoundGiven_skipsMaxQuery", async () => {
    const forfeitRow = { team_id: 5, team_name: "A", logo_url: null, seed: 1, points: 0, wins: 0, draws: 0,
      losses: 1, byes: 0, buchholz: 0, rank: 1, status: "FORFEIT", forfeit_round: 1 };
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[tournamentRow], undefined])
      .mockResolvedValueOnce([[forfeitRow], undefined]);

    const meta = await loadSwissMeta(fakeConnection({ execute }), 42, 0, 1);

    expect(meta?.cancellableForfeitTeamIds).toEqual([5]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("loadSurvivalMeta — borne de la fenêtre d'annulation", () => {
  it("loadSurvivalMeta_lastInputRoundGiven_skipsMaxQuery", async () => {
    const survivalRow = {
      format: "SURVIVAL",
      state: "RUNNING",
      survival_current_round: 2,
      survival_barrage_rounds: 0,
      survival_rounds_before_first_cut: 2,
      survival_rounds_per_cut: 1,
    };
    const forfeitRow = { team_id: 5, seed: 1, wins: 0, losses: 1, status: "FORFEIT", eliminated_round: 2,
      rank: 1, team_name: "A", logo_url: null };
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[survivalRow], undefined])
      .mockResolvedValueOnce([[forfeitRow], undefined]);

    const meta = await loadSurvivalMeta(fakeConnection({ execute }), 42, 0, 2);

    expect(meta?.cancellableForfeitTeamIds).toEqual([5]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
