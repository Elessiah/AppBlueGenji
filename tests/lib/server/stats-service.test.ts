import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  getPlayerEntityStats,
  getPlayerStats,
  getTeamEntityStats,
  getTeamRankingPosition,
  getTeamStats,
  loadTeamRanking,
} from "@/lib/server/stats-service";
import {
  RANKING_POINTS_PER_LOSS,
  RANKING_POINTS_PER_WIN,
  rankingPoints,
} from "@/lib/shared/ranking";

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
    match_format_type: null,
    match_format_value: null,
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

  it("compte un forfait comme une victoire pleine, séries comprises", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [matchRow({ id: 1, forfeit_team_id: 9, winner_team_id: 5, team1_score: null, team2_score: null })],
      ])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const stats = await getTeamStats(5);

    expect(stats.matchesPlayed).toBe(1);
    expect(stats.matchesWon).toBe(1);
    expect(stats.currentStreak).toEqual({ kind: "WIN", length: 1 });
    expect(stats.favouriteOpponent).toMatchObject({ teamId: 9, won: 1 });
  });

  it("chiffre le bilan de maps d'un forfait au score plein du format", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          matchRow({
            id: 1,
            forfeit_team_id: 9,
            winner_team_id: 5,
            // Colonnes vides : c'est le cas des forfaits enregistrés avant que
            // la règle ne s'écrive en base.
            team1_score: null,
            team2_score: null,
            match_format_type: "FT",
            match_format_value: 3,
          }),
        ],
      ])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const stats = await getTeamStats(5);

    expect(stats.mapsWon).toBe(3);
    expect(stats.mapsLost).toBe(0);
  });

  it("compte 1-0 pour un forfait dans un tournoi en saisie libre", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [
          matchRow({
            id: 1,
            forfeit_team_id: 5,
            winner_team_id: 9,
            team1_score: null,
            team2_score: null,
          }),
        ],
      ])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const stats = await getTeamStats(5);

    expect(stats.mapsWon).toBe(0);
    expect(stats.mapsLost).toBe(1);
  });

  it("lit le format du tournoi dans la requête de matchs", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await getTeamStats(5);

    const [sql] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/t\.match_format_type/);
    expect(sql).toMatch(/t\.match_format_value/);
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

  // Tournois individuels : l'engagé du joueur est son entrée solo, pas une
  // équipe. Sans elle dans les engagements, ces tournois sortiraient du bilan.
  it("compte l'entrée solo du joueur parmi ses engagements", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await getPlayerEntityStats(42);

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM bg_team_members/);
    expect(sql).toMatch(/UNION ALL/);
    expect(sql).toMatch(/WHERE solo_user_id = \?/);
    // Appartenance ouverte : le joueur « est » son entrée solo pour toujours.
    expect(sql).toMatch(/NULL AS left_at/);
    expect(params).toEqual([42, 42]);
  });

  it("crédite un tournoi joué en individuel via l'entrée solo", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [{ team_id: 77, joined_at: new Date("2026-01-01T00:00:00Z"), left_at: null }],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[registrationRow({ team_id: 77, tournament_id: 12 })]]);
    await mockDb(execute);

    const { tournaments } = await getPlayerEntityStats(42);

    expect(tournaments.map((entry) => entry.tournamentId)).toEqual([12]);
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

/** Ligne de classement telle que la rend la requête partagée. */
function rankingRow(teamId: number, wins: number, losses: number, name = `Test - ${teamId}`) {
  return { team_id: teamId, team_name: name, logo_url: null, wins, losses };
}

describe("getTeamRankingPosition", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("place l'équipe d'après le barème partagé", async () => {
    const execute = jest.fn().mockResolvedValueOnce([
      [rankingRow(1, 5, 0), rankingRow(5, 3, 0), rankingRow(7, 9, 0)],
    ]);
    await mockDb(execute);

    expect(await getTeamRankingPosition(5)).toEqual({
      position: 3,
      total: 3,
      points: rankingPoints(3, 0),
    });
  });

  it("donne le même rang à deux équipes à égalité", async () => {
    const rows = [rankingRow(1, 9, 0), rankingRow(5, 3, 0), rankingRow(7, 3, 0)];
    await mockDb(jest.fn().mockResolvedValueOnce([rows]));
    const first = await getTeamRankingPosition(5);
    await mockDb(jest.fn().mockResolvedValueOnce([rows]));
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

  // Une entrée solo n'est pas une équipe : la laisser dans le classement
  // décalerait le rang de toutes les équipes et gonflerait le total.
  it("exclut les entrées solo du classement des équipes", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await getTeamRankingPosition(1);

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toMatch(/WHERE t\.solo_user_id IS NULL/);
  });

  it("ne classe pas une équipe sans aucun match joué", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[rankingRow(1, 1, 0)]]);
    await mockDb(execute);

    expect(await getTeamRankingPosition(42)).toEqual({ position: null, total: 1, points: 0 });
  });

  // Une équipe sans match ne doit pas apparaître au classement de la fiche :
  // c'est la jointure interne qui l'écarte, pas un filtre en mémoire.
  it("n'inclut que les équipes ayant joué", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await getTeamRankingPosition(1);

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).not.toContain("LEFT JOIN bg_matches");
  });

  it("utilise bien le barème du module de classement", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[rankingRow(1, 2, 3)]]);
    await mockDb(execute);

    const { points } = await getTeamRankingPosition(1);

    expect(points).toBe(2 * RANKING_POINTS_PER_WIN + 3 * RANKING_POINTS_PER_LOSS);
  });
});

describe("loadTeamRanking", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("trie par points, puis victoires, puis nom", async () => {
    await mockDb(
      jest.fn().mockResolvedValueOnce([
        [
          rankingRow(1, 1, 0, "Zulu"),
          rankingRow(2, 3, 0, "Bravo"),
          rankingRow(3, 3, 0, "Alpha"),
          rankingRow(4, 4, 5, "Charlie"),
        ],
      ]),
    );

    const rows = await loadTeamRanking();

    // 3 victoires (300) devant 4 victoires et 5 défaites (300 aussi, mais plus
    // de victoires ⇒ devant), puis l'ordre alphabétique départage les deux
    // équipes à trois victoires.
    expect(rows.map((row) => row.teamName)).toEqual(["Charlie", "Alpha", "Bravo", "Zulu"]);
  });

  it("garde les équipes sans match quand on le demande", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[rankingRow(1, 0, 0)]]);
    await mockDb(execute);

    const rows = await loadTeamRanking({ includeUnplayed: true });

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toContain("LEFT JOIN bg_matches");
    expect(rows).toEqual([
      { teamId: 1, teamName: "Test - 1", logoUrl: null, wins: 0, losses: 0, points: 0 },
    ]);
  });

  it("borne les matchs retenus quand une date est fournie", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const before = new Date("2026-01-01T00:00:00Z");
    await loadTeamRanking({ includeUnplayed: true, completedBefore: before });

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("m.updated_at < ?");
    expect(params).toEqual([before]);
  });

  it("ne borne rien, et ne lie aucun paramètre, sans date", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await loadTeamRanking();

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("m.updated_at");
    expect(params).toEqual([]);
  });

  it("tolère des agrégats absents", async () => {
    await mockDb(
      jest
        .fn()
        .mockResolvedValueOnce([[{ team_id: 1, team_name: "Test - 1", logo_url: null, wins: null, losses: null }]]),
    );

    expect(await loadTeamRanking()).toEqual([
      { teamId: 1, teamName: "Test - 1", logoUrl: null, wins: 0, losses: 0, points: 0 },
    ]);
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
