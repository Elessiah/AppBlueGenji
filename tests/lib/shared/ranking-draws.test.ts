import { describe, expect, it } from "@jest/globals";
import {
  compareRankedTeams,
  isRankedTeam,
  playedMatchSql,
  RANKING_BASE_POINTS,
  RANKING_FLOOR_POINTS,
  RANKING_K_FACTOR,
  rankedPointsOf,
  ratingDrawTransfer,
  ratingTransfer,
  replayRanking,
  type RankedMatch,
} from "@/lib/shared/ranking";

/**
 * Un nul n'est pas un non-évènement au classement : il dit que les deux équipes
 * se valent, ce que les cotes annonçaient peut-être autrement. La favorite en
 * perd donc, son adversaire en gagne autant — mais toujours moins qu'une
 * victoire n'aurait déplacé.
 */
function drawn(matchId: number, first: number, second: number): RankedMatch {
  return {
    matchId,
    winnerTeamId: first,
    loserTeamId: second,
    drawn: true,
    playedAt: `2026-06-${String(matchId).padStart(2, "0")}T18:00:00.000Z`,
  };
}

function decided(matchId: number, winner: number, loser: number): RankedMatch {
  return {
    matchId,
    winnerTeamId: winner,
    loserTeamId: loser,
    playedAt: `2026-06-${String(matchId).padStart(2, "0")}T18:00:00.000Z`,
  };
}

describe("ratingDrawTransfer", () => {
  it("ne déplace rien entre deux cotes égales", () => {
    expect(ratingDrawTransfer(500, 500)).toBe(0);
    expect(ratingDrawTransfer(900, 900)).toBe(0);
  });

  it("prend au favori pour donner à l'outsider", () => {
    // Positif = le premier camp paie.
    expect(ratingDrawTransfer(900, 500)).toBeGreaterThan(0);
    expect(ratingDrawTransfer(500, 900)).toBeLessThan(0);
  });

  it("est antisymétrique : un seul calcul pour les deux camps", () => {
    for (const [a, b] of [
      [500, 900],
      [640, 512],
      [100, 1200],
    ] as const) {
      expect(ratingDrawTransfer(a, b)).toBe(-ratingDrawTransfer(b, a));
    }
  });

  it("reste plus doux qu'une victoire, et par construction", () => {
    // L'écart à l'espérance vaut au plus ½ sur un nul, contre 1 sur une
    // surprise totale : 13 points contre 29 sur l'exemple canonique.
    expect(Math.abs(ratingDrawTransfer(900, 500))).toBe(13);
    expect(ratingTransfer(500, 900)).toBe(29);

    expect(Math.abs(ratingDrawTransfer(100, 1200))).toBeLessThanOrEqual(RANKING_K_FACTOR / 2);
  });
});

describe("replayRanking — matchs nuls", () => {
  it("transfère du mieux coté vers l'autre, quel que soit le side", () => {
    const states = replayRanking([decided(1, 1, 2), drawn(2, 1, 2)]);

    // 1 a battu 2 (cotes égales : ±16), puis ils font nul : 1 rend une part.
    const first = rankedPointsOf(states, 1);
    const second = rankedPointsOf(states, 2);

    expect(first).toBeLessThan(RANKING_BASE_POINTS + 16);
    expect(first).toBeGreaterThan(RANKING_BASE_POINTS);
    expect(first + second).toBe(2 * RANKING_BASE_POINTS);
  });

  it("donne le même résultat quel que soit l'ordre des deux camps", () => {
    const a = replayRanking([decided(1, 1, 2), drawn(2, 1, 2)]);
    const b = replayRanking([decided(1, 1, 2), drawn(2, 2, 1)]);

    expect(rankedPointsOf(a, 1)).toBe(rankedPointsOf(b, 1));
    expect(rankedPointsOf(a, 2)).toBe(rankedPointsOf(b, 2));
  });

  it("ne bouge pas deux cotes égales", () => {
    const states = replayRanking([drawn(1, 1, 2)]);

    expect(rankedPointsOf(states, 1)).toBe(RANKING_BASE_POINTS);
    expect(rankedPointsOf(states, 2)).toBe(RANKING_BASE_POINTS);
  });

  it("compte le nul comme un match joué, à part des victoires et des défaites", () => {
    const states = replayRanking([drawn(1, 1, 2)]);

    expect(states.get(1)).toMatchObject({ wins: 0, losses: 0, draws: 1, matchesPlayed: 1 });
    expect(states.get(2)).toMatchObject({ wins: 0, losses: 0, draws: 1, matchesPlayed: 1 });
  });

  it("respecte le plancher, seule entorse à la conservation du total", () => {
    // Une équipe au plancher qui concède un nul à une équipe bien mieux cotée
    // gagnerait des points ; c'est l'inverse qu'on vérifie ici — le favori qui
    // paie ne peut pas descendre sous le plancher non plus.
    const matches = [
      ...Array.from({ length: 30 }, (_, index) => decided(index + 1, 2, 1)),
      drawn(100, 1, 2),
    ];
    const states = replayRanking(matches);

    expect(rankedPointsOf(states, 1)).toBeGreaterThanOrEqual(RANKING_FLOOR_POINTS);
  });

  it("ne classe pas une équipe sans match, mais classe celle qui n'a fait que des nuls", () => {
    // Sa cote a bougé — ou aurait pu bouger : elle a joué, elle est classée.
    expect(isRankedTeam({ wins: 0, losses: 0, draws: 1 })).toBe(true);
    expect(isRankedTeam({ wins: 0, losses: 0, draws: 0 })).toBe(false);
    // Les vues qui ne portent pas la colonne se lisent comme avant.
    expect(isRankedTeam({ wins: 1, losses: 0 })).toBe(true);
    expect(isRankedTeam({ wins: 0, losses: 0 })).toBe(false);
  });

  it("range une équipe qui n'a fait que des nuls devant une équipe sans match", () => {
    const nulle = { points: RANKING_BASE_POINTS, wins: 0, losses: 0, draws: 2, name: "Aa" };
    const vierge = { points: RANKING_BASE_POINTS, wins: 0, losses: 0, draws: 0, name: "Ab" };

    expect(compareRankedTeams(nulle, vierge)).toBeLessThan(0);
    expect(compareRankedTeams(vierge, nulle)).toBeGreaterThan(0);
  });
});

describe("assiette du classement", () => {
  it("admet le match nul, reconnu à ses deux scores égaux", () => {
    const sql = playedMatchSql();

    expect(sql).toContain("m.winner_team_id IS NOT NULL");
    expect(sql).toContain("m.team1_score = m.team2_score");
    // Un match clos sans vainqueur *ni* score n'est pas un nul : la condition
    // exige les deux colonnes renseignées.
    expect(sql).toContain("m.team1_score IS NOT NULL");
    expect(sql).toContain("m.team2_score IS NOT NULL");
  });

  it("écarte toujours byes et matchs fantômes", () => {
    const sql = playedMatchSql();

    expect(sql).toContain("m.is_bye = 0");
    expect(sql).toContain("m.team1_id IS NOT NULL");
    expect(sql).toContain("m.team2_id IS NOT NULL");
  });
});
