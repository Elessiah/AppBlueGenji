import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { loadSwissMeta } from "@/lib/server/tournaments/swiss";

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

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("passe bien (tournamentId, phaseId) au classement", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[tournamentRow]]) // loadTournament
      .mockResolvedValueOnce([[]]); // classement
    const conn = { execute } as never;

    await loadSwissMeta(conn, 42);

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/FROM bg_swiss_standings/);
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
    expect(params).toEqual([42, 0]);
  });

  it("cible la phase demandée dans un tournoi multi-phases", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[tournamentRow]]) // phase
      .mockResolvedValueOnce([[tournamentRow]]) // réglages du tournoi
      .mockResolvedValueOnce([[]]); // classement
    const conn = { execute } as never;

    await loadSwissMeta(conn, 42, 7);

    const [, params] = execute.mock.calls[execute.mock.calls.length - 1] as [string, unknown[]];
    expect(params).toEqual([42, 7]);
  });

  it("renvoie null hors mode suisse", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[{ ...tournamentRow, format: "SINGLE" }]]);
    const conn = { execute } as never;

    await expect(loadSwissMeta(conn, 42)).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
