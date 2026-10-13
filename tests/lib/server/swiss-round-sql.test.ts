import { describe, expect, it } from "@jest/globals";
import { isSwissRound, swissPhaseSql, swissRoundSql } from "@/lib/server/tournaments/swiss-round-sql";

describe("swissRoundSql", () => {
  it("lit le format du tournoi, puis celui de la phase par sa clé primaire", () => {
    const sql = swissRoundSql("m", "t");
    expect(sql).toContain("t.format = 'SWISS'");
    expect(sql).toContain("m.phase_id <> 0");
    expect(sql).toContain("sp.id = m.phase_id AND sp.format = 'SWISS'");
    expect(sql).toMatch(/AS swiss_round$/);
  });

  it("suit les alias de la requête", () => {
    expect(swissRoundSql("mm", "tr")).toContain("tr.format = 'SWISS' OR (mm.phase_id <> 0");
  });
});

describe("swissPhaseSql", () => {
  it("ne lit que la phase, pour un appelant qui tient déjà le format du tournoi", () => {
    const sql = swissPhaseSql("m");
    expect(sql).not.toContain("format = 'SWISS' OR");
    expect(sql).toContain("sp.id = m.phase_id AND sp.format = 'SWISS'");
    expect(swissRoundSql("m", "t")).toContain(sql);
  });
});

describe("isSwissRound", () => {
  it("lit le booléen rendu en 0 / 1 par MySQL", () => {
    expect(isSwissRound({ swiss_round: 1 })).toBe(true);
    expect(isSwissRound({ swiss_round: "1" })).toBe(true);
    expect(isSwissRound({ swiss_round: 0 })).toBe(false);
    expect(isSwissRound({})).toBe(false);
    expect(isSwissRound({ swiss_round: null })).toBe(false);
  });
});
