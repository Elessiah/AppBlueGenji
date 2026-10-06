import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getLandingTicker } from "@/lib/server/landing-service";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/**
 * Bandeau de l'accueil dans les deux langues (lot 2) : un seul chargement mis
 * en cache, la phrase rédigée à la sortie ; les titres d'actualité, saisis en
 * français, ne passent pas en anglais.
 */
async function mockRows(execute: jest.Mock<SqlQuery>) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

function rowsExecute() {
  return jest
    .fn<SqlQuery>()
    .mockResolvedValueOnce([[
      { updated_at: new Date("2026-10-05T10:00:00Z"), tournament_name: "Alpha Cup", team1_name: "Alpha", team2_name: null, team1_score: 2, team2_score: 1, team1_id: 1, team2_id: 7 },
    ]])
    .mockResolvedValueOnce([[
      { start_at: new Date("2026-10-10T10:00:00Z"), registration_open_at: new Date("2026-10-04T10:00:00Z"), name: "Beta Open", registered_teams: 3, max_teams: 8 },
    ]])
    .mockResolvedValueOnce([[
      { finished_at: new Date("2026-10-03T10:00:00Z"), name: "Gamma League", winner_name: null, winner_team_id: 9 },
      { finished_at: new Date("2026-10-02T10:00:00Z"), name: "Delta Cup", winner_name: null, winner_team_id: null },
    ]])
    .mockResolvedValueOnce([[{ title: "Nouvelle saison annoncée", created_at: new Date("2026-10-06T10:00:00Z") }]]);
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

describe("getLandingTicker", () => {
  it("français : les phrases de toujours, actualités comprises", async () => {
    await mockRows(rowsExecute());
    expect((await getLandingTicker()).items).toEqual([
      "NEWS · Nouvelle saison annoncée",
      "RÉSULTAT · Alpha Cup · Alpha 2 — Équipe #7 1",
      "INSCRIPTIONS · Beta Open · 3/8 équipes",
      "VAINQUEUR · Gamma League · Équipe #9",
      "VAINQUEUR · Delta Cup · Champion inconnu",
    ]);
  });

  it("anglais : mêmes entrées, rédigées en anglais, sans les titres d'actualité", async () => {
    const execute = rowsExecute();
    await mockRows(execute);
    await getLandingTicker("fr");
    // Le cache sert les deux langues : aucune requête de plus.
    const calls = execute.mock.calls.length;
    expect((await getLandingTicker("en")).items).toEqual([
      "RESULT · Alpha Cup · Alpha 2 — Team #7 1",
      "REGISTRATION OPEN · Beta Open · 3/8 teams",
      "WINNER · Gamma League · Team #9",
      "WINNER · Delta Cup · Unknown champion",
    ]);
    expect(execute.mock.calls).toHaveLength(calls);
  });

  it("sans actualité ni base : le bandeau d'attente, dans la langue de la page", async () => {
    await mockRows(jest.fn<SqlQuery>().mockRejectedValue(new Error("DB_DOWN")));
    expect((await getLandingTicker("en")).items).toEqual([
      "RESULT · Waiting for new matches",
      "REGISTRATION OPEN · More brackets coming soon",
      "COMMUNITY · Join the BlueGenji Discord",
    ]);
    expect((await getLandingTicker()).items[0]).toBe("RÉSULTAT · En attente de nouveaux matches");
  });
});
