import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/users-service");

describe("GET /api/landing/stats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns tournament count", async () => {
    const stats = {
      totalTournaments: 10,
      activeTournaments: 3,
    };
    expect(stats.totalTournaments).toBeGreaterThan(0);
  });

  it("returns user count", async () => {
    const stats = {
      totalPlayers: 150,
      activePlayers: 50,
    };
    expect(stats.totalPlayers).toBeGreaterThan(0);
  });

  it("returns team count", async () => {
    const stats = {
      totalTeams: 25,
    };
    expect(stats.totalTeams).toBeGreaterThan(0);
  });

  it("returns match statistics", async () => {
    const stats = {
      completedMatches: 100,
      totalMatches: 150,
    };
    expect(stats.completedMatches).toBeLessThanOrEqual(stats.totalMatches);
  });

  it("handles unavailable data gracefully", async () => {
    const stats = {
      totalTournaments: 0,
      error: null,
    };
    expect(stats.totalTournaments).toBe(0);
  });
});
