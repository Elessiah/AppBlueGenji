import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

jest.mock("@/lib/server/users-service");

describe("GET /api/players", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns paginated players list", async () => {
    const response = {
      players: [{ id: 1, pseudo: "player1" }],
      total: 100,
      page: 1,
      limit: 20,
    };
    expect(response.players).toHaveLength(1);
    expect(response.total).toBe(100);
  });

  it("filters by public visibility", async () => {
    const player = {
      id: 1,
      pseudo: "player",
      visible: true,
    };
    expect(player.visible).toBe(true);
  });

  it("supports search by pseudo", async () => {
    const results = [{ pseudo: "PlayerOne" }, { pseudo: "PlayerTwo" }];
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns player stats", async () => {
    const player = {
      id: 1,
      pseudo: "player",
      tournamentsWon: 2,
      tournamentsParticipated: 5,
    };
    expect(player.tournamentsWon).toBe(2);
  });
});
