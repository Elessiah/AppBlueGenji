import { describe, expect, it } from "@jest/globals";
import {
  compareRankedTeams,
  PLAYED_MATCH_SQL,
  playedMatchSql,
  RANKING_POINTS_PER_LOSS,
  RANKING_POINTS_PER_WIN,
  rankingLossesSql,
  rankingMatchJoinSql,
  rankingPoints,
  rankingPointsForTeamSql,
  rankingPointsSql,
  rankingWinsSql,
} from "@/lib/shared/ranking";

/**
 * Le module porte deux choses qui doivent rester ensemble : le **barème**
 * (combien vaut une victoire) et l'**assiette** (quels matchs comptent). Un
 * barème partagé posé sur deux assiettes différentes rend encore deux nombres
 * différents — c'est ce qui séparait l'annuaire des fiches.
 */
describe("barème", () => {
  it("récompense la victoire et pénalise la défaite", () => {
    expect(rankingPoints(1, 0)).toBe(RANKING_POINTS_PER_WIN);
    expect(rankingPoints(0, 1)).toBe(RANKING_POINTS_PER_LOSS);
    expect(RANKING_POINTS_PER_LOSS).toBeLessThan(0);
  });

  it("part de zéro pour une équipe sans match", () => {
    expect(rankingPoints(0, 0)).toBe(0);
  });

  it("peut descendre sous zéro", () => {
    expect(rankingPoints(0, 3)).toBeLessThan(0);
  });

  it("dit la même chose en SQL qu'en TypeScript", () => {
    expect(rankingPointsSql("w", "l")).toBe(
      `((w) * ${RANKING_POINTS_PER_WIN} + (l) * ${RANKING_POINTS_PER_LOSS})`,
    );
  });
});

describe("assiette", () => {
  it("écarte byes, matchs fantômes et rencontres non tranchées", () => {
    const sql = playedMatchSql();
    expect(sql).toContain("m.status = 'COMPLETED'");
    expect(sql).toContain("m.is_bye = 0");
    expect(sql).toContain("m.team1_id IS NOT NULL");
    expect(sql).toContain("m.team2_id IS NOT NULL");
    expect(sql).toContain("m.winner_team_id IS NOT NULL");
  });

  it("suit l'alias de la requête appelante", () => {
    expect(playedMatchSql("mm")).toContain("mm.is_bye = 0");
    expect(playedMatchSql("mm")).not.toContain(" m.is_bye");
  });

  it("expose la variante par défaut sous forme de constante", () => {
    expect(PLAYED_MATCH_SQL).toBe(playedMatchSql("m"));
  });

  it("joint une équipe à ses seuls matchs comptés", () => {
    const join = rankingMatchJoinSql("t.id");
    expect(join).toContain("m.team1_id = t.id OR m.team2_id = t.id");
    expect(join).toContain("m.is_bye = 0");
  });
});

describe("agrégats", () => {
  it("compte une victoire quand l'équipe est la gagnante", () => {
    expect(rankingWinsSql("t.id")).toContain("m.winner_team_id = t.id");
  });

  // Le moteur pose parfois un vainqueur sans renseigner le perdant : compter
  // `loser_team_id` faisait diverger le rang du total de points.
  it("compte une défaite dès que l'équipe n'a pas gagné, sans lire `loser_team_id`", () => {
    const sql = rankingLossesSql("t.id");
    expect(sql).toContain("m.winner_team_id <> t.id");
    expect(sql).not.toContain("loser_team_id");
  });

  it("neutralise l'absence de match (LEFT JOIN) plutôt que de rendre NULL", () => {
    expect(rankingWinsSql("t.id")).toContain("COALESCE(");
    expect(rankingLossesSql("t.id")).toContain("COALESCE(");
    expect(rankingLossesSql("t.id")).toContain("m.winner_team_id IS NOT NULL");
  });

  it("compose les points d'une équipe à partir du barème et des agrégats", () => {
    expect(rankingPointsForTeamSql("t.id")).toBe(
      rankingPointsSql(rankingWinsSql("t.id"), rankingLossesSql("t.id")),
    );
  });

  it("suit l'alias de matchs sur toute la chaîne", () => {
    const sql = rankingPointsForTeamSql("r.team_id", "mm");
    expect(sql).toContain("mm.winner_team_id = r.team_id");
    expect(sql).not.toContain(" m.winner_team_id");
  });
});

describe("ordre du classement", () => {
  const team = (name: string, points: number, wins: number) => ({ name, points, wins });

  it("classe d'abord aux points", () => {
    expect(compareRankedTeams(team("A", 300, 3), team("B", 100, 1))).toBeLessThan(0);
  });

  it("départage à égalité de points par les victoires", () => {
    // 4 victoires et 5 défaites valent autant que 3 victoires : c'est le
    // volume de victoires qui tranche.
    expect(compareRankedTeams(team("A", 300, 4), team("B", 300, 3))).toBeLessThan(0);
  });

  it("départage enfin par le nom, accents compris", () => {
    expect(compareRankedTeams(team("Étoile", 0, 0), team("Zulu", 0, 0))).toBeLessThan(0);
  });

  it("est stable pour deux équipes identiques", () => {
    expect(compareRankedTeams(team("A", 100, 1), team("A", 100, 1))).toBe(0);
  });

  it("trie une liste entière comme le fait chaque vue", () => {
    const rows = [team("Zulu", 100, 1), team("Bravo", 300, 3), team("Alpha", 300, 3)];
    expect([...rows].sort(compareRankedTeams).map((row) => row.name)).toEqual([
      "Alpha",
      "Bravo",
      "Zulu",
    ]);
  });
});
