import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");

import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie";
import { reconcileSurvival } from "@/lib/server/tournaments/survival";
import { reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { createMatch, finishTournament } from "@/lib/server/tournaments/repository";

/**
 * Corriger le score de la **finale d'un tournoi terminé**.
 *
 * `adminResolveMatch` n'a aucune garde d'état, et c'est un choix : corriger une
 * archive doit rester possible, `finishTournament` prévoyant explicitement le
 * rejeu de sa finalisation (`state <> 'FINISHED'` en fait une opération à effet
 * unique). Mais les trois modes à classement — BlueGenji Survie, Survie, Ronde
 * suisse — sortaient en tête de leur réconciliation sur un tournoi `FINISHED` :
 * `winner_team_id` changeait bien en base, le podium et `final_rank` restaient
 * sur l'ancienne championne, et la page — qui rejoue toujours — contredisait le
 * palmarès stocké.
 *
 * Les trois se comportent désormais pareil, et c'est ce que ce fichier tient :
 * **le classement se rejoue, le tournoi ne se rouvre pas.** Aucune manche,
 * aucune ronde, aucun tour d'arbre n'est reposé sur un tournoi clos.
 */

type Row = Record<string, unknown>;

/** Connexion factice qui répond d'après le fragment de SQL reconnu. */
function makeConn(answers: [string, unknown][]) {
  const execute = jest.fn(async (sql: unknown) => {
    const query = String(sql).replace(/\s+/g, " ");
    const found = answers.find(([needle]) => query.includes(needle));
    return found ? found[1] : [[]];
  });
  return { execute } as never as Parameters<typeof reconcileEndurance>[1] & {
    execute: jest.Mock;
  };
}

/** Les rangs finaux écrits par la réconciliation, équipe vers rang. */
function writtenRanks(conn: { execute: jest.Mock }): Map<number, number> {
  const ranks = new Map<number, number>();
  for (const [sql, params] of conn.execute.mock.calls) {
    if (!String(sql).includes("bg_tournament_registrations SET final_rank")) continue;
    const values = (params ?? []) as unknown[];
    if (String(sql).includes("SET final_rank = ?")) {
      // Endurance : une écriture par équipe, (rang, tournoi, équipe).
      ranks.set(Number(values[2]), Number(values[0]));
      continue;
    }
    // Survie et suisse : un CASE team_id WHEN ? THEN ? par équipe, suivi du
    // tournoi et de la liste des équipes — seules les paires du CASE comptent.
    const pairs = (String(sql).match(/WHEN \? THEN \?/g) ?? []).length;
    for (let index = 0; index < pairs * 2; index += 2) {
      ranks.set(Number(values[index]), Number(values[index + 1]));
    }
  }
  return ranks;
}

/** Une manche, une ronde ou un tour a-t-il été reposé ? */
function posedAnything(conn: { execute: jest.Mock }): boolean {
  return (
    (createMatch as jest.Mock).mock.calls.length > 0 ||
    conn.execute.mock.calls.some(([sql]) => {
      const query = String(sql);
      return (
        query.includes("INSERT INTO bg_matches") ||
        query.includes("DELETE FROM bg_matches") ||
        query.includes("team1_id = ?, team2_id = ?, status = ?") ||
        query.includes("endurance_playoffs_started = 1")
      );
    })
  );
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe("reconcileEndurance sur un tournoi terminé", () => {
  function enduranceRow(overrides: Row = {}): Row {
    return {
      format: "BG_SURVIE",
      state: "FINISHED",
      match_format_type: null,
      match_format_value: null,
      endurance_start_points: 9,
      endurance_win_delta: 1,
      endurance_loss_delta: 1,
      endurance_playoff_size: 2,
      endurance_current_round: 1,
      endurance_playoffs_started: 1,
      has_third_place_match: 0,
      ...overrides,
    };
  }

  function standingRow(teamId: number, rank: number): Row {
    return {
      team_id: teamId,
      seed: teamId,
      points: 9,
      wins: 0,
      losses: 0,
      status: "ACTIVE",
      eliminated_round: null,
      rank,
    };
  }

  /**
   * Arbre final réduit à sa finale, jouée. C'est le seul match qu'un tournoi
   * clos laisse corriger : `match-lock` verrouille toute manche dont la suivante
   * porte une saisie.
   */
  function finalWonBy(winner: number, loser: number): [string, unknown][] {
    return [
      ["FROM bg_tournaments WHERE id = ?", [[enduranceRow()]]],
      ["status = 'FORFEIT'", [[]]],
      ["FROM bg_endurance_standings", [[standingRow(1, 1), standingRow(2, 2)]]],
      ["FROM bg_endurance_penalties", [[]]],
      ["SELECT round_number, status", [[]]],
      ["SELECT DISTINCT round_number", [[{ round_number: 1000 }]]],
      [
        "SELECT id, bracket, status",
        [
          [
            {
              id: 500,
              bracket: "UPPER",
              status: "COMPLETED",
              team1_id: loser,
              team2_id: winner,
              team1_score: 0,
              team2_score: 3,
              winner_team_id: winner,
              loser_team_id: loser,
              forfeit_team_id: null,
              is_bye: 0,
            },
          ],
        ],
      ],
    ];
  }

  it("réécrit le podium depuis la finale corrigée", async () => {
    // L'équipe 2 vient de gagner la finale alors que l'équipe 1 la précédait au
    // classement de qualification : le podium suit la finale.
    const conn = makeConn(finalWonBy(2, 1));

    await reconcileEndurance(5, conn);

    expect(writtenRanks(conn)).toEqual(
      new Map([
        [2, 1],
        [1, 2],
      ]),
    );
    expect(finishTournament).toHaveBeenCalled();
  });

  it("suit la correction : l'autre vainqueur donne l'autre podium", async () => {
    const conn = makeConn(finalWonBy(1, 2));

    await reconcileEndurance(5, conn);

    expect(writtenRanks(conn)).toEqual(
      new Map([
        [1, 1],
        [2, 2],
      ]),
    );
  });

  it("ne repose aucun tour d'arbre", async () => {
    const conn = makeConn(finalWonBy(2, 1));

    await reconcileEndurance(5, conn);

    expect(posedAnything(conn)).toBe(false);
  });

  it("réécrit aussi le classement d'un tournoi clos sans arbre", async () => {
    // Clos faute de qualifiées : endurance_playoffs_started est resté à 0, et
    // c'est le classement de qualification qui fait le palmarès.
    const conn = makeConn([
      ["FROM bg_tournaments WHERE id = ?", [[enduranceRow({ endurance_playoffs_started: 0 })]]],
      ["status = 'FORFEIT'", [[]]],
      ["FROM bg_endurance_standings", [[standingRow(3, 1), standingRow(4, 2)]]],
      ["FROM bg_endurance_penalties", [[]]],
      ["SELECT round_number, status", [[]]],
    ]);

    await reconcileEndurance(5, conn);

    expect(writtenRanks(conn)).toEqual(
      new Map([
        [3, 1],
        [4, 2],
      ]),
    );
    // Surtout : la qualification ne reprend pas, aucune manche n'est reposée à
    // un tournoi terminé.
    expect(posedAnything(conn)).toBe(false);
  });
});

describe("reconcileSurvival sur un tournoi terminé", () => {
  function survivalAnswers(winner: number, loser: number): [string, unknown][] {
    return [
      [
        "FROM bg_tournaments WHERE id = ?",
        [
          [
            {
              format: "SURVIVAL",
              state: "FINISHED",
              survival_rounds_before_first_cut: 1,
              survival_rounds_per_cut: 1,
              survival_current_round: 1,
              survival_barrage_rounds: 0,
            },
          ],
        ],
      ],
      [
        "FROM bg_survival_standings",
        [
          [1, 2].map((teamId) => ({
            team_id: teamId,
            seed: teamId,
            wins: 0,
            losses: 0,
            status: "ACTIVE",
            eliminated_round: null,
            has_bye: 0,
          })),
        ],
      ],
      [
        "SELECT round_number, status, winner_team_id",
        [
          [
            {
              round_number: 1,
              status: "COMPLETED",
              winner_team_id: winner,
              loser_team_id: loser,
              is_bye: 0,
            },
          ],
        ],
      ],
    ];
  }

  it("réécrit le classement final depuis la manche corrigée", async () => {
    const conn = makeConn(survivalAnswers(2, 1));

    const result = await reconcileSurvival(7, conn);

    expect(result.done).toBe(true);
    expect(writtenRanks(conn)).toEqual(
      new Map([
        [2, 1],
        [1, 2],
      ]),
    );
    expect(finishTournament).toHaveBeenCalled();
  });

  it("suit la correction dans l'autre sens", async () => {
    const conn = makeConn(survivalAnswers(1, 2));

    await reconcileSurvival(7, conn);

    expect(writtenRanks(conn)).toEqual(
      new Map([
        [1, 1],
        [2, 2],
      ]),
    );
  });

  it("ne repose aucune manche", async () => {
    const conn = makeConn(survivalAnswers(2, 1));

    await reconcileSurvival(7, conn);

    expect(posedAnything(conn)).toBe(false);
  });
});

describe("reconcileSwiss sur un tournoi terminé", () => {
  function swissAnswers(winner: number, loser: number): [string, unknown][] {
    return [
      [
        "FROM bg_tournaments WHERE id = ?",
        [
          [
            {
              format: "SWISS",
              state: "FINISHED",
              swiss_total_rounds: 1,
              swiss_current_round: 1,
              swiss_points_win: 3,
              swiss_points_draw: 1,
              swiss_points_loss: 0,
              swiss_points_bye: 3,
              swiss_tiebreakers_json: null,
            },
          ],
        ],
      ],
      [
        "FROM bg_swiss_standings",
        [
          [1, 2].map((teamId) => ({
            team_id: teamId,
            seed: teamId,
            status: "ACTIVE",
            forfeit_round: null,
          })),
        ],
      ],
      [
        "SELECT round_number, status, team1_id",
        [
          [
            {
              round_number: 1,
              status: "COMPLETED",
              team1_id: 1,
              team2_id: 2,
              winner_team_id: winner,
              loser_team_id: loser,
              is_bye: 0,
            },
          ],
        ],
      ],
    ];
  }

  it("réécrit le classement final depuis la ronde corrigée", async () => {
    const conn = makeConn(swissAnswers(2, 1));

    const result = await reconcileSwiss(9, conn);

    expect(result.done).toBe(true);
    expect(writtenRanks(conn)).toEqual(
      new Map([
        [2, 1],
        [1, 2],
      ]),
    );
    expect(finishTournament).toHaveBeenCalled();
  });

  it("suit la correction dans l'autre sens", async () => {
    const conn = makeConn(swissAnswers(1, 2));

    await reconcileSwiss(9, conn);

    expect(writtenRanks(conn)).toEqual(
      new Map([
        [1, 1],
        [2, 2],
      ]),
    );
  });

  it("ne repose aucune ronde", async () => {
    const conn = makeConn(swissAnswers(2, 1));

    await reconcileSwiss(9, conn);

    expect(posedAnything(conn)).toBe(false);
  });
});
