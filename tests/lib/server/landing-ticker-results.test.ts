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
  team1_score: number | null;
  team2_score: number | null;
  team1_id: number | null;
  team2_id: number | null;
  winner_team_id: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number;
  match_format_type: "BO" | "FT" | null;
  match_format_value: number | null;
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
    match_format_type: null,
    match_format_value: null,
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
    expect(sql).toMatch(/t\.match_format_type/);
  });

  it("ne prend que les matchs entre deux engagés : ni exemption, ni case vide", async () => {
    const execute = await mockTicker([resultRow({}, 1)]);
    await getLandingTicker();
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/m\.is_bye = FALSE/);
    expect(sql).toMatch(/m\.team1_id IS NOT NULL\s+AND m\.team2_id IS NOT NULL/);
  });

  it("ne prend que les matchs à l'issue enregistrée : vainqueur, forfait, double forfait ou nul à scores égaux", async () => {
    const execute = await mockTicker([resultRow({}, 1)]);
    await getLandingTicker();
    const sql = String(execute.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(sql).toContain(
      "AND ( m.winner_team_id IS NOT NULL OR m.forfeit_team_id IS NOT NULL OR m.double_forfeit = TRUE OR ( m.team1_score IS NOT NULL AND m.team2_score IS NOT NULL AND m.team1_score = m.team2_score ) )",
    );
  });

  it("aucune requête du bandeau ne lit un tournoi pas encore publié (start_visibility_at)", async () => {
    const execute = await mockTicker([resultRow({}, 1)]);
    await getLandingTicker();
    // Résultats, inscriptions, champions : chacune filtre la publication.
    for (const index of [0, 1, 2]) {
      expect(String(execute.mock.calls[index][0])).toMatch(/AND t\.start_visibility_at <= NOW\(\)/);
    }
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

  it("forfait antérieur à la règle, sans score en colonnes : score plein du format, comme les fiches", async () => {
    await mockTicker([
      resultRow({ winner_team_id: 2, forfeit_team_id: 1, team1_score: null, team2_score: null, match_format_type: "FT", match_format_value: 3 }, 1),
    ]);
    const [item] = results((await getLandingTicker()).items);
    expect(item.sides.map((side) => [side.score, side.outcome])).toEqual([["0", "forfeit"], ["3", "win"]]);
  });

  it("double forfait gardant un 0-0 en colonnes : aucun score affiché", async () => {
    await mockTicker([resultRow({ winner_team_id: null, double_forfeit: 1, team1_score: 0, team2_score: 0 }, 1)]);
    const [item] = results((await getLandingTicker()).items);
    expect(item.sides.map((side) => side.score)).toEqual([null, null]);
  });

  it("double forfait sans score enregistré (DOUBLE_FORFEIT.md) : pas de score, jamais un 0 inventé", async () => {
    await mockTicker([resultRow({ winner_team_id: null, double_forfeit: 1, team1_score: null, team2_score: null }, 1)]);
    const [item] = results((await getLandingTicker()).items);
    expect(item.sides.map((side) => [side.score, side.sr])).toEqual([[null, "forfait"], [null, "forfait"]]);
  });

  it("nul : deux camps neutres et une note « sans vainqueur » (FR et EN)", async () => {
    await mockTicker([resultRow({ winner_team_id: null, team1_score: 1, team2_score: 1 }, 1)]);
    const [fr] = results((await getLandingTicker()).items);
    expect(fr.sides.map((side) => [side.outcome, side.sr])).toEqual([["none", null], ["none", null]]);
    expect(fr.sr).toBe("sans vainqueur");
    expect(results((await getLandingTicker("en")).items)[0].sr).toBe("no winner");
  });

  it("entrée solo, nom invisible ou ligne disparue : nom sans invisibles, sinon le repli « Équipe #id »", async () => {
    await mockTicker([resultRow({ team1_name: "  Pseudo​  Solo ", team2_name: "​", team2_id: 7 }, 1)]);
    const [item] = results((await getLandingTicker()).items);
    // Invisibles retirés, sans NFKC ni réduction des espaces (`UNTRUSTED_NAMES.md`).
    expect(item.sides.map((side) => side.name)).toEqual(["Pseudo  Solo", "Équipe #7"]);
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

// Revue de performance a posteriori #436 : les quatre lectures du bandeau
// étaient attendues l'une après l'autre.
describe("getLandingTicker — lectures côte à côte", () => {
  it("lance les quatre lectures avant qu'aucune n'ait répondu", async () => {
    const releases: Array<() => void> = [];
    const execute = jest.fn<SqlQuery>(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve([[]]));
        }),
    );
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const pending = getLandingTicker();
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(4);
    for (const release of releases) release();
    // Rien à montrer : les phrases d'attente.
    expect((await pending).items).toHaveLength(3);
  });

  it("une lecture en échec rend les phrases d'attente, les actualités gardent leur repli", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[resultRow({}, 1)]])
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(new Error("news down"));
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const { items } = await getLandingTicker();
    expect(results(items)).toEqual([]);
    expect(items).toHaveLength(3);
  });
});
