import { describe, expect, it } from "@jest/globals";
import {
  baseRankedTeamState,
  compareRankedMatches,
  compareRankedTeams,
  expectedScore,
  isRankedTeam,
  PLAYED_MATCH_SQL,
  playedMatchSql,
  RANKING_BASE_POINTS,
  RANKING_FLOOR_POINTS,
  RANKING_K_FACTOR,
  RANKING_POINTS_HINT,
  RANKING_POINTS_LABEL,
  RANKING_SCALE,
  RANKING_UNRANKED_HINT,
  rankedPointsOf,
  rankingMatchJoinSql,
  ratingTransfer,
  replayRanking,
  type RankedMatch,
} from "@/lib/shared/ranking";

/**
 * Le classement du site est une **cote de type Elo** : chaque match transfère
 * des points du perdant au vainqueur, d'autant plus que le résultat était
 * improbable. Le module porte donc trois choses qui doivent rester ensemble :
 * la **formule**, l'**assiette** (quels matchs comptent) et l'**ordre** de tri.
 */

/** Fabrique un match du rejeu. Les dates montent avec l'identifiant. */
function played(
  matchId: number,
  winnerTeamId: number,
  loserTeamId: number,
  playedAt = `2026-06-${String(matchId).padStart(2, "0")}T18:00:00.000Z`,
): RankedMatch {
  return { matchId, winnerTeamId, loserTeamId, playedAt };
}

describe("cote de départ", () => {
  it("part de 500 pour tout le monde", () => {
    expect(RANKING_BASE_POINTS).toBe(500);
    expect(baseRankedTeamState()).toEqual({
      points: 500,
      wins: 0,
      losses: 0,
      matchesPlayed: 0,
    });
  });

  it("rend la cote de départ pour une équipe absente du rejeu", () => {
    expect(rankedPointsOf(new Map(), 42)).toBe(RANKING_BASE_POINTS);
  });

  it("rend la cote rejouée pour une équipe qui a joué", () => {
    const states = replayRanking([played(1, 1, 2)]);
    expect(rankedPointsOf(states, 1)).toBeGreaterThan(RANKING_BASE_POINTS);
  });
});

describe("probabilité de victoire", () => {
  it("donne une chance sur deux à cotes égales", () => {
    expect(expectedScore(500, 500)).toBeCloseTo(0.5, 10);
  });

  it("donne dix contre un à un écart d'une échelle complète", () => {
    // C'est la définition de `RANKING_SCALE` : 400 points d'écart valent
    // 10 chances contre 1, soit 0,909…
    expect(expectedScore(900, 500)).toBeCloseTo(10 / 11, 10);
    expect(expectedScore(500, 900)).toBeCloseTo(1 / 11, 10);
  });

  it("répartit toujours exactement une unité entre les deux équipes", () => {
    for (const [a, b] of [
      [500, 500],
      [500, 900],
      [1200, 130],
      [100, 4000],
    ]) {
      expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 10);
    }
  });

  // Un écart absurde sature la puissance de dix en virgule flottante : la
  // probabilité tombe alors exactement sur une borne. Elle n'en sort jamais,
  // et le transfert reste dans [0, K].
  it("reste bornée entre 0 et 1, même sur un écart absurde", () => {
    for (const [a, b] of [
      [100, 100_000],
      [100_000, 100],
    ]) {
      expect(expectedScore(a, b)).toBeGreaterThanOrEqual(0);
      expect(expectedScore(a, b)).toBeLessThanOrEqual(1);
      expect(Number.isFinite(ratingTransfer(a, b))).toBe(true);
    }
  });
});

/**
 * Le scénario de la demande, mot pour mot : « si une équipe A avec 500 points
 * affronte une équipe B avec 900 points, si A gagne elle doit gagner beaucoup
 * et B perdre beaucoup ; par contre si B gagne, les deux ne doivent pas
 * varier ».
 */
describe("transfert de points — l'exploit paie, le résultat attendu non", () => {
  const A = 500;
  const B = 900;

  it("récompense largement la victoire surprise", () => {
    expect(ratingTransfer(A, B)).toBe(29);
  });

  it("ne déplace presque rien sur le résultat attendu", () => {
    expect(ratingTransfer(B, A)).toBe(3);
  });

  it("paie l'exploit environ dix fois le résultat attendu", () => {
    expect(ratingTransfer(A, B) / ratingTransfer(B, A)).toBeGreaterThan(9);
  });

  it("partage le facteur K en deux à cotes égales", () => {
    expect(ratingTransfer(500, 500)).toBe(RANKING_K_FACTOR / 2);
  });

  it("ne dépasse jamais le facteur K", () => {
    expect(ratingTransfer(0, 100_000)).toBeLessThanOrEqual(RANKING_K_FACTOR);
    expect(ratingTransfer(100_000, 0)).toBeGreaterThanOrEqual(0);
  });

  it("croît avec l'écart, sans jamais décroître", () => {
    const gaps = [-800, -400, 0, 400, 800].map((gap) => ratingTransfer(500, 500 + gap));
    const sorted = [...gaps].sort((x, y) => x - y);
    expect(gaps).toEqual(sorted);
  });

  it("garde une échelle et un K explicites, pas des nombres devinés", () => {
    expect(RANKING_SCALE).toBe(400);
    expect(RANKING_K_FACTOR).toBe(32);
  });
});

describe("rejeu du classement", () => {
  it("laisse le tableau reçu intact", () => {
    const matches = [played(2, 1, 2), played(1, 2, 1)];
    const copy = [...matches];
    replayRanking(matches);
    expect(matches).toEqual(copy);
  });

  it("compte victoires, défaites et matchs joués", () => {
    const states = replayRanking([played(1, 1, 2), played(2, 1, 2), played(3, 2, 1)]);

    expect(states.get(1)).toMatchObject({ wins: 2, losses: 1, matchesPlayed: 3 });
    expect(states.get(2)).toMatchObject({ wins: 1, losses: 2, matchesPlayed: 3 });
  });

  it("ignore une équipe qui n'a disputé aucun match", () => {
    expect(replayRanking([]).size).toBe(0);
  });

  // Ce que l'un gagne, l'autre le perd — au point près. Le transfert est
  // calculé **une fois** puis appliqué avec les deux signes ; deux arrondis
  // indépendants feraient dériver le total du site match après match.
  it("conserve le total des points du site", () => {
    const matches = [
      played(1, 1, 2),
      played(2, 1, 3),
      played(3, 2, 3),
      played(4, 3, 1),
      played(5, 2, 1),
      played(6, 3, 2),
      played(7, 1, 2),
    ];
    const states = replayRanking(matches);
    const total = [...states.values()].reduce((sum, state) => sum + state.points, 0);

    expect(total).toBe(states.size * RANKING_BASE_POINTS);
  });

  it("transfère exactement ce que la formule annonce", () => {
    const states = replayRanking([played(1, 1, 2)]);
    const transfer = ratingTransfer(RANKING_BASE_POINTS, RANKING_BASE_POINTS);

    expect(states.get(1)!.points).toBe(RANKING_BASE_POINTS + transfer);
    expect(states.get(2)!.points).toBe(RANKING_BASE_POINTS - transfer);
  });

  // Le point délicat de la refonte : contrairement à une somme, une cote dépend
  // de l'ordre des rencontres. La règle vit ici, pas dans l'`ORDER BY` SQL.
  it("rejoue dans l'ordre chronologique, quel que soit l'ordre reçu", () => {
    const matches = [
      played(1, 1, 2, "2026-01-01T10:00:00.000Z"),
      played(2, 1, 3, "2026-02-01T10:00:00.000Z"),
      played(3, 2, 3, "2026-03-01T10:00:00.000Z"),
    ];

    const forward = replayRanking(matches);
    const shuffled = replayRanking([matches[2], matches[0], matches[1]]);

    for (const teamId of [1, 2, 3]) {
      expect(shuffled.get(teamId)).toEqual(forward.get(teamId));
    }
  });

  it("dépend réellement de l'ordre : deux histoires différentes, deux cotes", () => {
    // 1 bat 2 puis 3 bat 1 ; contre 3 bat 1 puis 1 bat 2. Les mêmes résultats,
    // dans un autre ordre, ne donnent pas la même cote — c'est la propriété
    // qu'un `SUM()` ne pouvait pas rendre.
    const early = replayRanking([
      played(1, 1, 2, "2026-01-01T10:00:00.000Z"),
      played(2, 3, 1, "2026-02-01T10:00:00.000Z"),
    ]);
    const late = replayRanking([
      played(1, 3, 1, "2026-01-01T10:00:00.000Z"),
      played(2, 1, 2, "2026-02-01T10:00:00.000Z"),
    ]);

    expect(early.get(1)!.points).not.toBe(late.get(1)!.points);
  });

  it("départage deux résultats du même instant par l'identifiant du match", () => {
    const sameInstant = "2026-04-01T20:00:00.000Z";
    const asIs = replayRanking([
      played(1, 1, 2, sameInstant),
      played(2, 3, 1, sameInstant),
    ]);
    const reversed = replayRanking([
      played(2, 3, 1, sameInstant),
      played(1, 1, 2, sameInstant),
    ]);

    expect(asIs.get(1)!.points).toBe(reversed.get(1)!.points);
  });

  it("range une date illisible en tête plutôt que d'exploser", () => {
    const states = replayRanking([played(1, 1, 2, "pas une date")]);
    expect(states.get(1)!.matchesPlayed).toBe(1);
  });

  // Un match d'une équipe contre elle-même n'a pas de perdant : le rejouer
  // ferait apparaître des points de nulle part par le plancher.
  it("ignore un match d'une équipe contre elle-même", () => {
    const states = replayRanking([played(1, 5, 5)]);
    expect(states.size).toBe(0);
  });

  it("récompense davantage la victoire sur une équipe qui gagne", () => {
    // 2 s'est fait un palmarès sur 3 ; battre 2 vaut alors plus que battre 3.
    const states = replayRanking([
      played(1, 2, 3),
      played(2, 2, 3),
      played(3, 2, 3),
      played(4, 1, 2),
      played(5, 4, 3),
    ]);

    expect(states.get(1)!.points).toBeGreaterThan(states.get(4)!.points);
    expect(states.get(1)!.wins).toBe(states.get(4)!.wins);
  });
});

describe("plancher", () => {
  /** N défaites d'affilée de l'équipe 1 face à des adversaires renouvelés. */
  function drubbing(count: number): RankedMatch[] {
    return Array.from({ length: count }, (_, index) =>
      played(index + 1, 100 + index, 1, `2026-01-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
    );
  }

  it("ne descend jamais sous le plancher, quelle que soit la série", () => {
    const states = replayRanking(drubbing(200));
    expect(states.get(1)!.points).toBeGreaterThanOrEqual(RANKING_FLOOR_POINTS);
  });

  it("garde le plancher franchement sous la cote de départ", () => {
    expect(RANKING_FLOOR_POINTS).toBeLessThan(RANKING_BASE_POINTS);
    expect(RANKING_FLOOR_POINTS).toBeGreaterThan(0);
  });

  // La seule entorse à la symétrie, et elle est assumée : le vainqueur prend
  // ses points même quand le perdant n'a plus rien à donner.
  it("est la seule entorse à la conservation du total", () => {
    const states = replayRanking(drubbing(200));
    const total = [...states.values()].reduce((sum, state) => sum + state.points, 0);

    expect(total).toBeGreaterThan(states.size * RANKING_BASE_POINTS);
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

describe("ordre du classement", () => {
  const team = (name: string, points: number, wins: number, losses = 0) => ({
    name,
    points,
    wins,
    losses,
  });

  it("ne classe pas une équipe sans match", () => {
    expect(isRankedTeam({ wins: 0, losses: 0 })).toBe(false);
    expect(isRankedTeam({ wins: 0, losses: 1 })).toBe(true);
    expect(isRankedTeam({ wins: 1, losses: 0 })).toBe(true);
  });

  // Sans cette règle, une équipe de remplissage — encore à la cote de départ —
  // se placerait au milieu du tableau sans avoir rien joué, et le leaderboard
  // de l'accueil, qui n'affiche que huit lignes, s'en serait rempli.
  it("range toute équipe sans match après les classées, même mieux cotée", () => {
    const jamais = team("Alpha", RANKING_BASE_POINTS, 0, 0);
    const battue = team("Zulu", RANKING_BASE_POINTS - 100, 0, 3);

    expect(compareRankedTeams(battue, jamais)).toBeLessThan(0);
    expect(compareRankedTeams(jamais, battue)).toBeGreaterThan(0);
  });

  it("classe d'abord à la cote", () => {
    expect(compareRankedTeams(team("A", 620, 3), team("B", 540, 1))).toBeLessThan(0);
  });

  it("départage à égalité de cote par les victoires", () => {
    expect(compareRankedTeams(team("A", 600, 4, 5), team("B", 600, 3))).toBeLessThan(0);
  });

  it("départage enfin par le nom, accents compris", () => {
    expect(compareRankedTeams(team("Étoile", 600, 1), team("Zulu", 600, 1))).toBeLessThan(0);
  });

  it("est stable pour deux équipes identiques", () => {
    expect(compareRankedTeams(team("A", 600, 1), team("A", 600, 1))).toBe(0);
  });

  it("trie une liste entière comme le fait chaque vue", () => {
    const rows = [
      team("Zulu", 480, 1, 2),
      team("Neuve", RANKING_BASE_POINTS, 0, 0),
      team("Bravo", 610, 3),
      team("Alpha", 610, 3),
    ];

    expect([...rows].sort(compareRankedTeams).map((row) => row.name)).toEqual([
      "Alpha",
      "Bravo",
      "Zulu",
      "Neuve",
    ]);
  });
});

describe("ordre chronologique des matchs", () => {
  it("classe par date puis par identifiant", () => {
    const early = played(9, 1, 2, "2026-01-01T10:00:00.000Z");
    const late = played(1, 1, 2, "2026-02-01T10:00:00.000Z");

    expect(compareRankedMatches(early, late)).toBeLessThan(0);
    expect(compareRankedMatches(late, early)).toBeGreaterThan(0);
  });

  it("départage deux matchs du même instant", () => {
    const instant = "2026-01-01T10:00:00.000Z";
    expect(
      compareRankedMatches(played(1, 1, 2, instant), played(2, 1, 2, instant)),
    ).toBeLessThan(0);
  });
});

describe("légendes", () => {
  it("annonce la règle qu'elle applique, sans la réécrire à la main", () => {
    expect(RANKING_POINTS_HINT).toContain(String(RANKING_BASE_POINTS));
    expect(RANKING_POINTS_HINT).toContain(String(RANKING_FLOOR_POINTS));
    // L'ancien barème additif ne doit plus être annoncé nulle part.
    expect(RANKING_POINTS_HINT).not.toContain("par victoire");
    expect(RANKING_POINTS_HINT).not.toContain("par défaite");
    // Elle tient sur une ligne de tuile : la légende voisine (« sur N équipes
    // classées ») fait 24 signes, celle-ci ne doit pas déformer la grille.
    expect(RANKING_POINTS_HINT.length).toBeLessThan(90);
    expect(RANKING_POINTS_LABEL).toBe("Points de classement");
    expect(RANKING_UNRANKED_HINT).toContain("Aucun match joué");
  });
});
