import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/byes");

import { reportMatchScore } from "@/lib/server/tournaments/scoring";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import { tournamentRow } from "../../helpers/tournament-rows";
import { mapsFor } from "../../helpers/match-maps";

/**
 * Connexion factice : elle reconnaît les requêtes de `reportMatchScore` à leur
 * fragment distinctif et renvoie un match prêt à être reporté. Objectif : voir
 * le garde-fou de format s'appliquer **avant** toute écriture.
 */
type FakeFormat = {
  type: "BO" | "FT";
  value: number;
  maxMaps?: number | null;
  draws?: boolean;
} | null;

function fakeConnection(
  format: FakeFormat = null,
  tournamentFormat = "SINGLE",
  game: "OW" | "MR" | null = null,
): { conn: PoolConnection; writes: string[]; mapWrites: { sql: string; params: unknown }[] } {
  const writes: string[] = [];
  const mapWrites: { sql: string; params: unknown }[] = [];
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
    // Un match se joue une fois lancé (`lib/shared/match-launch.ts`).
    launched_at: "2026-01-01 20:00:00",
    launch_pairing: "100:200",
  };

  const conn = {
    execute: async (sql: string, params?: unknown) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.includes("bg_match_maps")) {
        mapWrites.push({ sql: q, params });
        return [[], []];
      }
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
              game,
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

  return { conn, writes, mapWrites };
}

function mockTournament(matchFormat: FakeFormat, format: TournamentRow["format"] = "SINGLE"): void {
  jest.mocked(syncTournamentState).mockResolvedValue({
    row: tournamentRow({
      id: 1,
      state: "RUNNING",
      format,
      match_format_type: matchFormat?.type ?? null,
      match_format_value: matchFormat?.value ?? null,
    }),
    stateChanged: false,
    contentChanged: false,
    launchesChanged: false,
  });
}

describe("reportMatchScore — respect du format de match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getUserActiveTeam).mockResolvedValue({
      teamId: 100,
      teamName: "Équipe",
      roles: ["OWNER"],
    });
    jest.mocked(tryAutoResolveByes).mockResolvedValue(undefined);
  });

  it("verrouille la ligne du match à sa lecture, avant toute écriture", async () => {
    // Un forfait ou un arbitrage concurrent peut trancher le match entre la
    // lecture et l'écriture : sans verrou, ce report le rouvrirait.
    mockTournament({ type: "BO", value: 5 });
    const { conn } = fakeConnection({ type: "BO", value: 5 });
    const seen: string[] = [];
    const execute = conn.execute.bind(conn);
    (conn as unknown as { execute: (sql: string, p?: unknown) => unknown }).execute = (
      sql: string,
      params?: unknown,
    ) => {
      seen.push(sql.replace(/\s+/g, " ").trim());
      return (execute as (sql: string, p?: unknown) => unknown)(sql, params);
    };

    await reportMatchScore(conn, 1, 10, 42, mapsFor(3, 1));
    const firstMatchRead = seen.findIndex((q) => q.includes("FROM bg_matches"));
    const firstWrite = seen.findIndex((q) => q.startsWith("UPDATE"));
    expect(seen[firstMatchRead]).toMatch(/AND tournament_id = \? LIMIT 1 FOR UPDATE$/);
    expect(seen[firstMatchRead]).not.toMatch(/JOIN/);
    expect(firstMatchRead).toBeLessThan(firstWrite);
  });

  it("accepte un 3-1 en BO5", async () => {
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });

    await expect(reportMatchScore(conn, 1, 10, 42, mapsFor(3, 1))).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });

  it("refuse une map jouée après la victoire acquise, sans rien écrire", async () => {
    // 4-1 en BO5 : la quatrième map gagnée suit un 3-1 déjà décisif.
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });

    await expect(reportMatchScore(conn, 1, 10, 42, mapsFor(4, 1))).rejects.toThrow(
      "MAP_AFTER_DECISION",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse un score qui n'atteint pas l'objectif", async () => {
    mockTournament({ type: "FT", value: 3 });
    const { conn, writes } = fakeConnection({ type: "FT", value: 3 });

    await expect(reportMatchScore(conn, 1, 10, 42, mapsFor(2, 1))).rejects.toThrow(
      "SCORE_BELOW_MATCH_FORMAT",
    );
    expect(writes).toHaveLength(0);
  });

  it("laisse passer n'importe quel score décisif en saisie libre", async () => {
    mockTournament(null);
    const { conn, writes } = fakeConnection();

    await expect(reportMatchScore(conn, 1, 10, 42, mapsFor(7, 2))).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });

  it("refuse l'égalité sur un format qui exige un vainqueur", async () => {
    // Un 2-2 en BO5 est d'abord un score **incomplet** — personne n'a atteint
    // les trois manches — et c'est ce que dit le refus : le message renvoie au
    // bon geste, saisir le vrai score, plutôt qu'à une règle abstraite.
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes } = fakeConnection({ type: "BO", value: 5 });

    await expect(reportMatchScore(conn, 1, 10, 42, mapsFor(2, 2))).rejects.toThrow(
      "SCORE_BELOW_MATCH_FORMAT",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse l'égalité en saisie libre, faute d'objectif à opposer", async () => {
    mockTournament(null);
    const { conn, writes } = fakeConnection(null);

    await expect(reportMatchScore(conn, 1, 10, 42, mapsFor(2, 2))).rejects.toThrow("DRAW_NOT_ALLOWED");
    expect(writes).toHaveLength(0);
  });

  it("accepte un match nul quand le format l'autorise — BlueGenji Survie", async () => {
    // La qualification du mode se joue en BO5 **sans tiebreaker** : une map
    // nulle peut arrêter la rencontre sur 2-2, et le capital d'endurance, compté
    // map par map, l'encaisse sans rien inventer.
    mockTournament({ type: "FT", value: 3, draws: true }, "BG_SURVIE");
    const { conn, writes } = fakeConnection({ type: "FT", value: 3, draws: true }, "BG_SURVIE");

    // Cinq maps sans tiebreaker : deux gagnées de chaque côté, une nulle.
    await expect(reportMatchScore(conn, 1, 10, 42, mapsFor(2, 2, 1))).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });

  it("accepte un score sous l'objectif quand les égalités sont ouvertes", async () => {
    // Corollaire du même règlement : sur cinq maps dont une nulle, la rencontre
    // s'arrête sur 2-1 — un vainqueur, mais pas trois manches gagnées.
    mockTournament({ type: "FT", value: 3, draws: true }, "BG_SURVIE");
    const { conn, writes } = fakeConnection({ type: "FT", value: 3, draws: true }, "BG_SURVIE");

    await expect(reportMatchScore(conn, 1, 10, 42, mapsFor(2, 1, 2))).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });
});

describe("reportMatchScore — détail map par map (MAP_SCORES.md)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 100, teamName: "Équipe", roles: ["OWNER"] });
    jest.mocked(tryAutoResolveByes).mockResolvedValue(undefined);
  });

  it("écrit le score dérivé dans le circuit habituel et la proposition map par map", async () => {
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes, mapWrites } = fakeConnection({ type: "BO", value: 5 });

    await reportMatchScore(conn, 1, 10, 42, mapsFor(3, 1, 1));

    const report = writes.find((q) => q.includes("team1_report_score"));
    expect(report).toBeDefined();
    const insert = mapWrites.find((w) => w.sql.startsWith("INSERT INTO bg_match_maps"));
    expect(insert?.params).toEqual(expect.arrayContaining([10, "TEAM1", 1, "MAP001", 1, 1, 42]));
  });

  it("juge le code de replay selon le jeu : Overwatch exige six caractères", async () => {
    mockTournament({ type: "BO", value: 5 });
    const { conn, writes, mapWrites } = fakeConnection({ type: "BO", value: 5 }, "SINGLE", "OW");
    const maps = mapsFor(3, 0).map((m, i) => ({ ...m, replayCode: i === 0 ? "AB12" : `ABC12${i}` }));

    await expect(reportMatchScore(conn, 1, 10, 42, maps)).rejects.toThrow("MAP_REPLAY_CODE_INVALID");
    expect(writes).toHaveLength(0);
    expect(mapWrites).toHaveLength(0);
  });

  it("refuse une liste vide", async () => {
    mockTournament(null);
    const { conn, writes } = fakeConnection();
    await expect(reportMatchScore(conn, 1, 10, 42, [])).rejects.toThrow("MAP_LIST_EMPTY");
    expect(writes).toHaveLength(0);
  });
});
