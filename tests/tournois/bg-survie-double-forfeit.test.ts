import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");

import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie";
import {
  createMatch,
  finishTournament,
  reopenTournament,
} from "@/lib/server/tournaments/repository";

/**
 * L'arbre final d'une BlueGenji Survie face au double forfait, **en cascade** :
 * une demi-finale close sans qualifiée fait naître une finale et une petite
 * finale déjà jouées (exemptions), et l'entretien doit enchaîner jusqu'à la
 * clôture sans attendre un score que personne n'a à saisir.
 *
 * Le plateau est tenu en mémoire pour que les tours posés soient relus.
 */
type MatchRow = {
  id: number;
  bracket: string;
  round_number: number;
  status: string;
  team1_id: number | null;
  team2_id: number | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  loser_team_id: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number;
  is_bye: number;
};

function semi(id: number, team1: number, team2: number, result: "DF" | number): MatchRow {
  const df = result === "DF";
  return {
    id,
    bracket: "UPPER",
    round_number: 1000,
    status: "COMPLETED",
    team1_id: team1,
    team2_id: team2,
    team1_score: df ? null : result === team1 ? 3 : 0,
    team2_score: df ? null : result === team2 ? 3 : 0,
    winner_team_id: df ? null : result,
    loser_team_id: df ? null : result === team1 ? team2 : team1,
    forfeit_team_id: null,
    double_forfeit: df ? 1 : 0,
    is_bye: 0,
  };
}

function makeBoard(matches: MatchRow[], state = "RUNNING") {
  const board = [...matches];
  const ranks = new Map<number, number>();
  let nextId = 900;

  (createMatch as jest.Mock).mockImplementation(async (...args: unknown[]) => {
    const [, , bracket, round] = args as [unknown, unknown, string, number];
    const id = nextId++;
    board.push({
      id,
      bracket,
      round_number: round,
      status: "PENDING",
      team1_id: null,
      team2_id: null,
      team1_score: null,
      team2_score: null,
      winner_team_id: null,
      loser_team_id: null,
      forfeit_team_id: null,
      double_forfeit: 0,
      is_bye: 0,
    });
    return id as never;
  });

  const execute = jest.fn(async (sql: unknown, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ");

    if (q.includes("FROM bg_tournaments WHERE id = ?")) {
      return [
        [
          {
            format: "BG_SURVIE",
            state,
            match_format_type: "FT",
            match_format_value: 3,
            endurance_start_points: 9,
            endurance_win_delta: 1,
            endurance_loss_delta: 1,
            endurance_playoff_size: 4,
            endurance_current_round: 3,
            endurance_playoffs_started: 1,
            has_third_place_match: 0,
          },
        ],
      ];
    }
    // Les abandons se lisent dans la même table : aucun ici.
    if (q.includes("status = 'FORFEIT'")) return [[]];
    if (q.includes("FROM bg_endurance_standings")) {
      return [
        [1, 2, 3, 4].map((teamId) => ({
          team_id: teamId,
          seed: teamId,
          points: 9,
          wins: 0,
          losses: 0,
          status: "ACTIVE",
          eliminated_round: null,
          rank: teamId,
        })),
      ];
    }
    if (q.includes("SELECT DISTINCT round_number")) {
      const rounds = [...new Set(board.map((m) => m.round_number))].sort((a, b) => a - b);
      return [rounds.map((round_number) => ({ round_number }))];
    }
    if (q.includes("SELECT id, bracket, status")) {
      const round = Number(params[1]);
      return [board.filter((m) => m.round_number === round).sort((a, b) => a.id - b.id)];
    }
    if (q.includes("team1_id = ?, team2_id = ?, status = ?, is_bye = ?")) {
      const [team1, team2, status, isBye, s1, s2, winner, id] = params as [
        number, number | null, string, number, number | null, number | null, number | null, number,
      ];
      const row = board.find((m) => m.id === id)!;
      Object.assign(row, {
        team1_id: team1,
        team2_id: team2,
        status,
        is_bye: isBye,
        team1_score: s1,
        team2_score: s2,
        winner_team_id: winner,
        loser_team_id: null,
        double_forfeit: 0,
      });
      return [{ affectedRows: 1 }];
    }
    if (q.includes("SET final_rank = ?")) {
      const [rank, , teamId] = params as [number, number, number];
      ranks.set(teamId, rank);
      return [{ affectedRows: 1 }];
    }
    if (q.trim().startsWith("SELECT")) return [[]];
    return [{ affectedRows: 1 }];
  });

  return {
    conn: { execute } as never as Parameters<typeof reconcileEndurance>[1],
    board,
    ranks,
  };
}

describe("BlueGenji Survie — double forfait dans l'arbre final", () => {
  beforeEach(() => jest.clearAllMocks());

  it("enchaîne finale et petite finale par exemption, puis clôt le tournoi", async () => {
    // Tableau à 4 : 1 vs 4 (gagné par 1), 2 vs 3 (double forfait).
    const { conn, board, ranks } = makeBoard([semi(500, 1, 4, 1), semi(501, 2, 3, "DF")]);

    await reconcileEndurance(5, conn);

    const finalRound = board.filter((m) => m.round_number === 1001);
    expect(finalRound).toEqual([
      expect.objectContaining({ bracket: "UPPER", team1_id: 1, team2_id: null, winner_team_id: 1, status: "COMPLETED" }),
      expect.objectContaining({ bracket: "THIRD_PLACE", team1_id: 4, team2_id: null, winner_team_id: 4, status: "COMPLETED" }),
    ]);
    // Aucun tour de plus : la finale est jouée, le tournoi se clôt.
    expect(board.some((m) => m.round_number > 1001)).toBe(false);
    expect(finishTournament).toHaveBeenCalled();

    // Championne par exemption, 2ᵉ place vacante, la battue de la demi-finale 3ᵉ.
    expect(ranks.get(1)).toBe(1);
    expect(ranks.get(4)).toBe(3);
    expect([...ranks.values()]).not.toContain(2);
    // Les deux forfaits sont classés après, jamais devant.
    expect(ranks.get(2)).toBeGreaterThan(3);
    expect(ranks.get(3)).toBeGreaterThan(3);
  });

  it("clôt sans championne quand les deux demi-finales sont des doubles forfaits", async () => {
    const { conn, board, ranks } = makeBoard([semi(500, 1, 4, "DF"), semi(501, 2, 3, "DF")]);

    await reconcileEndurance(5, conn);

    expect(board.some((m) => m.round_number > 1000)).toBe(false);
    expect(finishTournament).toHaveBeenCalled();
    // Classement de qualification, faute d'arbre.
    expect(ranks.size).toBe(4);
  });

  it("rouvre un tournoi clos par exemptions quand le double forfait est corrigé", async () => {
    // Le double forfait de la demi 2-3 avait fait naître finale et petite
    // finale d'exemptions, et clos le tournoi. L'arbitre le corrige : 2 gagne.
    const byeFinal: MatchRow = {
      ...semi(600, 1, 0, 1),
      team2_id: null,
      is_bye: 1,
      round_number: 1001,
      loser_team_id: null,
    };
    const byeThird: MatchRow = {
      ...semi(601, 4, 0, 4),
      team2_id: null,
      is_bye: 1,
      bracket: "THIRD_PLACE",
      round_number: 1001,
      loser_team_id: null,
    };
    const { conn, board } = makeBoard(
      [semi(500, 1, 4, 1), semi(501, 2, 3, 2), byeFinal, byeThird],
      "FINISHED",
    );

    await reconcileEndurance(5, conn);

    expect(reopenTournament).toHaveBeenCalledWith(conn, 5);
    // La finale redevient une vraie rencontre, à jouer.
    expect(board.find((m) => m.id === 600)).toMatchObject({
      team1_id: 1,
      team2_id: 2,
      status: "READY",
      winner_team_id: null,
    });
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("ne rouvre rien quand la correction ne change pas l'arbre", async () => {
    const { conn } = makeBoard([semi(500, 1, 4, 1), semi(501, 2, 3, 2)], "FINISHED");
    await reconcileEndurance(5, conn);
    expect(reopenTournament).not.toHaveBeenCalled();
  });

  it("ne fait pas de championne sur une finale close en double forfait", async () => {
    const final: MatchRow = { ...semi(600, 1, 2, "DF"), round_number: 1001 };
    const third: MatchRow = {
      ...semi(601, 4, 3, 3),
      bracket: "THIRD_PLACE",
      round_number: 1001,
    };
    const { conn, ranks } = makeBoard([semi(500, 1, 4, 1), semi(501, 2, 3, 2), final, third]);

    await reconcileEndurance(5, conn);

    expect(finishTournament).toHaveBeenCalled();
    expect(ranks.get(1)).toBe(2);
    expect(ranks.get(2)).toBe(2);
    expect(ranks.get(3)).toBe(3);
    expect(ranks.get(4)).toBe(4);
    expect([...ranks.values()]).not.toContain(1);
  });
});
