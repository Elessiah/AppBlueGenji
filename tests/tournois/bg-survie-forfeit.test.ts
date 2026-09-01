import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import {
  DEFAULT_ENDURANCE_CONFIG,
  replayEnduranceDetailed,
  type EnduranceMatchOutcome,
  type EnduranceRoundCell,
} from "@/lib/shared/bg-survie";
import { forfeitMapCount } from "@/lib/shared/match-format";
import { forfeitAwareMapScore } from "@/lib/shared/stats";

/**
 * Les deux forfaits du règlement « BlueGenji Survie », et ce qui les distingue :
 *
 * - le **forfait sur une manche**, déclaré par l'arbitrage sur un match, compté
 *   au score plein du format (FT3 → 3-0) et laissant l'équipe en lice ;
 * - le **forfait sur tout le reste du tournoi**, qui sort l'équipe et remplit
 *   ses manches restantes de cases « FF » dans le tableau d'endurance.
 */

const CONFIG = DEFAULT_ENDURANCE_CONFIG;
const FT3 = { type: "FT", value: 3 } as const;
const BO3 = { type: "BO", value: 3 } as const;

function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ teamId: index + 1, seed: index + 1 }));
}

function winMaps(
  round: number,
  winnerTeamId: number,
  loserTeamId: number,
  winnerMaps: number,
  loserMaps: number,
): EnduranceMatchOutcome {
  return { round, completed: true, winnerTeamId, loserTeamId, winnerMaps, loserMaps };
}

/** Raccourci de lecture : la ligne d'une équipe, condensée comme à l'écran. */
function line(cells: EnduranceRoundCell[]): string {
  return cells
    .map((cell) =>
      cell.kind === "FORFEIT" ? "FF" : cell.kind === "OUT" ? "·" : String(cell.points),
    )
    .join(" ");
}

describe("forfeitMapCount — le chiffre d'un forfait", () => {
  it("vaut l'objectif du format", () => {
    expect(forfeitMapCount(FT3)).toBe(3);
    expect(forfeitMapCount({ type: "BO", value: 5 })).toBe(3);
    expect(forfeitMapCount(BO3)).toBe(2);
    expect(forfeitMapCount({ type: "FT", value: 1 })).toBe(1);
  });

  it("retombe sur 1-0 en saisie libre — jamais 0-0, qui ne désignerait personne", () => {
    expect(forfeitMapCount(null)).toBe(1);
    expect(forfeitMapCount(undefined)).toBe(1);
  });
});

describe("replayEnduranceDetailed — tableau manche par manche", () => {
  it("donne une case par manche jouée, à toutes les équipes", () => {
    const replay = replayEnduranceDetailed({
      teams: teams(4),
      matches: [winMaps(1, 1, 2, 3, 1), winMaps(1, 3, 4, 3, 0)],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: FT3,
    });

    expect(replay.rounds).toEqual([1]);
    // 9 + 3 − 1 = 11 pour la gagnante d'un 3-1, 9 + 1 − 3 = 7 pour la perdante.
    expect(line(replay.history.get(1)!)).toBe("11");
    expect(line(replay.history.get(2)!)).toBe("7");
    expect(line(replay.history.get(3)!)).toBe("12");
    expect(line(replay.history.get(4)!)).toBe("6");
  });

  it("porte « FF » sur la manche du retrait et sur toutes les suivantes", () => {
    const replay = replayEnduranceDetailed({
      teams: teams(4),
      matches: [
        winMaps(1, 1, 2, 3, 0),
        winMaps(1, 3, 4, 3, 0),
        winMaps(2, 1, 3, 3, 0),
        // Manche 2 : l'équipe 2 est déclarée forfait, son match est clos 3-0.
        winMaps(2, 4, 2, 3, 0),
        winMaps(3, 1, 4, 3, 0),
      ],
      forfeits: [{ teamId: 2, round: 2 }],
      config: CONFIG,
      lastRound: 3,
      matchFormat: FT3,
    });

    // Manche 1 disputée (9 − 3 = 6), puis « FF » jusqu'au bout.
    expect(line(replay.history.get(2)!)).toBe("6 FF FF");
    expect(replay.history.get(2)!.map((cell) => cell.points)).toEqual([6, null, null]);
  });

  it("n'invente pas de case pour une manche que l'équipe éliminée n'a pas jouée", () => {
    const replay = replayEnduranceDetailed({
      teams: teams(4),
      matches: [
        // 3 manches perdues 3-0 : 9 → 6 → 3 → 0, l'équipe 2 sort à la manche 3.
        winMaps(1, 1, 2, 3, 0),
        winMaps(2, 1, 2, 3, 0),
        winMaps(3, 1, 2, 3, 0),
        winMaps(4, 1, 3, 3, 0),
      ],
      forfeits: [],
      config: CONFIG,
      lastRound: 4,
      matchFormat: FT3,
    });

    // La manche qui vide le capital affiche bien son zéro ; la suivante, non.
    expect(line(replay.history.get(2)!)).toBe("6 3 0 ·");
    expect(replay.history.get(2)!.at(-1)).toEqual({ round: 4, kind: "OUT", points: null });
  });

  it("laisse une case « FF » là où l'élimination et le retrait tombent ensemble", () => {
    // 9 − 3 − 3 − 3 = 0 : le score plein du forfait vide le capital dans la
    // manche même du retrait. C'est la décision humaine qui doit se lire.
    const replay = replayEnduranceDetailed({
      teams: teams(2),
      matches: [
        winMaps(1, 1, 2, 3, 0),
        winMaps(2, 1, 2, 3, 0),
        { round: 3, completed: true, winnerTeamId: 1, loserTeamId: 2, isForfeit: true },
      ],
      forfeits: [{ teamId: 2, round: 3 }],
      config: CONFIG,
      lastRound: 3,
      matchFormat: FT3,
    });

    expect(line(replay.history.get(2)!)).toBe("6 3 FF");
    expect(replay.standings.find((s) => s.teamId === 2)?.status).toBe("FORFEIT");
  });

  it("se refait avec le classement : sans l'entrée d'abandon, plus aucun « FF »", () => {
    const input = {
      teams: teams(2),
      matches: [winMaps(1, 1, 2, 3, 0), winMaps(2, 1, 2, 3, 0)],
      config: CONFIG,
      lastRound: 2,
      matchFormat: FT3,
    };

    expect(line(replayEnduranceDetailed({ ...input, forfeits: [] }).history.get(2)!)).toBe("6 3");
    expect(
      line(replayEnduranceDetailed({ ...input, forfeits: [{ teamId: 2, round: 2 }] }).history.get(2)!),
    ).toBe("6 FF");
  });

  it("rend le même classement que `replayEndurance` — une seule boucle, deux sorties", () => {
    const input = {
      teams: teams(4),
      matches: [winMaps(1, 1, 2, 3, 2), winMaps(1, 3, 4, 3, 0)],
      forfeits: [{ teamId: 4, round: 1 }],
      config: CONFIG,
      lastRound: 1,
      matchFormat: FT3,
    };

    const detailed = replayEnduranceDetailed(input);
    expect(detailed.standings).toEqual(
      // Deux appels séparés doivent produire exactement le même tableau.
      replayEnduranceDetailed(input).standings,
    );
    expect(detailed.rounds).toHaveLength(1);
  });

  it("ne produit aucune colonne avant la première manche", () => {
    const replay = replayEnduranceDetailed({
      teams: teams(8),
      matches: [],
      forfeits: [],
      config: CONFIG,
      lastRound: 0,
      matchFormat: FT3,
    });

    expect(replay.rounds).toEqual([]);
    expect(replay.history.get(1)).toEqual([]);
  });

  it("aligne toutes les lignes sur le même nombre de colonnes", () => {
    const replay = replayEnduranceDetailed({
      teams: teams(5),
      matches: [winMaps(1, 1, 2, 3, 0), winMaps(2, 1, 3, 3, 0)],
      forfeits: [{ teamId: 5, round: 1 }],
      config: CONFIG,
      lastRound: 2,
      matchFormat: FT3,
    });

    for (const team of teams(5)) {
      expect(replay.history.get(team.teamId)).toHaveLength(replay.rounds.length);
    }
  });
});

describe("forfeitAwareMapScore — le bilan de maps d'un forfait", () => {
  it("chiffre le forfait au score plein du format, dans les deux sens", () => {
    expect(forfeitAwareMapScore("RECEIVED", FT3, null, null)).toEqual({
      scoreFor: 3,
      scoreAgainst: 0,
    });
    expect(forfeitAwareMapScore("GIVEN", FT3, null, null)).toEqual({
      scoreFor: 0,
      scoreAgainst: 3,
    });
    expect(forfeitAwareMapScore("GIVEN", BO3, null, null)).toEqual({
      scoreFor: 0,
      scoreAgainst: 2,
    });
  });

  it("ignore les colonnes de score d'un forfait, même renseignées", () => {
    // Une rencontre interrompue puis déclarée forfait garde parfois un score
    // partiel : c'est le règlement qui tranche, pas la trace laissée en base.
    expect(forfeitAwareMapScore("RECEIVED", FT3, 1, 1)).toEqual({ scoreFor: 3, scoreAgainst: 0 });
  });

  it("retombe sur 1-0 sans format", () => {
    expect(forfeitAwareMapScore("RECEIVED", null, null, null)).toEqual({
      scoreFor: 1,
      scoreAgainst: 0,
    });
  });

  it("laisse une rencontre ordinaire à son score", () => {
    expect(forfeitAwareMapScore("NONE", FT3, 3, 2)).toEqual({ scoreFor: 3, scoreAgainst: 2 });
    expect(forfeitAwareMapScore("NONE", FT3, null, null)).toEqual({ scoreFor: 0, scoreAgainst: 0 });
  });
});

describe("loadEnduranceMeta — l'historique voyage jusqu'à la vue", () => {
  beforeEach(() => jest.resetModules());

  /**
   * Connexion factice : le tournoi, le classement joint aux équipes, puis les
   * matchs de la phase qualificative — dans l'ordre où le service les lit.
   */
  function metaConnection(): PoolConnection {
    const execute = async (sql: string) => {
      const q = String(sql).replace(/\s+/g, " ").trim();

      if (q.includes("FROM bg_tournaments")) {
        return [
          [
            {
              format: "BG_SURVIE",
              state: "RUNNING",
              match_format_type: "FT",
              match_format_value: 3,
              endurance_start_points: 9,
              endurance_win_delta: 1,
              endurance_loss_delta: 1,
              endurance_playoff_size: 8,
              endurance_current_round: 2,
              endurance_playoffs_started: 0,
              has_third_place_match: 0,
            },
          ],
          [],
        ];
      }

      if (q.includes("FROM bg_endurance_standings")) {
        return [
          [
            {
              team_id: 1,
              team_name: "Alpha",
              logo_url: null,
              seed: 1,
              points: 12,
              wins: 2,
              losses: 0,
              status: "ACTIVE",
              eliminated_round: null,
              rank: 1,
            },
            {
              team_id: 2,
              team_name: "Bravo",
              logo_url: null,
              seed: 2,
              points: 0,
              wins: 0,
              losses: 1,
              status: "FORFEIT",
              eliminated_round: 2,
              rank: 2,
            },
          ],
          [],
        ];
      }

      if (q.includes("FROM bg_matches")) {
        return [
          [
            {
              round_number: 1,
              status: "COMPLETED",
              team1_id: 1,
              team2_id: 2,
              team1_score: 3,
              team2_score: 0,
              winner_team_id: 1,
              loser_team_id: 2,
              forfeit_team_id: null,
            },
          ],
          [],
        ];
      }

      return [[], []];
    };

    return { execute } as unknown as PoolConnection;
  }

  it("expose les colonnes et les cases « FF » de l'équipe retirée", async () => {
    const { loadEnduranceMeta } = await import("@/lib/server/tournaments/bg-survie");
    const meta = await loadEnduranceMeta(metaConnection(), 7);

    expect(meta).not.toBeNull();
    expect(meta!.rounds).toEqual([1, 2]);
    expect(meta!.forfeitMaps).toBe(3);

    const alpha = meta!.standings.find((row) => row.teamId === 1)!;
    const bravo = meta!.standings.find((row) => row.teamId === 2)!;

    expect(line(alpha.rounds)).toBe("12 12");
    // Manche 1 perdue 3-0 (9 − 3 = 6), puis retirée du tournoi.
    expect(line(bravo.rounds)).toBe("6 FF");
  });
});
