import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { loadMiniBracket } from "@/lib/server/tournaments/bracket-loader";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/** Le mini-arbre de l'accueil : une place vide ne montre jamais un libellé d'attente français sous `/en`. */
const ROWS = [
  { id: 1, team1_name: "Alpha", team2_name: null, team1_placeholder: null, team2_placeholder: "Gagnant du upper bracket", team1_score: null, team2_score: null },
  { id: 2, team1_name: null, team2_name: null, team1_placeholder: null, team2_placeholder: null, team1_score: 1, team2_score: 0 },
];

beforeEach(async () => {
  jest.clearAllMocks();
  clearCache();
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([ROWS]) }));
});

describe("loadMiniBracket", () => {
  it("français : libellés d'attente traduits à la lecture, « À venir » sinon", async () => {
    expect(await loadMiniBracket(5)).toEqual([
      { a: "Alpha", b: "Vainqueur du tableau principal", sa: "—", sb: "—" },
      { a: "À venir", b: "À venir", sa: 1, sb: 0 },
    ]);
  });

  it("anglais : toute place vide se lit « TBD »", async () => {
    expect(await loadMiniBracket(5, "en")).toEqual([
      { a: "Alpha", b: "TBD", sa: "—", sb: "—" },
      { a: "TBD", b: "TBD", sa: 1, sb: 0 },
    ]);
  });
});
