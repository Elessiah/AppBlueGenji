import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getLandingLeaderboard } from "@/lib/server/landing-service";
import { clearCache } from "@/lib/server/cache";
import { loadTeamRanking } from "@/lib/server/ranking-service";
import { RANKING_BASE_POINTS } from "@/lib/shared/ranking";
import { fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

/**
 * Le leaderboard de la landing calculait ses propres points. Il lit désormais
 * `loadTeamRanking`, comme l'annuaire et comme les fiches — donc la **cote
 * rejouée**, jamais une somme reconstruite ici.
 *
 * Sa tendance compare deux photos du **même** calcul : le classement courant, et
 * celui rejoué en s'arrêtant une semaine plus tôt.
 */

type Row = Record<string, unknown>;

function matchRow(id: number, team1: number, team2: number, winner: number): Row {
  return {
    id,
    team1_id: team1,
    team2_id: team2,
    winner_team_id: winner,
    played_at: new Date(`2026-06-${String(id).padStart(2, "0")}T18:00:00.000Z`),
  };
}

function teamRow(id: number, name: string, logo: string | null = null): Row {
  return { id, name, logo_url: logo };
}

/**
 * Le classement courant et celui d'il y a une semaine passent par la **même**
 * requête de rejeu ; on les distingue par la présence d'une borne de date
 * dans le **texte** de la requête — jamais par la simple longueur de
 * `params`, qui porte aussi le filtre par jeu et vaudrait alors « bornée »
 * pour la photo courante d'un onglet filtré.
 */
async function mockDb(teams: Row[], current: Row[], previous: Row[] = current) {
  const execute = jest.fn(async (sql: unknown, _params: unknown) => {
    const text = String(sql);
    if (text.includes("AS played_at")) {
      const bounded = text.includes("DATE_SUB(NOW()");
      return [bounded ? previous : current];
    }
    if (text.includes("FROM bg_teams")) return [teams];
    return [[]];
  });
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

describe("leaderboard de la landing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clearCache();
  });

  it("affiche exactement la cote du chargeur partagé, sans la recalculer", async () => {
    const teams = [teamRow(1, "Alpha"), teamRow(2, "Bravo")];
    const matches = [matchRow(1, 1, 2, 1), matchRow(2, 1, 2, 1)];
    await mockDb(teams, matches);

    const rows = await getLandingLeaderboard(8);

    clearCache();
    await mockDb(teams, matches);
    const ranking = await loadTeamRanking();

    expect(rows.map((row) => [row.teamName, row.points, row.wins, row.losses])).toEqual(
      ranking.map((row) => [row.teamName, row.points, row.wins, row.losses]),
    );
    expect(rows[0]).toMatchObject({ rank: 1, teamId: 1, teamName: "Alpha", wins: 2, losses: 0 });
    expect(rows[0].points).toBeGreaterThan(RANKING_BASE_POINTS);
  });

  // Elles restent visibles — le classement part de 500 pour tout le monde —
  // mais elles ne peuvent pas voler la tête du tableau à une équipe qui joue.
  it("garde les équipes sans match, à la cote de départ", async () => {
    await mockDb([teamRow(1, "Alpha"), teamRow(2, "Bravo")], [matchRow(1, 1, 2, 1)]);

    const rows = await getLandingLeaderboard(8);

    expect(rows.map((row) => row.teamName)).toEqual(["Alpha", "Bravo"]);
  });

  // Retour du 2026-10-05, scénario exact : un seul match sur le site, la
  // perdante passait deuxième devant toutes les équipes restées à 500.
  // Demande du 2026-10-13 : les équipes sans match sont masquées, et la
  // perdante prend la place suivante — rangs sans trou.
  it("masque les équipes sans match et numérote les autres sans trou", async () => {
    await mockDb(
      [
        teamRow(1, "Alpha"),
        teamRow(2, "Bravo"),
        teamRow(3, "Charlie"),
        teamRow(4, "Delta"),
        teamRow(5, "Echo"),
      ],
      [matchRow(1, 1, 2, 1)],
    );

    const rows = await getLandingLeaderboard(8);

    expect(rows.map((row) => row.teamName)).toEqual(["Alpha", "Bravo"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(rows[1].points).toBeLessThan(RANKING_BASE_POINTS);
    expect(rows[1]).toMatchObject({ rank: 2, wins: 0, losses: 1 });
  });

  it("porte les nuls de chaque ligne", async () => {
    await mockDb([teamRow(1, "Alpha"), teamRow(2, "Bravo")], [matchRow(1, 1, 2, 1)]);

    const rows = await getLandingLeaderboard(8);

    expect(rows.every((row) => row.draws === 0)).toBe(true);
  });

  it("borne le classement de référence à une semaine, sur l'horloge de la base", async () => {
    const execute = await mockDb([teamRow(1, "Alpha")], [matchRow(1, 1, 2, 1)]);

    await getLandingLeaderboard(8);

    const bounded = execute.mock.calls.find(
      (call) => Array.isArray(call[1]) && (call[1] as unknown[]).length > 0,
    );
    expect(bounded).toBeDefined();
    expect(String(bounded![0])).toContain("DATE_SUB(NOW(), INTERVAL ? DAY)");
    expect(bounded![1]).toEqual([7]);
  });

  it("compare la tendance à deux photos du même calcul", async () => {
    // Il y a une semaine, Bravo menait (elle avait battu Alpha) ; Alpha a
    // depuis pris deux victoires et est passée devant.
    await mockDb(
      [teamRow(1, "Alpha"), teamRow(2, "Bravo")],
      [matchRow(1, 2, 1, 2), matchRow(2, 1, 2, 1), matchRow(3, 1, 2, 1)],
      [matchRow(1, 2, 1, 2)],
    );

    const rows = await getLandingLeaderboard(8);

    expect(rows[0]).toMatchObject({ teamName: "Alpha", trend: "up", trendValue: 1 });
    expect(rows[1]).toMatchObject({ teamName: "Bravo", trend: "down", trendValue: 1 });
  });

  it("borne le nombre de lignes rendues", async () => {
    await mockDb(
      [teamRow(1, "Alpha"), teamRow(2, "Bravo"), teamRow(3, "Charlie")],
      [matchRow(1, 1, 2, 1), matchRow(2, 1, 3, 1)],
    );

    expect(await getLandingLeaderboard(2)).toHaveLength(2);
  });

  // Revue de performance #471 : une entrée de cache par longueur refaisait
  // tout le rejeu pour chaque `limit` demandé par le client.
  it("un seul rejeu par jeu, quelle que soit la longueur demandée", async () => {
    const execute = await mockDb(
      [teamRow(1, "Alpha"), teamRow(2, "Bravo"), teamRow(3, "Charlie")],
      [matchRow(1, 1, 2, 1), matchRow(2, 1, 3, 1)],
    );

    const two = await getLandingLeaderboard(2);
    const eight = await getLandingLeaderboard(8);
    const one = await getLandingLeaderboard(1);

    expect(execute.mock.calls.filter((call) => String(call[0]).includes("AS played_at"))).toHaveLength(2);
    expect(two).toEqual(eight.slice(0, 2));
    expect(one).toEqual(eight.slice(0, 1));
    expect(eight).toHaveLength(3);
  });

  it("borne la longueur entre 1 et 50, entier", async () => {
    await mockDb(
      Array.from({ length: 60 }, (_, index) => teamRow(index + 1, `Team ${index + 1}`)),
      // 30 matchs entre paires distinctes : les 60 équipes ont joué, toutes classées.
      Array.from({ length: 30 }, (_, index) => matchRow(index + 1, 2 * index + 1, 2 * index + 2, 2 * index + 1)),
    );

    expect(await getLandingLeaderboard(0)).toHaveLength(1);
    expect(await getLandingLeaderboard(-5)).toHaveLength(1);
    expect(await getLandingLeaderboard(2.9)).toHaveLength(2);
    expect(await getLandingLeaderboard(500)).toHaveLength(50);
  });

  it("rend une liste vide plutôt que de casser la page si la base tombe", async () => {
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockRejectedValue(new Error("db down"));

    expect(await getLandingLeaderboard(8)).toEqual([]);
  });

  // Les pastilles Général / Overwatch / Marvel Rivals de `Leaderboard.tsx` :
  // sans ce filtre relu jusqu'au bout, cliquer « Overwatch » rendait toujours
  // le classement général.
  it("transmet le jeu au chargeur partagé, sur les deux photos", async () => {
    const execute = await mockDb([teamRow(1, "Alpha")], [matchRow(1, 1, 2, 1)]);

    await getLandingLeaderboard(8, "MR");

    const playedAtCalls = execute.mock.calls.filter((call) => String(call[0]).includes("AS played_at"));
    // La photo courante *et* celle d'il y a une semaine doivent porter le même
    // filtre — sans quoi la tendance comparerait un classement par jeu à un
    // classement général.
    expect(playedAtCalls).toHaveLength(2);
    const current = playedAtCalls.find((call) => !String(call[0]).includes("DATE_SUB(NOW()"))!;
    const previous = playedAtCalls.find((call) => String(call[0]).includes("DATE_SUB(NOW()"))!;
    expect(current[0]).toContain("t.game = ?");
    expect(current[1]).toEqual(["MR"]);
    expect(previous[0]).toContain("t.game = ?");
    expect(previous[1]).toEqual([7, "MR"]);
  });

  it("ne filtre rien sans jeu demandé (« Général »)", async () => {
    const execute = await mockDb([teamRow(1, "Alpha")], [matchRow(1, 1, 2, 1)]);

    await getLandingLeaderboard(8);

    for (const call of execute.mock.calls) {
      expect(String(call[0])).not.toContain("t.game = ?");
    }
  });

  // Sans ce garde-fou, l'onglet « Marvel Rivals » listait une équipe qui n'a
  // jamais joué ce jeu, à la cote de départ, comme si elle attendait
  // simplement son premier match — alors qu'elle n'en jouera jamais un dans
  // ce jeu-là. L'onglet « Général », lui, doit continuer à la montrer : c'est
  // sa raison d'être.
  it("exclut de chaque onglet les équipes qui n'ont joué aucun match compté", async () => {
    const teams = [teamRow(1, "Alpha"), teamRow(2, "Jamais engagée dans ce jeu")];
    // Représente ce que la base renvoie déjà filtrée par `t.game = ?` : seule
    // Alpha a un match dans le jeu demandé.
    const matches = [matchRow(1, 1, 3, 1)];

    await mockDb(teams, matches);
    const filtered = await getLandingLeaderboard(8, "MR");
    expect(filtered.map((row) => row.teamName)).toEqual(["Alpha"]);

    clearCache();
    await mockDb(teams, matches);
    const general = await getLandingLeaderboard(8);
    // « Général » applique le même filtre : sans match compté, pas de ligne.
    expect(general.map((row) => row.teamName)).toEqual(["Alpha"]);
  });

  it("garde deux classements distincts en cache selon le jeu demandé", async () => {
    const execute = await mockDb([teamRow(1, "Alpha")], [matchRow(1, 1, 2, 1)]);

    await getLandingLeaderboard(8);
    await getLandingLeaderboard(8, "OW");
    await getLandingLeaderboard(8);
    await getLandingLeaderboard(8, "OW");

    // Un rejeu par jeu distinct, pas un par appel : la mutualisation tient
    // toujours, seulement sur des clés séparées.
    expect(execute.mock.calls.filter((call) => String(call[0]).includes("AS played_at"))).toHaveLength(4);
  });

  // Revue UI/UX : la photo d'il y a une semaine ne porte pas une équipe qui
  // n'avait encore rien joué. Entrée depuis, elle n'est pas « stable ».
  it("marque « new » une équipe absente du classement d'il y a une semaine", async () => {
    const teams = [teamRow(1, "Alpha"), teamRow(2, "Bravo"), teamRow(3, "Nouvelle")];
    const previous = [matchRow(1, 1, 2, 1)];
    const current = [...previous, matchRow(2, 3, 2, 3)];
    await mockDb(teams, current, previous);

    const rows = await getLandingLeaderboard(8);

    expect(rows.find((row) => row.teamName === "Nouvelle")).toMatchObject({ trend: "new", trendValue: 0 });
    expect(rows.find((row) => row.teamName === "Alpha")?.trend).not.toBe("new");
  });

  it("rend chaque nom sous sa forme affichable : accueil et /classement sont lus sans compte", async () => {
    // Un nom ancien peut garder un renversement bidi ou n'être fait que de
    // caractères invisibles (`UNTRUSTED_NAMES.md`) ; repli « #id », commun aux deux langues.
    await mockDb([teamRow(1, "Al\u202Epha"), teamRow(2, "\u200B\u200D")], [matchRow(1, 1, 2, 1)]);

    const rows = await getLandingLeaderboard(8);

    expect(rows.map((row) => row.teamName)).toEqual(["Alpha", "#2"]);
  });
});
