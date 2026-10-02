import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/repository");

import {
  finalizeTournamentIfDone,
  isEliminationPhaseComplete,
  rankEliminationPhase,
} from "@/lib/server/tournaments/finalization";
import { finishTournament, resetRegistrationRanks } from "@/lib/server/tournaments/repository";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

/**
 * Clôture d'un tableau à élimination (`finalization.ts`) : quand un plateau
 * est-il fini, et quel classement final en sort-il.
 *
 * Les règles de podium elles-mêmes vivent dans `lib/shared/double-forfeit.ts`
 * et y sont testées ; ici, c'est leur **branchement sur la base** qui est
 * éprouvé — quelle finale on lit selon le format, qui est exclu du reste du
 * classement, et ce qui est écrit, dans quel ordre, quand le tournoi se clôt.
 */

type Row = Record<string, unknown>;
type Route = { match: RegExp; rows: Row[] | (() => Row[]) };

let connection: ReturnType<typeof connectionMock>;
let routes: Route[];

/** Base simulée : chaque requête rend les lignes de la première route qui la reconnaît. */
beforeEach(() => {
  jest.clearAllMocks();
  routes = [];
  connection = connectionMock();
  connection.execute.mockImplementation(async (sql) => {
    const line = sql.replace(/\s+/g, " ").trim();
    const route = routes.find((r) => r.match.test(line));
    const rows = route ? (typeof route.rows === "function" ? route.rows() : route.rows) : [];
    return [rows, undefined];
  });
});

const conn = () => fakeConnection(connection);
function route(match: RegExp, rows: Route["rows"]): void {
  routes.push({ match, rows });
}
function sqlCalls(): { sql: string; params: unknown[] }[] {
  return connection.execute.mock.calls.map(([sql, params]) => ({
    sql: sql.replace(/\s+/g, " ").trim(),
    params: (params ?? []) as unknown[],
  }));
}

const final = (winner: number, loser: number, extra: Row = {}): Row => ({
  team1_id: winner,
  team2_id: loser,
  winner_team_id: winner,
  loser_team_id: loser,
  status: "COMPLETED",
  double_forfeit: 0,
  ...extra,
});
const UPPER_FINAL = /bracket = 'UPPER' ORDER BY round_number DESC/;
const THIRD_PLACE = /bracket = 'THIRD_PLACE'/;
const GRAND_FINAL = /bracket = 'GRAND' AND round_number = 1/;
const FORFEITED = /^SELECT team1_id AS team_id FROM bg_matches/;
const REST = /^SELECT r\.team_id,/;

describe("isEliminationPhaseComplete", () => {
  it("ne tient pas pour fini un tableau sans aucun match", async () => {
    route(/^SELECT COUNT\(\*\) AS c FROM bg_matches WHERE tournament_id = \? AND phase_id = \?$/, [{ c: 0 }]);

    await expect(isEliminationPhaseComplete(conn(), 5, 0)).resolves.toBe(false);
    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  it("tient pour fini un tableau dont plus aucun match n'attend de vainqueur", async () => {
    route(/AND winner_team_id IS NULL/, [{ c: "0" }]);
    route(/^SELECT COUNT/, [{ c: 7 }]);

    await expect(isEliminationPhaseComplete(conn(), 5, 3)).resolves.toBe(true);

    const unfinished = sqlCalls()[1];
    // Un double forfait est clos sans vainqueur : il ne retient pas le plateau.
    expect(unfinished.sql).toContain("AND NOT (status = 'COMPLETED' AND double_forfeit = 1)");
    expect(unfinished.params).toEqual([5, 3]);
  });

  it("attend un match encore à jouer", async () => {
    route(/AND winner_team_id IS NULL/, [{ c: 1 }]);
    route(/^SELECT COUNT/, [{ c: 7 }]);

    await expect(isEliminationPhaseComplete(conn(), 5, 0)).resolves.toBe(false);
  });
});

describe("rankEliminationPhase", () => {
  it("range la finale, puis le reste du tableau à la suite", async () => {
    route(UPPER_FINAL, [final(1, 2)]);
    route(REST, [{ team_id: 3 }, { team_id: "4" }]);

    const ranks = await rankEliminationPhase(conn(), 5, 0, "SINGLE", false);

    expect(ranks).toEqual([
      { teamId: 1, rank: 1, eliminatedByDoubleForfeit: false },
      { teamId: 2, rank: 2, eliminatedByDoubleForfeit: false },
      { teamId: 3, rank: 3, eliminatedByDoubleForfeit: false },
      { teamId: 4, rank: 4, eliminatedByDoubleForfeit: false },
    ]);
    expect(sqlCalls().some((c) => THIRD_PLACE.test(c.sql))).toBe(false);
    // Le reste exclut les deux finalistes déjà placés.
    const rest = sqlCalls().find((c) => REST.test(c.sql));
    expect(rest?.sql).toContain("AND r.team_id NOT IN (?,?)");
    expect(rest?.params).toEqual([0, 5, 1, 2]);
  });

  it("lit la petite finale quand le tableau en a une", async () => {
    route(UPPER_FINAL, [final(1, 2)]);
    route(THIRD_PLACE, [final(3, 4)]);
    route(REST, [{ team_id: 5 }]);

    const ranks = await rankEliminationPhase(conn(), 5, 0, "SINGLE", true);

    expect(ranks.map((r) => [r.teamId, r.rank])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
  });

  it("lit la grande finale en double élimination, et non le haut de tableau", async () => {
    route(GRAND_FINAL, [final(7, 8)]);
    route(UPPER_FINAL, [final(1, 2)]);

    const ranks = await rankEliminationPhase(conn(), 5, 2, "DOUBLE", true);

    expect(ranks.map((r) => r.teamId)).toEqual([7, 8]);
    expect(sqlCalls().some((c) => UPPER_FINAL.test(c.sql) || THIRD_PLACE.test(c.sql))).toBe(false);
  });

  it("ne sacre personne sur une finale close par double forfait", async () => {
    route(UPPER_FINAL, [final(1, 2, { winner_team_id: null, loser_team_id: null, double_forfeit: 1 })]);
    route(FORFEITED, [{ team_id: 1 }, { team_id: 2 }]);
    route(REST, [{ team_id: 3 }]);

    const ranks = await rankEliminationPhase(conn(), 5, 0, "SINGLE", false);

    expect(ranks).toEqual([
      { teamId: 1, rank: 2, eliminatedByDoubleForfeit: true },
      { teamId: 2, rank: 2, eliminatedByDoubleForfeit: true },
      { teamId: 3, rank: 3, eliminatedByDoubleForfeit: false },
    ]);
  });

  it("marque l'équipe sortie par double forfait en cours de tableau", async () => {
    route(UPPER_FINAL, [final(1, 2)]);
    route(FORFEITED, [{ team_id: 6 }]);
    route(REST, [{ team_id: 6 }]);

    const ranks = await rankEliminationPhase(conn(), 5, 0, "SINGLE", false);

    expect(ranks.at(-1)).toEqual({ teamId: 6, rank: 3, eliminatedByDoubleForfeit: true });
  });

  it("range tout le plateau sur son bilan quand aucune finale ne désigne personne", async () => {
    route(REST, [{ team_id: 4 }, { team_id: 9 }]);

    const ranks = await rankEliminationPhase(conn(), 5, 0, "SINGLE", false);

    expect(ranks.map((r) => [r.teamId, r.rank])).toEqual([[4, 1], [9, 2]]);
    const rest = sqlCalls().find((c) => REST.test(c.sql));
    expect(rest?.sql).not.toContain("NOT IN");
    expect(rest?.params).toEqual([0, 5]);
  });
});

describe("finalizeTournamentIfDone", () => {
  it.each(["SURVIVAL", "SWISS", "MULTI", "BG_SURVIE"])(
    "laisse le mode %s piloter sa propre clôture",
    async (format) => {
      route(/^SELECT format FROM bg_tournaments/, [{ format }]);

      await finalizeTournamentIfDone(conn(), 5);

      expect(connection.execute).toHaveBeenCalledTimes(1);
      expect(finishTournament).not.toHaveBeenCalled();
    },
  );

  it("ne clôt pas un tableau encore en cours", async () => {
    route(/^SELECT format FROM bg_tournaments/, [{ format: "SINGLE" }]);
    route(/AND winner_team_id IS NULL/, [{ c: 2 }]);
    route(/^SELECT COUNT/, [{ c: 7 }]);

    await finalizeTournamentIfDone(conn(), 5);

    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("clôt un tableau fini puis écrit le classement final dans l'ordre", async () => {
    route(/^SELECT format, has_third_place_match/, [{ format: "SINGLE", has_third_place_match: 0 }]);
    route(/^SELECT format FROM bg_tournaments/, [{ format: "SINGLE" }]);
    route(/AND winner_team_id IS NULL/, [{ c: 0 }]);
    route(/^SELECT COUNT/, [{ c: 3 }]);
    route(UPPER_FINAL, [final(1, 2)]);
    route(REST, [{ team_id: 3 }]);

    await finalizeTournamentIfDone(conn(), 5);

    expect(finishTournament).toHaveBeenCalledWith(expect.anything(), 5);
    expect(jest.mocked(resetRegistrationRanks).mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(finishTournament).mock.invocationCallOrder[0] ?? Infinity,
    );
    const writes = sqlCalls().filter((c) => c.sql.startsWith("UPDATE bg_tournament_registrations SET final_rank"));
    expect(writes.map((w) => w.params)).toEqual([
      [1, 5, 1],
      [2, 5, 2],
      [3, 5, 3],
    ]);
  });

  it("classe une double élimination sur sa grande finale", async () => {
    route(/^SELECT format, has_third_place_match/, [{ format: "DOUBLE", has_third_place_match: 1 }]);
    route(/^SELECT format FROM bg_tournaments/, [{ format: "DOUBLE" }]);
    route(/AND winner_team_id IS NULL/, [{ c: 0 }]);
    route(/^SELECT COUNT/, [{ c: 3 }]);
    route(GRAND_FINAL, [final(8, 7)]);

    await finalizeTournamentIfDone(conn(), 5);

    expect(sqlCalls().some((c) => GRAND_FINAL.test(c.sql))).toBe(true);
    const writes = sqlCalls().filter((c) => c.sql.startsWith("UPDATE bg_tournament_registrations SET final_rank"));
    expect(writes.map((w) => w.params)).toEqual([
      [1, 5, 8],
      [2, 5, 7],
    ]);
  });
});
