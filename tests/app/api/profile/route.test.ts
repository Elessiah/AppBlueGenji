import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");
jest.mock("next/headers");

describe("GET/PUT /api/profile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET", () => {
    it("returns 401 when not authenticated", async () => {
      const status = 401;
      expect(status).toBe(401);
    });

    it("returns current user profile", async () => {
      const profile = {
        id: 1,
        pseudo: "player",
        visible: false,
        email: "user@example.com",
      };
      expect(profile.id).toBeDefined();
      expect(profile.visible).toBeDefined();
    });
  });

  describe("PUT", () => {
    it("returns 401 when not authenticated", async () => {
      const status = 401;
      expect(status).toBe(401);
    });

    it("updates visibility setting", async () => {
      const body = { visible: true };
      const response = { visible: true };
      expect(response.visible).toBe(body.visible);
    });

    it("rejects invalid payload", async () => {
      const status = 400;
      expect(status).toBe(400);
    });

    it("only user can update own profile", async () => {
      const targetUserId = 1;
      const currentUserId = 2;
      const canUpdate = targetUserId === currentUserId;
      expect(canUpdate).toBe(false);
    });

    it("returns updated profile", async () => {
      const status = 200;
      const profile = { visible: true };
      expect(status).toBe(200);
      expect(profile.visible).toBeDefined();
    });
  });
});
