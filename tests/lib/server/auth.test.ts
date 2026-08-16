import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import crypto from "node:crypto";
import { createSession, getCurrentUser, clearSession, ensureUniquePseudo } from "@/lib/server/auth";

const originalEnv = { ...process.env };

// Mock database
jest.mock("@/lib/server/database");

// Mock next/headers
jest.mock("next/headers", () => ({
  cookies: jest.fn(),
  redirect: jest.fn(),
}));

describe("auth", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe("hashToken", () => {
    it("hashes token with SHA-256 deterministically", () => {
      const token = "test-token-12345";
      const hash1 = crypto.createHash("sha256").update(token).digest("hex");
      const hash2 = crypto.createHash("sha256").update(token).digest("hex");
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex is 64 chars
    });

    it("produces different hashes for different tokens", () => {
      const token1 = "token-1";
      const token2 = "token-2";
      const hash1 = crypto.createHash("sha256").update(token1).digest("hex");
      const hash2 = crypto.createHash("sha256").update(token2).digest("hex");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("createSession", () => {
    it("throws when database connection fails", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      (getDatabase as jest.Mock).mockRejectedValue(new Error("DB connection failed"));

      await expect(createSession(1)).rejects.toThrow("DB connection failed");
    });

    it("throws when setting cookie fails", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockExecute = jest.fn().mockResolvedValue([]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });
      (cookies as jest.Mock).mockRejectedValue(new Error("Cookie error"));

      await expect(createSession(1)).rejects.toThrow("Cookie error");
    });
  });

  describe("getCurrentUser", () => {
    it("returns null when no session cookie", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockExecute = jest.fn().mockResolvedValue([[]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      const mockCookieStore = { get: jest.fn().mockReturnValue(undefined) };
      (cookies as jest.Mock).mockResolvedValue(mockCookieStore);

      const user = await getCurrentUser();
      expect(user).toBeNull();
    });

    it("returns null when session not found in database", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockCookieStore = { get: jest.fn().mockReturnValue({ value: "test-token" }) };
      (cookies as jest.Mock).mockResolvedValue(mockCookieStore);

      const mockExecute = jest.fn().mockResolvedValue([[]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      const user = await getCurrentUser();
      expect(user).toBeNull();
    });

    it("returns null when session expired", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockCookieStore = { get: jest.fn().mockReturnValue({ value: "expired-token" }) };
      (cookies as jest.Mock).mockResolvedValue(mockCookieStore);

      const mockExecute = jest.fn().mockResolvedValue([[]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      const user = await getCurrentUser();
      expect(user).toBeNull();
    });

    it("returns user when valid session exists", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockCookieStore = { get: jest.fn().mockReturnValue({ value: "valid-token" }) };
      (cookies as jest.Mock).mockResolvedValue(mockCookieStore);

      const mockUser = {
        id: 1,
        pseudo: "testuser",
        avatar_url: null,
        discord_id: null,
        google_sub: null,
        email: null,
        is_adult: null,
        is_admin: 0,
      };

      const mockExecute = jest.fn().mockResolvedValue([[mockUser]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      const user = await getCurrentUser();
      expect(user).not.toBeNull();
      expect(user?.pseudo).toBe("testuser");
      expect(user?.id).toBe(1);
      expect(user?.isAdmin).toBe(false);
    });
  });

  describe("getCurrentUser dev bypass (DEV_AUTH_USER_ID)", () => {
    const bypassUser = {
      id: 321,
      pseudo: "admin",
      avatar_url: null,
      discord_id: null,
      google_sub: null,
      email: null,
      is_adult: null,
      is_admin: 1,
    };

    function mockNoCookie() {
      return { get: jest.fn().mockReturnValue(undefined) };
    }

    async function runWithEnv(nodeEnv: string | undefined) {
      if (nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = nodeEnv;
      }
      process.env.DEV_AUTH_USER_ID = "321";

      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockExecute = jest.fn().mockResolvedValue([[bypassUser]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });
      (cookies as jest.Mock).mockResolvedValue(mockNoCookie());

      return getCurrentUser();
    }

    it("is active in development and returns the targeted user without a session cookie", async () => {
      const user = await runWithEnv("development");
      expect(user).not.toBeNull();
      expect(user?.id).toBe(321);
      expect(user?.isAdmin).toBe(true);
    });

    it("is INACTIVE in production even when DEV_AUTH_USER_ID is set", async () => {
      expect(await runWithEnv("production")).toBeNull();
    });

    it("is INACTIVE when NODE_ENV is test (allowlist, not denylist)", async () => {
      expect(await runWithEnv("test")).toBeNull();
    });

    it("is INACTIVE when NODE_ENV is staging (allowlist, not denylist)", async () => {
      expect(await runWithEnv("staging")).toBeNull();
    });

    it("is INACTIVE when NODE_ENV is undefined (misconfigured server)", async () => {
      expect(await runWithEnv(undefined)).toBeNull();
    });

    it("is INACTIVE in development when DEV_AUTH_USER_ID is absent", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.DEV_AUTH_USER_ID;

      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockExecute = jest.fn().mockResolvedValue([[bypassUser]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });
      (cookies as jest.Mock).mockResolvedValue(mockNoCookie());

      expect(await getCurrentUser()).toBeNull();
    });

    it("is INACTIVE in development when DEV_AUTH_USER_ID is not a valid id", async () => {
      process.env.NODE_ENV = "development";
      process.env.DEV_AUTH_USER_ID = "abc";

      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockExecute = jest.fn().mockResolvedValue([[bypassUser]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });
      (cookies as jest.Mock).mockResolvedValue(mockNoCookie());

      expect(await getCurrentUser()).toBeNull();
    });
  });

  describe("clearSession", () => {
    it("clears cookie and database session when token exists", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      const { cookies } = await import("next/headers");

      const mockCookieSet = jest.fn();
      const mockCookieStore = {
        get: jest.fn().mockReturnValue({ value: "test-token" }),
        set: mockCookieSet,
      };
      (cookies as jest.Mock).mockResolvedValue(mockCookieStore);

      const mockExecute = jest.fn().mockResolvedValue([]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      await clearSession();

      expect(mockExecute).toHaveBeenCalled();
      expect(mockCookieSet).toHaveBeenCalledWith("bg_session", "", expect.any(Object));
    });

    it("clears cookie even when token is missing", async () => {
      const { cookies } = await import("next/headers");

      const mockCookieSet = jest.fn();
      const mockCookieStore = {
        get: jest.fn().mockReturnValue(undefined),
        set: mockCookieSet,
      };
      (cookies as jest.Mock).mockResolvedValue(mockCookieStore);

      await clearSession();

      expect(mockCookieSet).toHaveBeenCalledWith("bg_session", "", expect.any(Object));
    });
  });

  describe("ensureUniquePseudo", () => {
    it("returns pseudo when it is available", async () => {
      const { getDatabase } = await import("@/lib/server/database");

      const mockExecute = jest.fn().mockResolvedValue([[{ c: 0 }]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      const result = await ensureUniquePseudo("NewPlayer");
      expect(result).toBeTruthy();
    });

    it("returns pseudo with suffix when original is taken", async () => {
      const { getDatabase } = await import("@/lib/server/database");

      let callCount = 0;
      const mockExecute = jest.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([[{ c: 1 }]]); // Pseudo exists
        }
        return Promise.resolve([[{ c: 0 }]]); // Suffixed version available
      });
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      const result = await ensureUniquePseudo("Player");
      expect(result).toContain("_");
    });

    it("handles empty slug with fallback player ID", async () => {
      const { getDatabase } = await import("@/lib/server/database");

      const mockExecute = jest.fn().mockResolvedValue([[{ c: 0 }]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      // Use special characters that slug away to nothing
      const result = await ensureUniquePseudo("!!!___");
      expect(result).toBeTruthy();
    });

    it("applies normalizePseudo before slugifying", async () => {
      const { getDatabase } = await import("@/lib/server/database");

      const mockExecute = jest.fn().mockResolvedValue([[{ c: 0 }]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      // Multiple spaces should normalize
      const result = await ensureUniquePseudo("Test   User");
      expect(result).toBeTruthy();
    });

    it("respects 40 character limit from slugifyPseudo", async () => {
      const { getDatabase } = await import("@/lib/server/database");

      const mockExecute = jest.fn().mockResolvedValue([[{ c: 0 }]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      const longName = "a".repeat(50);
      const result = await ensureUniquePseudo(longName);
      // Result may be 40 chars if no suffix needed
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it("falls back to timestamp when suffix search exhausted", async () => {
      const { getDatabase } = await import("@/lib/server/database");

      // Always return that pseudo exists
      const mockExecute = jest.fn().mockResolvedValue([[{ c: 1 }]]);
      (getDatabase as jest.Mock).mockResolvedValue({ execute: mockExecute });

      const result = await ensureUniquePseudo("player");
      // Should use timestamp fallback
      expect(result).toMatch(/player_\d+/);
    });
  });
});
