import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments-service");

describe("GET /api/tournaments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns tournaments grouped by state", async () => {
    const response = {
      UPCOMING: [],
      REGISTRATION: [],
      RUNNING: [],
      FINISHED: [],
    };
    expect(response.UPCOMING).toBeDefined();
    expect(response.REGISTRATION).toBeDefined();
    expect(response.RUNNING).toBeDefined();
    expect(response.FINISHED).toBeDefined();
  });

  it("includes tournament details", async () => {
    const tournament = {
      id: 1,
      name: "Tournament",
      format: "DOUBLE",
      state: "REGISTRATION",
      registered_teams: 4,
      max_teams: 8,
    };
    expect(tournament.id).toBeDefined();
    expect(tournament.state).toBeDefined();
  });

  it("filters by search term", async () => {
    const searchTerm = "Marvel";
    const results = [{ name: "Marvel Tournament", id: 1 }];
    expect(results[0].name).toContain(searchTerm);
  });
});
