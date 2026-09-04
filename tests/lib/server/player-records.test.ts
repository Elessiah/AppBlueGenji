import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import { getPlayerStats, loadPlayerRecords } from "@/lib/server/stats-service";

jest.mock("@/lib/server/database");

/**
 * Le bilan de la carte d'annuaire `/joueurs` descend du **même chargeur** que
 * la fiche.
 *
 * Trois divergences vivaient dans la requête maison qu'il remplace, et elles se
 * voyaient à l'œil nu en ouvrant la fiche du même joueur :
 *
 * 1. elle comptait les byes et les matchs fantômes ;
 * 2. elle lisait les défaites sur `loser_team_id`, que le moteur ne renseigne
 *    pas toujours ;
 * 3. elle ignorait les fenêtres d'appartenance, et comptait comme « tournois »
 *    de simples inscriptions à des tournois pas encore lancés.
 *
 * Un barème partagé n'aurait pas suffi : posé sur deux assiettes différentes,
 * il rend encore deux nombres. D'où l'ancre du dernier test — la carte et la
 * fiche lisent le même agrégat.
 */

type Row = Record<string, unknown>;

const JOINED = new Date("2026-01-01T00:00:00Z");

function membershipRow(userId: number, teamId: number, overrides: Row = {}): Row {
  return { user_id: userId, team_id: teamId, joined_at: JOINED, left_at: null, ...overrides };
}

function matchRow(overrides: Row = {}): Row {
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

function registrationRow(overrides: Row = {}): Row {
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

/**
 * Base factice routée **par le SQL**. Le chargeur émet trois requêtes dont
 * l'ordre n'a pas à être figé par un test, et les deux dernières partent en
 * parallèle.
 */
function fakeDb(memberships: Row[], matches: Row[], registrations: Row[]) {
  return jest.fn(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("FROM bg_team_members")) return [memberships];
    if (text.includes("FROM bg_matches")) return [matches];
    if (text.includes("FROM bg_tournament_registrations")) return [registrations];
    return [[]];
  });
}

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
  return execute;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe("loadPlayerRecords", () => {
  it("ne lit rien pour une liste vide", async () => {
    const execute = await mockDb(fakeDb([], [], []));

    expect(await loadPlayerRecords([])).toEqual(new Map());
    expect(execute).not.toHaveBeenCalled();
  });

  it("s'arrête après les appartenances quand personne n'a d'équipe", async () => {
    const execute = await mockDb(fakeDb([], [], []));

    expect(await loadPlayerRecords([7])).toEqual(new Map());
    expect(execute).toHaveBeenCalledTimes(1);
  });

  // Le filtre vit DANS chaque branche de l'union : une table dérivée n'a pas
  // d'index, et filtrer à l'extérieur ferait scanner toutes les adhésions.
  it("filtre les appartenances dans les deux branches de l'union", async () => {
    const execute = await mockDb(fakeDb([], [], []));

    await loadPlayerRecords([7, 9]);

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM bg_team_members\s+WHERE user_id IN \(\?, \?\)/);
    expect(sql).toMatch(/FROM bg_teams\s+WHERE solo_user_id IN \(\?, \?\)/);
    expect(params).toEqual([7, 9, 7, 9]);
  });

  // Trois requêtes pour toute la page, quel que soit le nombre de joueurs.
  it("tient en trois requêtes quel que soit l'effectif listé", async () => {
    const execute = await mockDb(
      fakeDb(
        [membershipRow(7, 5), membershipRow(9, 6), membershipRow(11, 7)],
        [matchRow()],
        [registrationRow()],
      ),
    );

    await loadPlayerRecords([7, 9, 11]);

    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("compte victoires, défaites et tournois disputés", async () => {
    await mockDb(
      fakeDb(
        [membershipRow(7, 5)],
        [
          matchRow({ id: 1, winner_team_id: 5 }),
          matchRow({ id: 2, winner_team_id: 9 }),
          matchRow({ id: 3, winner_team_id: 5 }),
        ],
        [registrationRow()],
      ),
    );

    expect((await loadPlayerRecords([7])).get(7)).toEqual({
      wins: 2,
      losses: 1,
      tournamentsPlayed: 1,
    });
  });

  it("rend un bilan vide pour un joueur dont les équipes n'ont rien joué", async () => {
    await mockDb(fakeDb([membershipRow(7, 5), membershipRow(9, 6)], [], []));

    expect((await loadPlayerRecords([7, 9])).get(9)).toEqual({
      wins: 0,
      losses: 0,
      tournamentsPlayed: 0,
    });
  });

  it("ne prête à un joueur que les matchs de ses propres équipes", async () => {
    await mockDb(
      fakeDb(
        [membershipRow(7, 5), membershipRow(9, 6)],
        [
          matchRow({ id: 1, team1_id: 5, team2_id: 9, winner_team_id: 5 }),
          matchRow({ id: 2, team1_id: 6, team2_id: 9, winner_team_id: 9 }),
        ],
        [registrationRow(), registrationRow({ team_id: 6, tournament_id: 11 })],
      ),
    );

    const records = await loadPlayerRecords([7, 9]);
    expect(records.get(7)).toMatchObject({ wins: 1, losses: 0 });
    expect(records.get(9)).toMatchObject({ wins: 0, losses: 1 });
  });

  // Une inscription à un tournoi pas encore lancé n'est pas un tournoi joué.
  it("ne compte pas une inscription à un tournoi qui n'a pas commencé", async () => {
    await mockDb(
      fakeDb(
        [membershipRow(7, 5)],
        [],
        [
          registrationRow(),
          registrationRow({
            tournament_id: 11,
            state: "REGISTRATION",
            final_rank: null,
            finished_at: null,
          }),
        ],
      ),
    );

    expect((await loadPlayerRecords([7])).get(7)?.tournamentsPlayed).toBe(1);
  });

  // La fenêtre d'appartenance : rejoindre une équipe titrée ne donne pas son
  // palmarès, mais arriver en cours de tournoi compte bien.
  it("respecte les fenêtres d'appartenance", async () => {
    await mockDb(
      fakeDb(
        // Arrivé après la fin du tournoi de juin.
        [membershipRow(7, 5, { joined_at: new Date("2026-08-01T00:00:00Z") })],
        [matchRow()],
        [registrationRow()],
      ),
    );

    expect((await loadPlayerRecords([7])).get(7)).toEqual({
      wins: 0,
      losses: 0,
      tournamentsPlayed: 0,
    });
  });

  it("crédite un joueur arrivé en cours de tournoi", async () => {
    await mockDb(
      fakeDb(
        [membershipRow(7, 5, { joined_at: new Date("2026-06-02T00:00:00Z") })],
        [matchRow()],
        [registrationRow()],
      ),
    );

    expect((await loadPlayerRecords([7])).get(7)).toMatchObject({
      wins: 1,
      tournamentsPlayed: 1,
    });
  });

  // L'entrée solo d'un tournoi individuel est une appartenance ouverte : sans
  // elle, un tournoi joué en solo disparaîtrait du bilan.
  it("compte l'entrée solo comme une appartenance", async () => {
    await mockDb(
      fakeDb(
        [membershipRow(7, 42, { joined_at: new Date("2026-05-01T00:00:00Z") })],
        [matchRow({ team1_id: 42, winner_team_id: 42 })],
        [registrationRow({ team_id: 42 })],
      ),
    );

    expect((await loadPlayerRecords([7])).get(7)).toMatchObject({ wins: 1 });
  });
});

/**
 * L'ancre : le même joueur, les mêmes lignes, et les deux pages doivent
 * annoncer le même bilan. C'est ce test qui casserait si l'annuaire se remettait
 * à compter pour son compte.
 */
describe("carte d'annuaire et fiche", () => {
  it("annoncent le même bilan pour le même joueur", async () => {
    const memberships = [membershipRow(7, 5)];
    const matches = [
      matchRow({ id: 1, winner_team_id: 5 }),
      matchRow({ id: 2, winner_team_id: 9 }),
    ];
    const registrations = [
      registrationRow(),
      registrationRow({ tournament_id: 11, state: "UPCOMING", finished_at: null }),
    ];

    await mockDb(fakeDb(memberships, matches, registrations));
    const record = (await loadPlayerRecords([7])).get(7)!;

    await mockDb(fakeDb(memberships, matches, registrations));
    const stats = await getPlayerStats(7);

    expect(record).toEqual({
      wins: stats.matchesWon,
      losses: stats.matchesLost,
      tournamentsPlayed: stats.tournamentsPlayed,
    });
  });
});
