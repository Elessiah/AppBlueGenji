import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/byes");

import { adminResolveMatch } from "@/lib/server/tournaments/admin";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";

/**
 * Arbitrage d'un tournoi « BlueGenji Survie », le seul mode à jouer **deux**
 * formats de match : sa qualification peut clore une rencontre sans vainqueur,
 * son arbre final non.
 *
 * Le match n'a pas encore de vainqueur, donc le verrou aval sort immédiatement :
 * il ne reste que la résolution du format et l'écriture du résultat.
 */
function fakeConnection(options: {
  round: number;
  /** Format de la qualification. */
  qualification?: { type: string; value: number; draws?: boolean } | null;
  /** Format de l'arbre final. `null` = celui du tournoi, égalités fermées. */
  playoff?: { type: string; value: number } | null;
  tournamentFormat?: string;
}): PoolConnection {
  const {
    round,
    qualification = { type: "FT", value: 3, draws: true },
    playoff = null,
    tournamentFormat = "BG_SURVIE",
  } = options;

  return {
    execute: async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();

      if (q.startsWith("UPDATE")) return [{ affectedRows: 1 }, []];

      // Verrou aval : match indécis → la saisie reste ouverte.
      if (q.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        return [[{ round_number: round, winner_team_id: null, format: tournamentFormat }], []];
      }

      if (q.includes("match_format_type") && q.includes("FROM bg_tournaments")) {
        return [
          [
            {
              format: tournamentFormat,
              match_format_type: qualification?.type ?? null,
              match_format_value: qualification?.value ?? null,
              match_format_max_maps: null,
              match_format_draws: qualification?.draws ? 1 : 0,
              endurance_playoff_format_type: playoff?.type ?? null,
              endurance_playoff_format_value: playoff?.value ?? null,
            },
          ],
          [],
        ];
      }

      if (q.includes("FROM bg_matches")) {
        return [
          [
            {
              id: 10,
              tournament_id: 1,
              round_number: round,
              team1_id: 100,
              team2_id: 200,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
              winner_team_id: null,
            },
          ],
          [],
        ];
      }

      return [[], []];
    },
  } as unknown as PoolConnection;
}

describe("adminResolveMatch — match nul en qualification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
  });

  it("clôt la rencontre sans vainqueur ni perdant", async () => {
    await adminResolveMatch(fakeConnection({ round: 3 }), 10, 2, 2);

    expect(finalizeMatch).toHaveBeenCalledTimes(1);
    // Ni vainqueur ni perdant : `finalizeMatch` écrit deux colonnes vides et ne
    // propage rien — c'est exactement ce qu'un nul veut dire.
    expect((finalizeMatch as jest.Mock).mock.calls[0][3]).toEqual({
      team1Score: 2,
      team2Score: 2,
      winnerTeamId: null,
      loserTeamId: null,
    });
  });

  it("accepte un score sous l'objectif : une map nulle a arrêté la rencontre", async () => {
    await adminResolveMatch(fakeConnection({ round: 3 }), 10, 2, 1);

    expect((finalizeMatch as jest.Mock).mock.calls[0][3]).toMatchObject({
      winnerTeamId: 100,
      loserTeamId: 200,
    });
  });

  it("garde le plafond du format", async () => {
    await expect(adminResolveMatch(fakeConnection({ round: 3 }), 10, 4, 0)).rejects.toThrow(
      "SCORE_EXCEEDS_MATCH_FORMAT",
    );
    expect(finalizeMatch).not.toHaveBeenCalled();
  });
});

describe("adminResolveMatch — l'arbre final exige un vainqueur", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
  });

  it("refuse un nul sur une manche de play-off, malgré la qualification ouverte", async () => {
    // Sans son propre format, l'arbre rejoue celui du tournoi **égalités
    // fermées** : le refus dit « score incomplet », le vainqueur doit atteindre
    // l'objectif.
    await expect(
      adminResolveMatch(fakeConnection({ round: PLAYOFF_ROUND_OFFSET }), 10, 2, 2),
    ).rejects.toThrow("SCORE_BELOW_MATCH_FORMAT");
    expect(finalizeMatch).not.toHaveBeenCalled();
  });

  it("refuse aussi un score sous l'objectif en play-off", async () => {
    await expect(
      adminResolveMatch(fakeConnection({ round: PLAYOFF_ROUND_OFFSET + 1 }), 10, 2, 1),
    ).rejects.toThrow("SCORE_BELOW_MATCH_FORMAT");
  });

  it("applique le format propre de l'arbre quand il en a un", async () => {
    const conn = fakeConnection({
      round: PLAYOFF_ROUND_OFFSET,
      qualification: { type: "FT", value: 3, draws: true },
      playoff: { type: "FT", value: 2 },
    });

    // FT2 : l'objectif est 2, et 2-1 est donc un résultat plein.
    await adminResolveMatch(conn, 10, 2, 1);
    expect((finalizeMatch as jest.Mock).mock.calls[0][3]).toMatchObject({ winnerTeamId: 100 });
  });

  it("refuse en play-off un score qui dépasse l'objectif propre de l'arbre", async () => {
    const conn = fakeConnection({
      round: PLAYOFF_ROUND_OFFSET,
      qualification: { type: "FT", value: 3, draws: true },
      playoff: { type: "FT", value: 2 },
    });

    await expect(adminResolveMatch(conn, 10, 3, 0)).rejects.toThrow("SCORE_EXCEEDS_MATCH_FORMAT");
  });
});

describe("adminResolveMatch — les autres formats ferment les égalités de force", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
  });

  it("ignore un drapeau d'égalité posé sur un tournoi à élimination simple", async () => {
    // La validation le refuse à la création, mais une ligne écrite avant cette
    // règle ne doit pas rendre un tableau à élimination directe indécidable.
    const conn = fakeConnection({
      round: 1,
      tournamentFormat: "SINGLE",
      qualification: { type: "FT", value: 3, draws: true },
    });

    await expect(adminResolveMatch(conn, 10, 2, 2)).rejects.toThrow("SCORE_BELOW_MATCH_FORMAT");
  });
});
