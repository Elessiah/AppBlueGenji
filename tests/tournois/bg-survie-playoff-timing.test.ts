import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");

import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie";
import { createMatch } from "@/lib/server/tournaments/repository";

/**
 * La bascule en play-offs attend la **fin de la manche**.
 *
 * Un seul score reporté peut faire tomber l'effectif actif sur
 * `endurance_playoff_size` alors que les autres rencontres de la manche sont
 * encore `READY` — un 3-0 retirant trois points d'un coup, plusieurs équipes
 * proches de zéro sortent ensemble. Le contrôle d'achèvement précédait
 * l'appariement de la manche suivante mais **pas** la bascule : l'arbre partait
 * sur-le-champ, et les matchs restants ne se refermaient jamais,
 * `reconcileEndurance` repartant ensuite par la branche `playoffsStarted`.
 */

type Row = Record<string, unknown>;

const TOURNAMENT_ID = 5;

function tournamentRow(overrides: Row = {}): Row {
  return {
    format: "BG_SURVIE",
    state: "RUNNING",
    match_format_type: null,
    match_format_value: null,
    endurance_start_points: 3,
    endurance_win_delta: 1,
    endurance_loss_delta: 1,
    endurance_playoff_size: 8,
    endurance_current_round: 1,
    endurance_playoffs_started: 0,
    has_third_place_match: 0,
    ...overrides,
  };
}

function standingRow(teamId: number): Row {
  return {
    team_id: teamId,
    seed: teamId,
    points: 3,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminated_round: null,
    rank: teamId,
  };
}

/** Manche 1 : cinq rencontres, dont `completed` déjà jouées en 3-0. */
function roundOneOutcomes(completed: number): Row[] {
  const teams = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const outcomes: Row[] = [];
  for (let index = 0; index < 5; index += 1) {
    const team1 = teams[index * 2];
    const team2 = teams[index * 2 + 1];
    const done = index < completed;
    outcomes.push({
      round_number: 1,
      status: done ? "COMPLETED" : "READY",
      team1_id: team1,
      team2_id: team2,
      team1_score: done ? 3 : null,
      team2_score: done ? 0 : null,
      winner_team_id: done ? team1 : null,
      loser_team_id: done ? team2 : null,
      forfeit_team_id: null,
    });
  }
  return outcomes;
}

/**
 * Connexion mockée qui répond **d'après la requête** et non d'après son rang :
 * `persistStandings` en émet une par équipe, et un enchaînement positionnel
 * casserait au moindre changement d'ordre.
 */
function makeConn(options: { completed: number; matchesInRound?: number }) {
  const outcomes = roundOneOutcomes(options.completed);
  const total = options.matchesInRound ?? 5;

  const execute = jest.fn(async (sql: unknown) => {
    const query = String(sql);

    if (query.includes("FROM bg_tournaments WHERE id = ?")) return [[tournamentRow()]];
    if (query.includes("FROM bg_endurance_standings") && query.includes("status = 'FORFEIT'")) {
      return [[]];
    }
    if (query.includes("FROM bg_endurance_standings") && query.includes("ORDER BY `rank`")) {
      return [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(standingRow)];
    }
    if (query.includes("SELECT round_number, status")) return [outcomes];
    if (query.includes("SELECT COUNT(*) AS c FROM bg_matches")) {
      // `roundHasScoreInput` : une manche entamée n'est pas réappariée.
      return [[{ c: options.completed }]];
    }
    if (query.includes("SELECT COUNT(*) AS total")) {
      return [[{ total, done: options.completed }]];
    }
    if (query.includes("SELECT team1_id, team2_id FROM bg_matches")) {
      return [outcomes.map((row) => ({ team1_id: row.team1_id, team2_id: row.team2_id }))];
    }
    return [[]];
  });

  return { execute } as never as Parameters<typeof reconcileEndurance>[1] & {
    execute: jest.Mock;
  };
}

/** Le tournoi a-t-il basculé en play-offs ? */
function playoffsStarted(conn: { execute: jest.Mock }): boolean {
  return conn.execute.mock.calls.some(([sql]) =>
    String(sql).includes("endurance_playoffs_started = 1"),
  );
}

describe("reconcileEndurance — bascule en play-offs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createMatch as jest.Mock).mockResolvedValue(99 as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("n'ouvre pas l'arbre tant que la manche courante n'est pas finie", async () => {
    // Deux rencontres jouées en 3-0 : deux équipes à 0 point, donc huit encore
    // actives — la cible est atteinte, mais trois matchs restent à jouer.
    const conn = makeConn({ completed: 2 });

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(playoffsStarted(conn)).toBe(false);
    expect(createMatch).not.toHaveBeenCalled();
  });

  it("ouvre l'arbre dès que la manche est complète", async () => {
    const conn = makeConn({ completed: 5 });

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(playoffsStarted(conn)).toBe(true);
  });

  it("n'apparie pas non plus la manche suivante au milieu d'une manche", async () => {
    // Effectif entier conservé (aucune élimination) : la qualification n'est pas
    // finie, et l'appariement doit malgré tout attendre la fin de la manche.
    const conn = makeConn({ completed: 0, matchesInRound: 5 });

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(createMatch).not.toHaveBeenCalled();
    expect(playoffsStarted(conn)).toBe(false);
  });
});
