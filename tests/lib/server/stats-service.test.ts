import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  getPlayerEntityStats,
  getPlayerStats,
  getTeamEntityStats,
  getTeamRankingPosition,
  getTeamStats,
} from "@/lib/server/stats-service";
import { RANKING_POINTS_PER_LOSS, RANKING_POINTS_PER_WIN } from "@/lib/shared/ranking";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tournament_id: 10,
    tournament_name: "Test - Coupe",
    game: "OW2",
    format: "SINGLE",
    bracket: "UPPER",
    played_at: new Date("2026-06-01T18:00:00Z"),
    team1_id: 5,
    team2_id: 9,
    team1_name: "Nous",
    team2_name: "Eux",
    team1_score: 2,
    team2_score: 1,
    winner_team_id: 5,
    forfeit_team_id: null,
    ...overrides,
  };
}

/**
 * Inscription à un tournoi **terminé**. `start_at` / `finished_at` bornent le
 * déroulement : c'est sur cet intervalle que se juge l'appartenance du joueur.
 */
function registrationRow(overrides: Record<string, unknown> = {}) {
  return {
    team_id: 5,
    tournament_id: 10,
    tournament_name: "Test - Coupe",
    state: "FINISHED",
    game: "OW2",
    format: "SINGLE",
    final_rank: 2,
    played_at: new Date("2026-06-02T18:00:00Z"),
    start_at: new Date("2026-06-01T18:00:00Z"),
    finished_at: new Date("2026-06-02T18:00:00Z"),
    ...overrides,
  };
}

/** Inscription à un tournoi encore en cours : pas de borne de fin. */
function runningRegistrationRow(overrides: Record<string, unknown> = {}) {
  return registrationRow({
    state: "RUNNING",
    final_rank: null,
    finished_at: null,
    ...overrides,
  });
}

describe("getTeamStats", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("agrège les matchs de l'équipe, quel que soit son côté du tableau", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          matchRow({ id: 1, team1_id: 5, team2_id: 9, winner_team_id: 5, team1_score: 2, team2_score: 0 }),
          // Même équipe, cette fois en team2 : victoire de l'adversaire.
          matchRow({
            id: 2,
            team1_id: 9,
            team2_id: 5,
            team1_name: "Eux",
            team2_name: "Nous",
            winner_team_id: 9,
            team1_score: 2,
            team2_score: 1,
            played_at: new Date("2026-06-03T18:00:00Z"),
          }),
        ],
      ])
      .mockResolvedValueOnce([[registrationRow()]]);
    await mockDb(execute);

    const stats = await getTeamStats(5);

    expect(stats.matchesPlayed).toBe(2);
    expect(stats.matchesWon).toBe(1);
    expect(stats.matchesLost).toBe(1);
    expect(stats.mapsWon).toBe(3);
    expect(stats.mapsLost).toBe(2);
    expect(stats.currentStreak).toEqual({ kind: "LOSS", length: 1 });
    expect(stats.nemesis).toMatchObject({ teamId: 9, teamName: "Eux", lost: 1 });
  });

  it("écarte byes et matchs fantômes dès la requête", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await getTeamStats(5);

    const [sql] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/m\.is_bye = 0/);
    expect(sql).toMatch(/m\.team1_id IS NOT NULL/);
    expect(sql).toMatch(/m\.team2_id IS NOT NULL/);
    expect(sql).toMatch(/m\.status = 'COMPLETED'/);
  });

  it("passe les identifiants d'équipe en paramètres liés", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await getTeamStats(5);

    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    // Une fois pour team1_id IN (...), une fois pour team2_id IN (...).
    expect(params).toEqual([5, 5]);
  });

  it("attribue le forfait au bon camp", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          matchRow({ id: 1, forfeit_team_id: 5, winner_team_id: 9 }),
          matchRow({ id: 2, forfeit_team_id: 9, winner_team_id: 5 }),
        ],
      ])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const stats = await getTeamStats(5);

    expect(stats.forfeitsGiven).toBe(1);
    expect(stats.forfeitsReceived).toBe(1);
  });

  it("retombe sur des valeurs sûres quand jeu et format sont absents", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[matchRow({ game: null, format: null })]])
      .mockResolvedValueOnce([[registrationRow({ game: null, format: null })]]);
    await mockDb(execute);

    const stats = await getTeamStats(5);

    expect(stats.byGame[0].key).toBe("OW2");
    expect(stats.byFormat[0].key).toBe("SINGLE");
  });

  it("reprend le palmarès depuis les inscriptions", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          registrationRow({ tournament_id: 10, final_rank: 1 }),
          registrationRow({ tournament_id: 11, final_rank: 5 }),
        ],
      ]);
    await mockDb(execute);

    const stats = await getTeamStats(5);

    expect(stats.tournamentsPlayed).toBe(2);
    expect(stats.tournamentsWon).toBe(1);
    expect(stats.bestRank).toBe(1);
  });
});

describe("historique dérivé des mêmes matchs", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("recompte le bilan de chaque tournoi depuis les matchs retenus", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          matchRow({ id: 1, tournament_id: 10, winner_team_id: 5 }),
          matchRow({ id: 2, tournament_id: 10, winner_team_id: 9 }),
          matchRow({ id: 3, tournament_id: 11, winner_team_id: 5 }),
        ],
      ])
      .mockResolvedValueOnce([
        [registrationRow({ tournament_id: 10 }), registrationRow({ tournament_id: 11 })],
      ]);
    await mockDb(execute);

    const { stats, tournaments } = await getTeamEntityStats(5);

    const first = tournaments.find((entry) => entry.tournamentId === 10);
    expect(first).toMatchObject({ wins: 1, losses: 1 });
    expect(tournaments.find((entry) => entry.tournamentId === 11)).toMatchObject({
      wins: 1,
      losses: 0,
    });
    // Le total de l'agrégat et celui des lignes ne peuvent pas diverger.
    const summed = tournaments.reduce((total, entry) => total + entry.wins, 0);
    expect(summed).toBe(stats.matchesWon);
  });

  it("classe l'historique du plus récent au plus ancien", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          registrationRow({ tournament_id: 10, played_at: new Date("2026-01-02T18:00:00Z") }),
          registrationRow({ tournament_id: 11, played_at: new Date("2026-06-02T18:00:00Z") }),
        ],
      ]);
    await mockDb(execute);

    const { tournaments } = await getTeamEntityStats(5);

    expect(tournaments.map((entry) => entry.tournamentId)).toEqual([11, 10]);
  });

  it("ne liste qu'une fois un tournoi disputé par deux équipes du joueur", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          { team_id: 5, joined_at: new Date("2026-01-01T00:00:00Z"), left_at: null },
          { team_id: 6, joined_at: new Date("2026-01-01T00:00:00Z"), left_at: null },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          runningRegistrationRow({ team_id: 5, tournament_id: 10 }),
          runningRegistrationRow({ team_id: 6, tournament_id: 10 }),
        ],
      ]);
    await mockDb(execute);

    const { tournaments } = await getPlayerEntityStats(42);

    expect(tournaments).toHaveLength(1);
  });
});

describe("getTeamRankingPosition", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("place l'équipe d'après le barème partagé", async () => {
    const execute = jest.fn().mockResolvedValueOnce([
      [
        { team_id: 1, points: 500 },
        { team_id: 5, points: 300 },
        { team_id: 7, points: 900 },
      ],
    ]);
    await mockDb(execute);

    expect(await getTeamRankingPosition(5)).toEqual({ position: 3, total: 3, points: 300 });
  });

  it("donne le même rang à deux équipes à égalité", async () => {
    const execute = jest.fn().mockResolvedValueOnce([
      [
        { team_id: 1, points: 900 },
        { team_id: 5, points: 300 },
        { team_id: 7, points: 300 },
      ],
    ]);
    await mockDb(execute);

    const first = await getTeamRankingPosition(5);
    await mockDb(
      jest.fn().mockResolvedValueOnce([
        [
          { team_id: 1, points: 900 },
          { team_id: 5, points: 300 },
          { team_id: 7, points: 300 },
        ],
      ]),
    );
    const second = await getTeamRankingPosition(7);

    expect(first.position).toBe(2);
    expect(second.position).toBe(2);
  });

  it("classe sur la même assiette de matchs que le bilan de la fiche", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await getTeamRankingPosition(1);

    // Sans ces filtres, les byes gonfleraient le rang sans toucher aux points
    // affichés juste à côté.
    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toMatch(/m\.is_bye = 0/);
    expect(sql).toMatch(/m\.team2_id IS NOT NULL/);
    expect(sql).toMatch(/m\.winner_team_id IS NOT NULL/);
  });

  it("compte une défaite dès que l'équipe n'est pas la gagnante", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await getTeamRankingPosition(1);

    // S'appuyer sur `loser_team_id` laissait filer les matchs où le moteur pose
    // un vainqueur sans renseigner le perdant : le rang divergeait alors des
    // points affichés sur la même fiche.
    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toContain("m.winner_team_id <> t.id");
    expect(sql).not.toContain("m.loser_team_id");
  });

  it("ne classe pas une équipe sans aucun match joué", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[{ team_id: 1, points: 100 }]]);
    await mockDb(execute);

    expect(await getTeamRankingPosition(42)).toEqual({ position: null, total: 1, points: 0 });
  });

  it("utilise bien le barème du module de classement", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await getTeamRankingPosition(1);

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toContain(String(RANKING_POINTS_PER_WIN));
    expect(sql).toContain(String(RANKING_POINTS_PER_LOSS));
  });
});

describe("getPlayerStats", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("renvoie un bilan vide pour un joueur sans équipe, sans requête inutile", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.matchesPlayed).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("n'attribue pas au joueur les tournois disputés avant son arrivée", async () => {
    const execute = jest
      .fn()
      // Arrivé le 1er juin 2026.
      .mockResolvedValueOnce([[{ team_id: 5, joined_at: new Date("2026-06-01T00:00:00Z"), left_at: null }]])
      .mockResolvedValueOnce([
        [
          matchRow({ id: 1, tournament_id: 10, played_at: new Date("2026-01-10T18:00:00Z") }),
          matchRow({ id: 2, tournament_id: 11, played_at: new Date("2026-06-10T18:00:00Z") }),
        ],
      ])
      .mockResolvedValueOnce([
        [
          registrationRow({
            tournament_id: 10,
            played_at: new Date("2026-01-11T18:00:00Z"),
            start_at: new Date("2026-01-10T18:00:00Z"),
            finished_at: new Date("2026-01-11T18:00:00Z"),
            final_rank: 1,
          }),
          registrationRow({
            tournament_id: 11,
            played_at: new Date("2026-06-11T18:00:00Z"),
            start_at: new Date("2026-06-10T18:00:00Z"),
            finished_at: new Date("2026-06-11T18:00:00Z"),
            final_rank: 4,
          }),
        ],
      ]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.tournamentsPlayed).toBe(1);
    expect(stats.tournamentsWon).toBe(0);
    expect(stats.matchesPlayed).toBe(1);
  });

  it("crédite un joueur arrivé alors que le tournoi était déjà lancé", async () => {
    const execute = jest
      .fn()
      // Arrivé le 5 juin, tournoi commencé le 1er et terminé le 10.
      .mockResolvedValueOnce([[{ team_id: 5, joined_at: new Date("2026-06-05T00:00:00Z"), left_at: null }]])
      .mockResolvedValueOnce([[matchRow({ id: 1, tournament_id: 10 })]])
      .mockResolvedValueOnce([
        [
          registrationRow({
            tournament_id: 10,
            start_at: new Date("2026-06-01T18:00:00Z"),
            finished_at: new Date("2026-06-10T18:00:00Z"),
          }),
        ],
      ]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.tournamentsPlayed).toBe(1);
    expect(stats.matchesPlayed).toBe(1);
  });

  it("crédite un tournoi encore en cours à tout membre présent", async () => {
    const execute = jest
      .fn()
      // Arrivé bien après le coup d'envoi, mais le tournoi n'est pas terminé.
      .mockResolvedValueOnce([[{ team_id: 5, joined_at: new Date("2026-08-01T00:00:00Z"), left_at: null }]])
      .mockResolvedValueOnce([[matchRow({ id: 1, tournament_id: 10 })]])
      .mockResolvedValueOnce([
        [runningRegistrationRow({ tournament_id: 10, start_at: new Date("2026-06-01T18:00:00Z") })],
      ]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.tournamentsPlayed).toBe(1);
    expect(stats.matchesPlayed).toBe(1);
  });

  it("arrête le décompte au départ du joueur", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          {
            team_id: 5,
            joined_at: new Date("2026-01-01T00:00:00Z"),
            left_at: new Date("2026-03-01T00:00:00Z"),
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          matchRow({ id: 1, tournament_id: 10, played_at: new Date("2026-02-10T18:00:00Z") }),
          matchRow({ id: 2, tournament_id: 11, played_at: new Date("2026-06-10T18:00:00Z") }),
        ],
      ])
      .mockResolvedValueOnce([
        [
          registrationRow({
            tournament_id: 10,
            played_at: new Date("2026-02-11T18:00:00Z"),
            start_at: new Date("2026-02-10T18:00:00Z"),
            finished_at: new Date("2026-02-11T18:00:00Z"),
          }),
          registrationRow({
            tournament_id: 11,
            played_at: new Date("2026-06-11T18:00:00Z"),
            start_at: new Date("2026-06-10T18:00:00Z"),
            finished_at: new Date("2026-06-11T18:00:00Z"),
          }),
        ],
      ]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.matchesPlayed).toBe(1);
    expect(stats.tournamentsPlayed).toBe(1);
  });

  it("cumule les équipes successives du joueur", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          {
            team_id: 5,
            joined_at: new Date("2026-01-01T00:00:00Z"),
            left_at: new Date("2026-03-01T00:00:00Z"),
          },
          { team_id: 6, joined_at: new Date("2026-03-02T00:00:00Z"), left_at: null },
        ],
      ])
      .mockResolvedValueOnce([
        [
          matchRow({ id: 1, tournament_id: 10, team1_id: 5, winner_team_id: 5 }),
          matchRow({
            id: 2,
            tournament_id: 11,
            team1_id: 6,
            team2_id: 9,
            winner_team_id: 9,
            played_at: new Date("2026-06-10T18:00:00Z"),
          }),
        ],
      ])
      .mockResolvedValueOnce([
        [
          registrationRow({
            team_id: 5,
            tournament_id: 10,
            played_at: new Date("2026-02-11T18:00:00Z"),
            start_at: new Date("2026-02-10T18:00:00Z"),
            finished_at: new Date("2026-02-11T18:00:00Z"),
          }),
          registrationRow({
            team_id: 6,
            tournament_id: 11,
            played_at: new Date("2026-06-11T18:00:00Z"),
            start_at: new Date("2026-06-10T18:00:00Z"),
            finished_at: new Date("2026-06-11T18:00:00Z"),
          }),
        ],
      ]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.matchesPlayed).toBe(2);
    expect(stats.matchesWon).toBe(1);
    expect(stats.matchesLost).toBe(1);
    expect(stats.tournamentsPlayed).toBe(2);
  });

  it("ne compte qu'une fois un match opposant deux de ses équipes", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          { team_id: 5, joined_at: new Date("2026-01-01T00:00:00Z"), left_at: null },
          { team_id: 9, joined_at: new Date("2026-01-01T00:00:00Z"), left_at: null },
        ],
      ])
      .mockResolvedValueOnce([[matchRow({ id: 1, team1_id: 5, team2_id: 9, winner_team_id: 5 })]])
      .mockResolvedValueOnce([[registrationRow({ played_at: new Date("2026-06-02T18:00:00Z") })]]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.matchesPlayed).toBe(1);
    expect(stats.matchesWon).toBe(1);
    expect(stats.matchesLost).toBe(0);
  });

  it("ne compte qu'une fois un tournoi disputé par deux de ses équipes, à la meilleure place", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          { team_id: 5, joined_at: new Date("2026-01-01T00:00:00Z"), left_at: null },
          { team_id: 6, joined_at: new Date("2026-01-01T00:00:00Z"), left_at: null },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          registrationRow({ team_id: 5, tournament_id: 10, final_rank: 7 }),
          registrationRow({ team_id: 6, tournament_id: 10, final_rank: 2 }),
        ],
      ]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.tournamentsPlayed).toBe(1);
    expect(stats.bestRank).toBe(2);
  });

  it("dédoublonne les équipes rejointes plusieurs fois", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          {
            team_id: 5,
            joined_at: new Date("2026-01-01T00:00:00Z"),
            left_at: new Date("2026-02-01T00:00:00Z"),
          },
          { team_id: 5, joined_at: new Date("2026-05-01T00:00:00Z"), left_at: null },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await getPlayerStats(42);

    const [, matchParams] = execute.mock.calls[1] as [string, unknown[]];
    expect(matchParams).toEqual([5, 5]);
  });

  it("ignore une période d'absence entre deux passages dans la même équipe", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          {
            team_id: 5,
            joined_at: new Date("2026-01-01T00:00:00Z"),
            left_at: new Date("2026-02-01T00:00:00Z"),
          },
          { team_id: 5, joined_at: new Date("2026-05-01T00:00:00Z"), left_at: null },
        ],
      ])
      .mockResolvedValueOnce([
        [
          matchRow({ id: 1, tournament_id: 10 }),
          matchRow({ id: 2, tournament_id: 11 }),
          matchRow({ id: 3, tournament_id: 12 }),
        ],
      ])
      .mockResolvedValueOnce([
        [
          registrationRow({
            tournament_id: 10,
            played_at: new Date("2026-01-15T18:00:00Z"),
            start_at: new Date("2026-01-14T18:00:00Z"),
            finished_at: new Date("2026-01-15T18:00:00Z"),
          }),
          // Tournoi entièrement joué pendant l'absence du joueur.
          registrationRow({
            tournament_id: 11,
            played_at: new Date("2026-03-15T18:00:00Z"),
            start_at: new Date("2026-03-14T18:00:00Z"),
            finished_at: new Date("2026-03-15T18:00:00Z"),
          }),
          registrationRow({
            tournament_id: 12,
            played_at: new Date("2026-06-15T18:00:00Z"),
            start_at: new Date("2026-06-14T18:00:00Z"),
            finished_at: new Date("2026-06-15T18:00:00Z"),
          }),
        ],
      ]);
    await mockDb(execute);

    const stats = await getPlayerStats(42);

    expect(stats.tournamentsPlayed).toBe(2);
    expect(stats.matchesPlayed).toBe(2);
  });
});
