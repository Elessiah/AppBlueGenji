import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listTeams } from "@/lib/server/teams-service";
import { getTeamEntityStats, getTeamRankingPosition } from "@/lib/server/stats-service";
import { rankingPoints } from "@/lib/shared/ranking";

jest.mock("@/lib/server/database");

/**
 * Les « points » d'une équipe s'affichent à trois endroits : la carte de
 * l'annuaire `/equipes`, la tuile « Points de classement » de sa fiche, et le
 * leaderboard de la landing. Ils venaient de trois requêtes différentes, avec
 * trois définitions différentes de la victoire — l'annuaire en était réduit à
 * afficher, pour une équipe de six joueurs, six fois ses victoires, comptées
 * 3 points l'unité et **+1 par défaite**.
 *
 * Ce fichier tient l'égalité par le seul bout qui compte : un jeu de matchs, et
 * le même nombre lu des deux côtés. Il échoue dès qu'une des vues se remet à
 * calculer de son côté.
 */

const TEAM_ID = 12;

/** Un match du site, tel que la base le stocke. */
type RawMatch = {
  id: number;
  winnerTeamId: number | null;
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

/** Ligne de classement : l'agrégat que rend la requête partagée. */
function rankingRows() {
  return [
    {
      team_id: TEAM_ID,
      team_name: "Dragon Squad",
      logo_url: null,
      wins: EXPECTED_WINS,
      losses: EXPECTED_LOSSES,
    },
  ];
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
 * Une seule base pour les deux services : `teams-service` appelle réellement
 * `stats-service`, donc l'annuaire et la fiche lisent bien la même fixture.
 * Le routage se fait sur le SQL — pas sur l'ordre des appels, qui n'a pas à
 * être figé par un test.
 */
async function mockDb() {
  const execute = jest.fn(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("AS members_count")) return [[teamRow()]];
    if (text.includes("AS wins")) return [rankingRows()];
    if (text.includes("t1.name AS team1_name")) return [matchRows()];
    if (text.includes("r.final_rank")) return [[]];
    return [[]];
  });
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
  return execute;
}

describe("points d'équipe — annuaire, fiche et classement", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("affiche le même total de points sur la carte d'annuaire et sur la fiche", async () => {
    await mockDb();
    const [card] = await listTeams();

    await mockDb();
    const { stats } = await getTeamEntityStats(TEAM_ID);

    expect(card.points).toBe(stats.rankingPoints);
    expect(card.points).toBe(rankingPoints(EXPECTED_WINS, EXPECTED_LOSSES));
  });

  it("affiche le même bilan de matchs des deux côtés", async () => {
    await mockDb();
    const [card] = await listTeams();

    await mockDb();
    const { stats } = await getTeamEntityStats(TEAM_ID);

    expect([card.wins, card.losses]).toEqual([stats.matchesWon, stats.matchesLost]);
  });

  it("donne à la place au classement les points affichés sur la même fiche", async () => {
    await mockDb();
    const ranking = await getTeamRankingPosition(TEAM_ID);

    await mockDb();
    const { stats } = await getTeamEntityStats(TEAM_ID);

    expect(ranking.points).toBe(stats.rankingPoints);
  });

  // Les byes et les matchs fantômes sont posés par le moteur : ils ne
  // gonflaient pas seulement le total, ils le faisaient diverger d'une vue à
  // l'autre puisqu'une seule des deux requêtes les écartait.
  it("écarte byes et matchs fantômes de l'assiette de l'annuaire", async () => {
    const execute = await mockDb();
    await listTeams();

    const ranking = execute.mock.calls.map((call) => String(call[0])).find((sql) => sql.includes("AS wins"))!;
    expect(ranking).toContain("m.is_bye = 0");
    expect(ranking).toContain("m.team2_id IS NOT NULL");
    expect(ranking).toContain("m.status = 'COMPLETED'");
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
    await mockDb();
    const [card] = await listTeams();

    // L'ancien barème (3 par victoire, +1 par défaite) donnerait 7 ici.
    expect(card.points).not.toBe(EXPECTED_WINS * 3 + EXPECTED_LOSSES);
    expect(card.points).toBe(200 - 20);
  });

  it("laisse à 0 point une équipe qui n'a encore rien joué", async () => {
    const { getDatabase } = await import("@/lib/server/database");
    (getDatabase as jest.Mock).mockResolvedValue({
      execute: jest.fn(async (sql: unknown) => {
        if (String(sql).includes("AS members_count")) return [[teamRow()]];
        return [[]];
      }),
    });

    const [card] = await listTeams();

    expect([card.points, card.wins, card.losses, card.form]).toEqual([0, 0, 0, []]);
  });
});
