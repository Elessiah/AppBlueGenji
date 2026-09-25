import { describe, expect, it, jest } from "@jest/globals";
import { loadCardSummaries } from "@/lib/server/tournaments/list-summary";
import type { TournamentCard } from "@/lib/shared/types";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { tournamentCard } from "../../helpers/tournament-card";

/**
 * Résumé des cartes de la liste, lu **par lots** : quelques requêtes pour toute
 * la liste, jamais une par carte, et les matchs seulement comptés.
 */

type Rows = Record<string, unknown[]>;

/** Base factice qui répond selon la table interrogée. */
function database(rows: Rows) {
  const execute = jest.fn<SqlQuery>(async (sql: string) => {
    for (const [needle, result] of Object.entries(rows)) {
      if (sql.includes(needle)) return [result, undefined];
    }
    return [[], undefined];
  });
  return { execute, pool: fakePool({ execute }) };
}

const sqlOf = (execute: jest.Mock<SqlQuery>) => execute.mock.calls.map(([sql]) => String(sql));

function card(overrides: Partial<TournamentCard>): TournamentCard {
  return tournamentCard(overrides);
}

describe("loadCardSummaries", () => {
  it("n'interroge rien quand aucune carte n'est en cours ni terminée", async () => {
    const { execute, pool } = database({});
    const summaries = await loadCardSummaries(pool, [
      card({ id: 1, state: "UPCOMING" }),
      card({ id: 2, state: "REGISTRATION" }),
    ]);

    expect(execute).not.toHaveBeenCalled();
    expect(summaries.size).toBe(0);
  });

  it("nomme le vainqueur de chaque tournoi terminé, en une requête", async () => {
    const { execute, pool } = database({
      bg_tournament_registrations: [
        { tournament_id: 1, team_id: 10, team_name: "Alpha", final_rank: 1 },
        { tournament_id: 2, team_id: 20, team_name: "Bravo", final_rank: 1 },
        { tournament_id: 2, team_id: 21, team_name: "Charlie", final_rank: 1 },
      ],
    });

    const summaries = await loadCardSummaries(pool, [
      card({ id: 1, state: "FINISHED" }),
      card({ id: 2, state: "FINISHED" }),
      card({ id: 3, state: "FINISHED" }),
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/final_rank = 1 AND r\.tournament_id IN \(\?, \?, \?\)/);
    expect(params).toEqual([1, 2, 3]);

    expect(summaries.get(1)).toEqual({ champion: { teamId: 10, name: "Alpha" } });
    // Deux premiers ex æquo : personne n'est nommé.
    expect(summaries.get(2)).toEqual({ champion: null });
    // Aucun premier en base : personne non plus.
    expect(summaries.get(3)).toEqual({ champion: null });
  });

  it("mesure les tournois en cours sur des matchs comptés, jamais lus un à un", async () => {
    const { execute, pool } = database({
      "FROM bg_tournaments": [
        { id: 1, swiss_total_rounds: null, swiss_current_round: 0, current_phase_id: null },
        { id: 2, swiss_total_rounds: 4, swiss_current_round: 2, current_phase_id: null },
      ],
      "FROM bg_matches": [
        // `SUM` rend une chaîne sous mysql2 : elle doit être relue en nombre.
        { tournament_id: 1, phase_id: 0, round_number: 1, total: 4, completed: "3" },
        { tournament_id: 2, phase_id: 0, round_number: 1, total: 2, completed: "2" },
        { tournament_id: 2, phase_id: 0, round_number: 2, total: 2, completed: null },
      ],
    });

    const summaries = await loadCardSummaries(pool, [
      card({ id: 1, state: "RUNNING", format: "SINGLE" }),
      card({ id: 2, state: "RUNNING", format: "SWISS" }),
    ]);

    const matchSql = sqlOf(execute).find((sql) => sql.includes("FROM bg_matches"));
    expect(matchSql).toMatch(/COUNT\(\*\) AS total/);
    expect(matchSql).toMatch(/GROUP BY tournament_id, phase_id, round_number/);

    expect(summaries.get(1)?.runningProgress).toBeCloseTo(3 / 4);
    expect(summaries.get(2)?.runningProgress).toBeCloseTo(1 / 4);
  });

  it("ne lit que les tables utiles à chaque format", async () => {
    const { execute, pool } = database({
      "FROM bg_tournaments": [
        { id: 1, swiss_total_rounds: null, swiss_current_round: 0, current_phase_id: null },
        { id: 2, swiss_total_rounds: null, swiss_current_round: 0, current_phase_id: null },
      ],
      bg_survival_standings: [
        { tournament_id: 1, status: "ACTIVE" },
        { tournament_id: 1, status: "ELIMINATED" },
        { tournament_id: 1, status: "ACTIVE" },
      ],
      bg_endurance_standings: [
        { tournament_id: 2, status: "ACTIVE" },
        { tournament_id: 2, status: "OUT_OF_CONTENTION" },
      ],
    });

    const summaries = await loadCardSummaries(pool, [
      card({ id: 1, state: "RUNNING", format: "SURVIVAL" }),
      card({ id: 2, state: "RUNNING", format: "BG_SURVIE" }),
    ]);

    const sql = sqlOf(execute);
    // Survie et BG Survie se mesurent à leurs éliminations : aucun match lu.
    expect(sql.some((query) => query.includes("FROM bg_matches"))).toBe(false);
    expect(sql.some((query) => query.includes("bg_tournament_phases"))).toBe(false);
    expect(sql.find((query) => query.includes("bg_survival_standings"))).toMatch(/phase_id = 0/);

    expect(summaries.get(1)?.runningProgress).toBeCloseTo(1 / 2);
    expect(summaries.get(2)?.runningProgress).toBe(1);
  });

  it("mesure un multi-phases sur ses phases et sa phase courante", async () => {
    const { pool } = database({
      "FROM bg_tournaments": [
        { id: 7, swiss_total_rounds: null, swiss_current_round: 0, current_phase_id: 71 },
      ],
      "FROM bg_matches": [
        { tournament_id: 7, phase_id: 70, round_number: 1, total: 4, completed: "4" },
        { tournament_id: 7, phase_id: 71, round_number: 1, total: 2, completed: "0" },
      ],
      bg_tournament_phases: [
        { id: 70, tournament_id: 7, state: "FINISHED", format: "SINGLE", swiss_total_rounds: null },
        { id: 71, tournament_id: 7, state: "RUNNING", format: "SINGLE", swiss_total_rounds: null },
      ],
    });

    const summaries = await loadCardSummaries(pool, [
      card({ id: 7, state: "RUNNING", format: "MULTI" }),
    ]);

    expect(summaries.get(7)?.runningProgress).toBeCloseTo(1 / 2);
  });

  it("rend null pour un tournoi en cours dont rien ne situe le déroulement", async () => {
    const { pool } = database({
      "FROM bg_tournaments": [
        { id: 1, swiss_total_rounds: null, swiss_current_round: 0, current_phase_id: null },
      ],
    });

    const summaries = await loadCardSummaries(pool, [
      card({ id: 1, state: "RUNNING", format: "SINGLE" }),
    ]);

    expect(summaries.get(1)).toEqual({ runningProgress: null });
  });

  it("propage une panne de la base (c'est la liste qui décide de s'en passer)", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("boom"));
    await expect(
      loadCardSummaries(fakePool({ execute }), [card({ id: 1, state: "FINISHED" })]),
    ).rejects.toThrow("boom");
  });
});
