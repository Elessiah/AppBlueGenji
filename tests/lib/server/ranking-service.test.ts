import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  getTeamRankingPosition,
  loadEntrantsBySiteRanking,
  loadRankingState,
  loadTeamRanking,
} from "@/lib/server/ranking-service";
import { clearCache } from "@/lib/server/cache";
import { invalidateTeamRanking } from "@/lib/server/ranking-cache";
import { RANKING_BASE_POINTS, ratingTransfer, replayRanking } from "@/lib/shared/ranking";

jest.mock("@/lib/server/database");

/**
 * Le chargeur unique du classement. Il ne calcule rien lui-même : il collecte
 * les rencontres comptées et les passe à `replayRanking`. Ce fichier tient donc
 * deux choses — la **collecte** (bonne assiette, bonne chronologie, bonne
 * fenêtre) et le **découpage** (qui figure dans la liste, qui n'y figure pas).
 */

type Row = Record<string, unknown>;

/** Un match du site, tel que la requête de rejeu le rend. */
function matchRow(id: number, team1: number, team2: number, winner: number, day = id): Row {
  return {
    id,
    team1_id: team1,
    team2_id: team2,
    winner_team_id: winner,
    played_at: new Date(`2026-06-${String(day).padStart(2, "0")}T18:00:00.000Z`),
  };
}

function teamRow(id: number, name = `Test - ${id}`, logo: string | null = null): Row {
  return { id, name, logo_url: logo };
}

/**
 * Base factice routée **par le SQL** : le service enchaîne des requêtes dont
 * l'ordre n'a pas à être figé par un test.
 */
function fakeDb(matches: Row[], teams: Row[], entrants: Row[] = []) {
  return jest.fn(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("AS played_at")) return [matches];
    if (text.includes("FROM bg_tournament_registrations")) return [entrants];
    if (text.includes("FROM bg_teams")) return [teams];
    return [[]];
  });
}

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
  return execute;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});
afterEach(() => {
  jest.restoreAllMocks();
  clearCache();
});

describe("loadRankingState — collecte", () => {
  it("ne compte que les matchs de l'assiette partagée", async () => {
    const execute = await mockDb(fakeDb([], []));

    await loadRankingState();

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toContain("m.status = 'COMPLETED'");
    expect(sql).toContain("m.is_bye = 0");
    expect(sql).toContain("m.team2_id IS NOT NULL");
    expect(sql).toContain("m.winner_team_id IS NOT NULL");
  });

  // La même lecture de « quand ce match a-t-il eu lieu » que les fiches et les
  // barres de forme : deux chronologies donneraient deux histoires du site.
  it("date les matchs comme les fiches", async () => {
    const execute = await mockDb(fakeDb([], []));

    await loadRankingState();

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toContain("COALESCE(m.updated_at, t.finished_at, t.start_at)");
  });

  it("déduit le perdant de la paire et du vainqueur", async () => {
    await mockDb(fakeDb([matchRow(1, 7, 9, 9)], []));

    const states = await loadRankingState();

    expect(states.get(9)).toMatchObject({ wins: 1, losses: 0 });
    expect(states.get(7)).toMatchObject({ wins: 0, losses: 1 });
  });

  it("rend exactement ce que rend le rejeu pur", async () => {
    const rows = [matchRow(1, 1, 2, 1), matchRow(2, 2, 3, 2), matchRow(3, 3, 1, 3)];
    await mockDb(fakeDb(rows, []));

    const states = await loadRankingState();
    const expected = replayRanking(
      rows.map((row) => ({
        matchId: Number(row.id),
        winnerTeamId: Number(row.winner_team_id),
        loserTeamId:
          Number(row.winner_team_id) === Number(row.team1_id)
            ? Number(row.team2_id)
            : Number(row.team1_id),
        playedAt: (row.played_at as Date).toISOString(),
      })),
    );

    expect([...states.entries()]).toEqual([...expected.entries()]);
  });

  it("tolère un match sans date plutôt que de casser le classement", async () => {
    await mockDb(fakeDb([{ ...matchRow(1, 1, 2, 1), played_at: null }], []));

    expect((await loadRankingState()).get(1)).toMatchObject({ wins: 1 });
  });

  // La borne est calculée par MySQL : les dates de match sont écrites par la
  // base, une date construite côté Node décalerait la fenêtre du seul écart de
  // fuseau entre l'app et la base.
  it("borne le rejeu sur l'horloge de la base", async () => {
    const execute = await mockDb(fakeDb([], []));

    await loadRankingState({ completedMoreThanDaysAgo: 7 });

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("m.updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)");
    expect(params).toEqual([7]);
  });

  it("ne borne rien, et ne lie aucun paramètre, sans fenêtre", async () => {
    const execute = await mockDb(fakeDb([], []));

    await loadRankingState();

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("m.updated_at <");
    expect(params).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN])("refuse une fenêtre absurde (%p)", async (days) => {
    const execute = await mockDb(fakeDb([], []));

    await expect(loadRankingState({ completedMoreThanDaysAgo: days })).rejects.toThrow(
      "INVALID_RANKING_WINDOW",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepte une fenêtre nulle", async () => {
    const execute = await mockDb(fakeDb([], []));

    await loadRankingState({ completedMoreThanDaysAgo: 0 });

    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([0]);
  });
});

describe("loadRankingState — mutualisation", () => {
  it("ne rejoue qu'une fois pour deux lectures rapprochées", async () => {
    const execute = await mockDb(fakeDb([matchRow(1, 1, 2, 1)], []));

    await loadRankingState();
    await loadRankingState();

    expect(execute.mock.calls.filter((call) => String(call[0]).includes("AS played_at"))).toHaveLength(1);
  });

  it("distingue la photo bornée du classement courant", async () => {
    const execute = await mockDb(fakeDb([matchRow(1, 1, 2, 1)], []));

    await loadRankingState();
    await loadRankingState({ completedMoreThanDaysAgo: 7 });

    expect(execute.mock.calls.filter((call) => String(call[0]).includes("AS played_at"))).toHaveLength(2);
  });

  // Un score qui tombe déplace des cotes : le cache doit être vidé, sans quoi
  // le classement resterait faux une minute durant.
  it("rejoue de nouveau après invalidation", async () => {
    const execute = await mockDb(fakeDb([matchRow(1, 1, 2, 1)], []));

    await loadRankingState();
    invalidateTeamRanking();
    await loadRankingState();

    expect(execute.mock.calls.filter((call) => String(call[0]).includes("AS played_at"))).toHaveLength(2);
  });

  // Le seeding s'exécute dans la transaction qui lance le tournoi : il doit
  // voir ce que cette transaction voit, pas une photo mutualisée.
  it("court-circuite le cache quand une connexion est fournie", async () => {
    await mockDb(fakeDb([], []));
    const connection = { execute: fakeDb([matchRow(1, 1, 2, 1)], []) };

    await loadRankingState({ connection });
    await loadRankingState({ connection });

    expect(connection.execute).toHaveBeenCalledTimes(2);
  });
});

describe("loadTeamRanking", () => {
  it("trie les classées à la cote, puis aux victoires, puis au nom", async () => {
    // 1 bat 2 deux fois ; 3 et 4 se partagent une victoire chacune.
    await mockDb(
      fakeDb(
        [matchRow(1, 1, 2, 1), matchRow(2, 1, 2, 1), matchRow(3, 3, 4, 3), matchRow(4, 4, 3, 4)],
        [teamRow(1, "Alpha"), teamRow(2, "Bravo"), teamRow(3, "Charlie"), teamRow(4, "Delta")],
      ),
    );

    const rows = await loadTeamRanking();

    expect(rows[0].teamName).toBe("Alpha");
    expect(rows[rows.length - 1].teamName).toBe("Bravo");
    expect(rows.map((row) => row.points)).toEqual([...rows.map((row) => row.points)].sort((a, b) => b - a));
  });

  it("écarte par défaut les équipes sans match", async () => {
    await mockDb(fakeDb([matchRow(1, 1, 2, 1)], [teamRow(1), teamRow(2), teamRow(3)]));

    expect((await loadTeamRanking()).map((row) => row.teamId)).toEqual([1, 2]);
  });

  it("les garde à la cote de départ quand on le demande, mais en fin de liste", async () => {
    await mockDb(
      fakeDb([matchRow(1, 1, 2, 1)], [teamRow(1, "Alpha"), teamRow(2, "Bravo"), teamRow(3, "Zulu")]),
    );

    const rows = await loadTeamRanking({ includeUnplayed: true });

    expect(rows.map((row) => row.teamName)).toEqual(["Alpha", "Bravo", "Zulu"]);
    // Bravo, battue, est passée sous la cote de départ ; Zulu, qui n'a rien
    // joué, y est restée — et se range pourtant derrière elle.
    expect(rows[1].points).toBeLessThan(RANKING_BASE_POINTS);
    expect(rows[2]).toMatchObject({ points: RANKING_BASE_POINTS, wins: 0, losses: 0 });
  });

  // Une entrée solo n'est pas une équipe : la laisser dans la liste décalerait
  // le rang de toutes les autres et gonflerait le total.
  it("exclut les entrées solo de la liste, mais pas du rejeu", async () => {
    const execute = await mockDb(fakeDb([matchRow(1, 1, 2, 1)], [teamRow(1)]));

    const rows = await loadTeamRanking();

    const teamSql = execute.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("FROM bg_teams"))!;
    expect(teamSql).toContain("solo_user_id IS NULL");
    // Le match a bien été rejoué, l'engagée absente de la liste comprise.
    expect(rows).toHaveLength(1);
    expect(rows[0].wins).toBe(1);
  });

  it("reporte le logo de chaque équipe", async () => {
    await mockDb(fakeDb([matchRow(1, 1, 2, 1)], [teamRow(1, "Alpha", "/logo.webp"), teamRow(2)]));

    expect((await loadTeamRanking())[0].logoUrl).toBe("/logo.webp");
  });
});

describe("getTeamRankingPosition", () => {
  it("donne la place et la cote qui la produit, du même calcul", async () => {
    await mockDb(
      fakeDb(
        [matchRow(1, 1, 2, 1), matchRow(2, 1, 3, 1), matchRow(3, 3, 2, 3)],
        [teamRow(1), teamRow(2), teamRow(3)],
      ),
    );

    const ranking = await getTeamRankingPosition(3);
    const rows = await loadTeamRanking();

    expect(ranking.total).toBe(3);
    expect(ranking.points).toBe(rows.find((row) => row.teamId === 3)!.points);
    expect(ranking.position).toBe(rows.findIndex((row) => row.teamId === 3) + 1);
  });

  it("donne le même rang à deux équipes à égalité de cote", async () => {
    // Deux paires symétriques : 1 et 3 finissent exactement à la même cote.
    await mockDb(
      fakeDb(
        [matchRow(1, 1, 2, 1), matchRow(2, 3, 4, 3)],
        [teamRow(1), teamRow(2), teamRow(3), teamRow(4)],
      ),
    );

    expect((await getTeamRankingPosition(1)).position).toBe(1);
    expect((await getTeamRankingPosition(3)).position).toBe(1);
  });

  it("laisse non classée une équipe sans match, à la cote de départ", async () => {
    await mockDb(fakeDb([matchRow(1, 1, 2, 1)], [teamRow(1), teamRow(2)]));

    expect(await getTeamRankingPosition(42)).toEqual({
      position: null,
      total: 2,
      points: RANKING_BASE_POINTS,
    });
  });
});

describe("loadEntrantsBySiteRanking", () => {
  /** Une connexion factice, comme celle d'une transaction de lancement. */
  function connectionWith(matches: Row[], entrants: Row[]) {
    return { execute: fakeDb(matches, [], entrants) };
  }

  it("ordonne les inscrites par le classement du site", async () => {
    const connection = connectionWith(
      [matchRow(1, 1, 2, 1), matchRow(2, 1, 3, 1), matchRow(3, 2, 3, 2)],
      [
        { team_id: 3, team_name: "Charlie" },
        { team_id: 1, team_name: "Alpha" },
        { team_id: 2, team_name: "Bravo" },
      ],
    );

    const ordered = await loadEntrantsBySiteRanking(connection, 7);

    expect(ordered.map((entrant) => entrant.teamId)).toEqual([1, 2, 3]);
    expect(ordered[0].teamName).toBe("Alpha");
  });

  it("range les inscrites jamais vues derrière celles qui ont joué", async () => {
    const connection = connectionWith(
      [matchRow(1, 1, 2, 1)],
      [
        { team_id: 9, team_name: "Alpha" },
        { team_id: 2, team_name: "Zulu" },
      ],
    );

    // Alpha est en tête alphabétiquement et à la cote de départ ; Zulu a joué
    // et perdu — elle passe pourtant devant.
    expect((await loadEntrantsBySiteRanking(connection, 7)).map((e) => e.teamId)).toEqual([2, 9]);
  });

  it("ne trie plus rien en SQL : l'ordre vient du rejeu", async () => {
    const connection = connectionWith([], [{ team_id: 1, team_name: "Alpha" }]);

    await loadEntrantsBySiteRanking(connection, 7);

    const entrantSql = connection.execute.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("FROM bg_tournament_registrations"))!;
    expect(entrantSql).not.toContain("ORDER BY");
    expect(entrantSql).not.toContain("SUM(CASE WHEN");
  });

  it("lit sur la connexion de l'appelant, jamais sur le pool", async () => {
    const pool = await mockDb(fakeDb([], []));
    const connection = connectionWith([], [{ team_id: 1, team_name: "Alpha" }]);

    await loadEntrantsBySiteRanking(connection, 7);

    expect(pool).not.toHaveBeenCalled();
  });

  it("ne rend rien pour un tournoi sans inscrite", async () => {
    expect(await loadEntrantsBySiteRanking(connectionWith([], []), 7)).toEqual([]);
  });

  // Un tournoi individuel engage des **entrées solo**, absentes de la liste du
  // classement : elles doivent malgré tout être seedées sur leur cote.
  it("seede aussi les engagées absentes de la liste des équipes", async () => {
    const connection = connectionWith(
      [matchRow(1, 50, 51, 50)],
      [
        { team_id: 51, team_name: "Solo B" },
        { team_id: 50, team_name: "Solo A" },
      ],
    );

    expect((await loadEntrantsBySiteRanking(connection, 7)).map((e) => e.teamId)).toEqual([50, 51]);
  });
});

/**
 * Le rejeu est ce qui remplace la somme : une correction de score ne se répare
 * pas d'elle-même dans un total accumulé, elle se répare dans un rejeu.
 */
describe("rejeu — une correction de score se répercute seule", () => {
  const teams = [teamRow(1, "Alpha"), teamRow(2, "Bravo"), teamRow(3, "Charlie")];

  async function pointsAfter(matches: Row[]): Promise<Map<number, number>> {
    clearCache();
    await mockDb(fakeDb(matches, teams));
    const rows = await loadTeamRanking({ includeUnplayed: true });
    return new Map(rows.map((row) => [row.teamId, row.points]));
  }

  it("défait le premier résultat **et** tout ce qui a suivi", async () => {
    const before = await pointsAfter([matchRow(1, 1, 2, 1), matchRow(2, 1, 3, 1)]);
    // Le score du premier match est corrigé : c'est 2 qui l'emporte.
    const after = await pointsAfter([matchRow(1, 1, 2, 2), matchRow(2, 1, 3, 1)]);

    expect(after.get(1)).toBeLessThan(before.get(1)!);
    expect(after.get(2)).toBeGreaterThan(before.get(2)!);
    // Le second match n'a pas changé de vainqueur, mais il ne rapporte plus la
    // même chose : 1 l'a joué depuis une cote plus basse.
    expect(after.get(3)).not.toBe(before.get(3));
  });

  it("revient exactement au même classement une fois le score rétabli", async () => {
    const initial = await pointsAfter([matchRow(1, 1, 2, 1), matchRow(2, 1, 3, 1)]);
    await pointsAfter([matchRow(1, 1, 2, 2), matchRow(2, 1, 3, 1)]);
    const restored = await pointsAfter([matchRow(1, 1, 2, 1), matchRow(2, 1, 3, 1)]);

    expect([...restored.entries()]).toEqual([...initial.entries()]);
  });

  it("efface un match retiré de l'assiette", async () => {
    const withMatch = await pointsAfter([matchRow(1, 1, 2, 1)]);
    const without = await pointsAfter([]);

    expect(withMatch.get(1)).toBe(RANKING_BASE_POINTS + ratingTransfer(500, 500));
    expect(without.get(1)).toBe(RANKING_BASE_POINTS);
  });
});
