import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getLandingTicker } from "@/lib/server/landing-service";
import { clearCache } from "@/lib/server/cache";
import type { TickerChampionItem, TickerItem, TickerResultItem } from "@/lib/shared/ticker-items";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/**
 * Résultats du bandeau de l'accueil (TICKER_RESULTS.md) : l'issue de chaque
 * camp vient du résultat enregistré, et le texte masqué la dit dans la langue
 * de la page.
 */
type ResultRow = {
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number;
  team2_score: number;
  team1_id: number | null;
  team2_id: number | null;
  winner_team_id: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number;
};

function resultRow(overrides: Partial<ResultRow>, minute: number) {
  return {
    updated_at: new Date(`2026-10-05T10:${String(minute).padStart(2, "0")}:00Z`),
    tournament_name: "Alpha Cup",
    team1_name: "Alpha",
    team2_name: "Beta",
    team1_score: 2,
    team2_score: 1,
    team1_id: 1,
    team2_id: 2,
    winner_team_id: 1,
    forfeit_team_id: null,
    double_forfeit: 0,
    ...overrides,
  };
}

async function mockTicker(results: ReturnType<typeof resultRow>[], winners: unknown[] = []) {
  const execute = jest
    .fn<SqlQuery>()
    .mockResolvedValueOnce([results])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([winners])
    .mockResolvedValueOnce([[]]);
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

function results(items: TickerItem[]): TickerResultItem[] {
  return items.filter((item): item is TickerResultItem => typeof item !== "string" && item.kind === "result");
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("getLandingTicker — résultats", () => {
  it("lit l'issue enregistrée du match (vainqueur, forfait, double forfait)", async () => {
    const execute = await mockTicker([resultRow({}, 1)]);
    await getLandingTicker();
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/m\.winner_team_id/);
    expect(sql).toMatch(/m\.forfeit_team_id/);
    expect(sql).toMatch(/m\.double_forfeit/);
  });

  it("match tranché : vainqueur et perdant nommés pour le lecteur d'écran, dans l'ordre du match", async () => {
    await mockTicker([resultRow({ winner_team_id: 2, team1_score: 0, team2_score: 3 }, 1)]);
    const [item] = results((await getLandingTicker()).items);
    expect(item).toEqual({
      kind: "result",
      lead: "RÉSULTAT · Alpha Cup ·",
      sides: [
        { name: "Alpha", score: "0", outcome: "loss", sr: "perdant" },
        { name: "Beta", score: "3", outcome: "win", sr: "vainqueur" },
      ],
      sr: null,
    });
  });

  it("anglais : mêmes camps, issue dite en anglais", async () => {
    await mockTicker([resultRow({}, 1)]);
    const [item] = results((await getLandingTicker("en")).items);
    expect(item.lead).toBe("RESULT · Alpha Cup ·");
    expect(item.sides.map((side) => side.sr)).toEqual(["winner", "loser"]);
  });

  it("forfait : le vainqueur garde sa mise en valeur, le forfait n'est pas un perdant", async () => {
    await mockTicker([resultRow({ winner_team_id: 2, forfeit_team_id: 1, team1_score: 0, team2_score: 0 }, 1)]);
    const [fr] = results((await getLandingTicker()).items);
    expect(fr.sides.map((side) => [side.outcome, side.sr])).toEqual([["forfeit", "forfait"], ["win", "vainqueur"]]);
    const [en] = results((await getLandingTicker("en")).items);
    expect(en.sides[0].sr).toBe("forfeit");
  });

  it("double forfait : deux forfaits, aucun vainqueur", async () => {
    await mockTicker([resultRow({ winner_team_id: null, double_forfeit: 1, team1_score: 0, team2_score: 0 }, 1)]);
    const [item] = results((await getLandingTicker()).items);
    expect(item.sides.map((side) => side.outcome)).toEqual(["forfeit", "forfeit"]);
    expect(item.sr).toBeNull();
  });

  it("nul : deux camps neutres et une note « sans vainqueur » (FR et EN)", async () => {
    await mockTicker([resultRow({ winner_team_id: null, team1_score: 1, team2_score: 1 }, 1)]);
    const [fr] = results((await getLandingTicker()).items);
    expect(fr.sides.map((side) => [side.outcome, side.sr])).toEqual([["none", null], ["none", null]]);
    expect(fr.sr).toBe("sans vainqueur");
    expect(results((await getLandingTicker("en")).items)[0].sr).toBe("no winner");
  });

  it("entrée solo, nom invisible ou ligne disparue : forme affichable du nom, sinon le repli « Équipe #id »", async () => {
    await mockTicker([resultRow({ team1_name: "  Pseudo​  Solo ", team2_name: "​", team2_id: 7 }, 1)]);
    const [item] = results((await getLandingTicker()).items);
    expect(item.sides.map((side) => side.name)).toEqual(["Pseudo Solo", "Équipe #7"]);
  });
});

describe("getLandingTicker — champions", () => {
  it("champion connu mis en valeur ; champion inconnu laissé neutre", async () => {
    await mockTicker(
      [],
      [
        { finished_at: new Date("2026-10-03T10:00:00Z"), name: "Gamma League", winner_name: "Alpha", winner_team_id: 1 },
        { finished_at: new Date("2026-10-02T10:00:00Z"), name: "Delta Cup", winner_name: null, winner_team_id: null },
      ],
    );
    const items = (await getLandingTicker()).items.filter(
      (item): item is TickerChampionItem => typeof item !== "string" && item.kind === "champion",
    );
    expect(items).toEqual([
      { kind: "champion", lead: "VAINQUEUR · Gamma League ·", name: "Alpha", known: true },
      { kind: "champion", lead: "VAINQUEUR · Delta Cup ·", name: "Champion inconnu", known: false },
    ]);
  });
});
