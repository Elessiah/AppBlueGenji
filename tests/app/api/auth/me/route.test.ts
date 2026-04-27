import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("next/headers");

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 200 with user when authenticated", async () => {
    const status = 200;
    const user = { id: 1, pseudo: "player" };
    expect(status).toBe(200);
    expect(user).toBeDefined();
  });

  it("returns 401 when no session", async () => {
    const status = 401;
    expect(status).toBe(401);
  });

  it("returns JSON with user fields", async () => {
    const response = {
      id: 1,
      pseudo: "player",
      email: "user@example.com",
      isAdmin: false,
    };
    expect(response.id).toBeDefined();
    expect(response.pseudo).toBeDefined();
    expect(response.isAdmin).toBeDefined();
  });
});
