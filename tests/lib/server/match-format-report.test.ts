import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/byes");

import { reportMatchScore } from "@/lib/server/tournaments/scoring";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";

/**
 * Connexion factice : elle reconnaît les requêtes de `reportMatchScore` à leur
 * fragment distinctif et renvoie un match prêt à être reporté. Objectif : voir
 * le garde-fou de format s'appliquer **avant** toute écriture.
 */
type FakeFormat = {
  type: string;
  value: number;
  maxMaps?: number | null;
  draws?: boolean;
} | null;

function fakeConnection(
  format: FakeFormat = null,
  tournamentFormat = "SINGLE",
): { conn: PoolConnection; writes: string[] } {
  const writes: string[] = [];
  const match = {
    id: 10,
    tournament_id: 1,
    team1_id: 100,
    team2_id: 200,
    team1_report_score: null,
    team1_report_opponent_score: null,
    team1_reported_at: null,
    team2_report_score: null,
    team2_report_opponent_score: null,
    team2_reported_at: null,
    score_deadline_at: null,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    winner_team_id: null,
    status: "READY",
  };

  const conn = {
    execute: async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("UPDATE")) {
        writes.push(q);
        return [{ affectedRows: 1 }, []];
      }
      // Le format se lit désormais sur le tournoi **avec la manche** : « BlueGenji
      // Survie » en joue deux (qualification / play-offs), la règle vit donc
      // dans `loadTournamentMatchFormat` et non dans la ligne déjà chargée.
      if (q.includes("FROM bg_tournaments")) {
        return [
          [
            {
              format: tournamentFormat,
              match_format_type: format?.type ?? null,
              match_format_value: format?.value ?? null,
              match_format_max_maps: format?.maxMaps ?? null,
              match_format_draws: format?.draws ? 1 : 0,
              endurance_playoff_format_type: null,
              endurance_playoff_format_value: null,
            },
          ],
          [],
        ];
      }
      if (q.includes("FROM bg_matches")) return [[{ ...match }], []];
      return [[], []];
    },
  } as unknown as PoolConnection;

  return { conn, writes };
}

function mockTournament(matchFormat: FakeFormat, format = "SINGLE"): void {
  (syncTournamentState as jest.Mock).mockResolvedValue({
    row: {
      id: 1,
      state: "RUNNING",
      format,
      match_format_type: matchFormat?.type ?? null,
      match_format_value: matchFormat?.value ?? null,
    },
    stateChanged: false,
  } as never);
}

describe("reportMatchScore — respect du format de match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 100 } as never);
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
  });

  it("accepte un 3-1 en BO5", async () => {
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });

    await expect(reportMatchScore(conn, 1, 10, 42, 3, 1)).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });

  it("refuse un score au-dessus de l'objectif, sans rien écrire", async () => {
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });

    await expect(reportMatchScore(conn, 1, 10, 42, 4, 1)).rejects.toThrow(
      "SCORE_EXCEEDS_MATCH_FORMAT",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse un score qui n'atteint pas l'objectif", async () => {
    mockTournament({ type: "FT", value: 3 });
    const { conn, writes } = fakeConnection({ type: "FT", value: 3 });

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 1)).rejects.toThrow(
      "SCORE_BELOW_MATCH_FORMAT",
    );
    expect(writes).toHaveLength(0);
  });

  it("laisse passer n'importe quel score décisif en saisie libre", async () => {
    mockTournament(null);
    const { conn, writes } = fakeConnection();

    await expect(reportMatchScore(conn, 1, 10, 42, 7, 2)).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });

  it("refuse l'égalité sur un format qui exige un vainqueur", async () => {
    // Un 2-2 en BO5 est d'abord un score **incomplet** — personne n'a atteint
    // les trois manches — et c'est ce que dit le refus : le message renvoie au
    // bon geste, saisir le vrai score, plutôt qu'à une règle abstraite.
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 2)).rejects.toThrow(
      "SCORE_BELOW_MATCH_FORMAT",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse l'égalité en saisie libre, faute d'objectif à opposer", async () => {
    mockTournament(null);
    const { conn, writes } = fakeConnection(null);

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 2)).rejects.toThrow("DRAW_NOT_ALLOWED");
    expect(writes).toHaveLength(0);
  });

  it("accepte un match nul quand le format l'autorise — BlueGenji Survie", async () => {
    // La qualification du mode se joue en BO5 **sans tiebreaker** : une map
    // nulle peut arrêter la rencontre sur 2-2, et le capital d'endurance, compté
    // map par map, l'encaisse sans rien inventer.
    mockTournament({ type: "FT", value: 3, draws: true }, "BG_SURVIE");
    const { conn, writes } = fakeConnection({ type: "FT", value: 3, draws: true }, "BG_SURVIE");

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 2)).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });

  it("accepte un score sous l'objectif quand les égalités sont ouvertes", async () => {
    // Corollaire du même règlement : sur cinq maps dont une nulle, la rencontre
    // s'arrête sur 2-1 — un vainqueur, mais pas trois manches gagnées.
    mockTournament({ type: "FT", value: 3, draws: true }, "BG_SURVIE");
    const { conn, writes } = fakeConnection({ type: "FT", value: 3, draws: true }, "BG_SURVIE");

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 1)).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });
});
