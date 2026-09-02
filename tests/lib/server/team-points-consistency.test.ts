import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listTeams } from "@/lib/server/teams-service";
import { getTeamEntityStats } from "@/lib/server/stats-service";
import { getTeamRankingPosition, loadTeamRanking } from "@/lib/server/ranking-service";
import { getLandingLeaderboard } from "@/lib/server/landing-service";
import { clearCache } from "@/lib/server/cache";
import { RANKING_BASE_POINTS } from "@/lib/shared/ranking";

jest.mock("@/lib/server/database");

/**
 * Les « points » d'une équipe s'affichent à trois endroits : la carte de
 * l'annuaire `/equipes`, la tuile « Points de classement » de sa fiche, et le
 * leaderboard de la landing. Ils venaient de trois requêtes différentes, avec
 * trois définitions différentes de la victoire.
 *
 * Le passage à une cote de type Elo aurait pu les faire diverger de nouveau, et
 * bien plus discrètement : une somme se recompose de tête, une cote non — deux
 * rejeux sur deux assiettes rendent deux nombres tous les deux vraisemblables.
 *
 * Ce fichier tient l'égalité par le seul bout qui compte : un jeu de matchs, et
 * le même nombre lu partout. Il échoue dès qu'une des vues se remet à calculer
 * de son côté.
 */

const TEAM_ID = 12;

/** Un match du site, tel que la base le stocke. */
type RawMatch = {
  id: number;
  winnerTeamId: number;
  opponentId: number;
  /** Un bye ou un match fantôme n'a pas été joué : il ne compte nulle part. */
  played: boolean;
};

/**
 * Trois matchs joués (2 gagnés, 1 perdu), plus deux rencontres que le moteur a
 * posées sans qu'elles soient jouées : un bye et un match fantôme. Les compter
 * était précisément ce qui faisait diverger l'annuaire de la fiche.
 */
const MATCHES: RawMatch[] = [
  { id: 1, winnerTeamId: TEAM_ID, opponentId: 20, played: true },
  { id: 2, winnerTeamId: 21, opponentId: 21, played: true },
  { id: 3, winnerTeamId: TEAM_ID, opponentId: 22, played: true },
  { id: 4, winnerTeamId: TEAM_ID, opponentId: 23, played: false },
  { id: 5, winnerTeamId: TEAM_ID, opponentId: 24, played: false },
];

const PLAYED = MATCHES.filter((match) => match.played);
const EXPECTED_WINS = PLAYED.filter((match) => match.winnerTeamId === TEAM_ID).length;
const EXPECTED_LOSSES = PLAYED.length - EXPECTED_WINS;

function teamRow() {
  return {
    id: TEAM_ID,
    name: "Dragon Squad",
    tag: "DRG",
    logo_url: null,
    created_at: new Date("2026-01-15T10:00:00.000Z"),
    is_ghost: 0,
    members_count: 6,
  };
}

/** Identités servies au classement : l'équipe et ses adversaires. */
function identityRows() {
  return [
    { id: TEAM_ID, name: "Dragon Squad", logo_url: null },
    ...PLAYED.map((match) => ({
      id: match.opponentId,
      name: `Adversaire ${match.opponentId}`,
      logo_url: null,
    })),
  ];
}

/** Rencontres comptées, telles que la requête de rejeu les rend. */
function replayRows() {
  return PLAYED.map((match) => ({
    id: match.id,
    team1_id: TEAM_ID,
    team2_id: match.opponentId,
    winner_team_id: match.winnerTeamId,
    played_at: new Date(`2026-06-0${match.id}T18:00:00Z`),
  }));
}

/** Lignes de matchs telles que les lit le bloc de statistiques de la fiche. */
function matchRows() {
  return PLAYED.map((match) => ({
    id: match.id,
    tournament_id: 100,
    tournament_name: "Test - Coupe",
    game: "OW2",
    format: "SINGLE",
    bracket: "UPPER",
    played_at: new Date(`2026-06-0${match.id}T18:00:00Z`),
    team1_id: TEAM_ID,
    team2_id: match.opponentId,
    team1_name: "Dragon Squad",
    team2_name: `Adversaire ${match.opponentId}`,
    team1_score: match.winnerTeamId === TEAM_ID ? 2 : 0,
    team2_score: match.winnerTeamId === TEAM_ID ? 0 : 2,
    winner_team_id: match.winnerTeamId,
    forfeit_team_id: null,
  }));
}

/**
 * Une seule base pour tous les services : l'annuaire, la fiche et le
 * leaderboard lisent bien la même fixture. Le routage se fait sur le SQL — pas
 * sur l'ordre des appels, qui n'a pas à être figé par un test.
 */
async function mockDb() {
  const execute = jest.fn(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("AS members_count")) return [[teamRow()]];
    if (text.includes("AS played_at")) return [replayRows()];
    if (text.includes("FROM bg_teams") && text.includes("solo_user_id IS NULL")) {
      return [identityRows()];
    }
    if (text.includes("t1.name AS team1_name")) return [matchRows()];
    if (text.includes("r.final_rank")) return [[]];
    return [[]];
  });
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
  return execute;
}

describe("points d'équipe — annuaire, fiche, classement et leaderboard", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    clearCache();
    await mockDb();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clearCache();
  });

  it("affiche la même cote sur la carte d'annuaire et sur la fiche", async () => {
    const [card] = await listTeams();
    const ranking = await getTeamRankingPosition(TEAM_ID);

    expect(card.points).toBe(ranking.points);
    // Deux victoires et une défaite : l'équipe est au-dessus de la cote de
    // départ, et son total n'est pas un multiple d'un barème additif.
    expect(card.points).toBeGreaterThan(RANKING_BASE_POINTS);
  });

  it("affiche la même cote sur le leaderboard de la landing", async () => {
    const [card] = await listTeams();
    const leaderboard = await getLandingLeaderboard(8);

    expect(leaderboard.find((row) => row.teamId === TEAM_ID)!.points).toBe(card.points);
  });

  it("affiche le même bilan de matchs partout", async () => {
    const [card] = await listTeams();
    const { stats } = await getTeamEntityStats(TEAM_ID);
    const ranking = await loadTeamRanking();
    const row = ranking.find((entry) => entry.teamId === TEAM_ID)!;

    expect([card.wins, card.losses]).toEqual([stats.matchesWon, stats.matchesLost]);
    expect([row.wins, row.losses]).toEqual([EXPECTED_WINS, EXPECTED_LOSSES]);
  });

  it("donne à la place au classement la cote affichée sur la même fiche", async () => {
    const ranking = await getTeamRankingPosition(TEAM_ID);
    const rows = await loadTeamRanking();

    expect(ranking.points).toBe(rows.find((row) => row.teamId === TEAM_ID)!.points);
    expect(ranking.position).toBe(rows.findIndex((row) => row.teamId === TEAM_ID) + 1);
  });

  // Les byes et les matchs fantômes sont posés par le moteur : ils ne
  // gonflaient pas seulement le total, ils le faisaient diverger d'une vue à
  // l'autre puisqu'une seule des deux requêtes les écartait.
  it("écarte byes et matchs fantômes de l'assiette du classement", async () => {
    const execute = await mockDb();
    await listTeams();

    const replay = execute.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("AS played_at"))!;
    expect(replay).toContain("m.is_bye = 0");
    expect(replay).toContain("m.team2_id IS NOT NULL");
    expect(replay).toContain("m.status = 'COMPLETED'");
  });

  // Le bug d'origine : les victoires étaient agrégées dans la même requête que
  // la jointure des membres, donc multipliées par l'effectif.
  it("ne compte pas le bilan dans la requête qui joint les membres", async () => {
    const execute = await mockDb();
    await listTeams();

    const teamQuery = execute.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("AS members_count"))!;
    expect(teamQuery).toContain("bg_team_members");
    expect(teamQuery).not.toContain("bg_matches");
  });

  it("ne recalcule aucun barème dans la carte d'annuaire", async () => {
    const [card] = await listTeams();

    // L'ancien barème additif (3 par victoire, +1 par défaite, puis 100/−20)
    // ne doit plus produire aucun des nombres affichés.
    expect(card.points).not.toBe(EXPECTED_WINS * 3 + EXPECTED_LOSSES);
    expect(card.points).not.toBe(EXPECTED_WINS * 100 - EXPECTED_LOSSES * 20);
  });

  it("laisse à la cote de départ une équipe qui n'a encore rien joué", async () => {
    const { getDatabase } = await import("@/lib/server/database");
    (getDatabase as jest.Mock).mockResolvedValue({
      execute: jest.fn(async (sql: unknown) => {
        const text = String(sql);
        if (text.includes("AS members_count")) return [[teamRow()]];
        if (text.includes("FROM bg_teams") && text.includes("solo_user_id IS NULL")) {
          return [[{ id: TEAM_ID, name: "Dragon Squad", logo_url: null }]];
        }
        return [[]];
      }),
    });

    const [card] = await listTeams();

    expect([card.points, card.wins, card.losses, card.form]).toEqual([
      RANKING_BASE_POINTS,
      0,
      0,
      [],
    ]);
  });
});
