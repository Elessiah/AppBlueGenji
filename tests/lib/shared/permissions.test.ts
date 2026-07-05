import { describe, expect, it } from "@jest/globals";
import {
  PLATFORM_ROLES,
  ROLE_LABELS,
  can,
  hasPermission,
  isPlatformRole,
  permissionsForRoles,
  sanitizePlatformRoles,
  type PlatformRole,
} from "@/lib/shared/permissions";

describe("permissions", () => {
  describe("isPlatformRole", () => {
    it("accepts known roles and rejects everything else", () => {
      expect(isPlatformRole("ADMIN")).toBe(true);
      expect(isPlatformRole("ARBITRE")).toBe(true);
      expect(isPlatformRole("COMMUNITY_MANAGER")).toBe(true);
      expect(isPlatformRole("RECRUTEUR")).toBe(true);
      expect(isPlatformRole("OWNER")).toBe(false);
      expect(isPlatformRole("admin")).toBe(false);
      expect(isPlatformRole(42)).toBe(false);
      expect(isPlatformRole(null)).toBe(false);
    });
  });

  describe("sanitizePlatformRoles", () => {
    it("filters invalid entries and deduplicates", () => {
      expect(sanitizePlatformRoles(["ARBITRE", "ARBITRE", "NOPE", 1, null])).toEqual(["ARBITRE"]);
    });

    it("returns a stable order regardless of input order", () => {
      expect(sanitizePlatformRoles(["RECRUTEUR", "ADMIN", "ARBITRE"])).toEqual([
        "ADMIN",
        "ARBITRE",
        "RECRUTEUR",
      ]);
    });

    it("parses a JSON string array", () => {
      expect(sanitizePlatformRoles('["COMMUNITY_MANAGER","RECRUTEUR"]')).toEqual([
        "COMMUNITY_MANAGER",
        "RECRUTEUR",
      ]);
    });

    it("returns [] for malformed or non-array input", () => {
      expect(sanitizePlatformRoles("not json")).toEqual([]);
      expect(sanitizePlatformRoles('{"a":1}')).toEqual([]);
      expect(sanitizePlatformRoles(null)).toEqual([]);
      expect(sanitizePlatformRoles(undefined)).toEqual([]);
      expect(sanitizePlatformRoles(123)).toEqual([]);
    });
  });

  describe("permissionsForRoles", () => {
    it("maps each role to its scope", () => {
      expect([...permissionsForRoles(["ARBITRE"])]).toEqual(["tournaments"]);
      expect([...permissionsForRoles(["COMMUNITY_MANAGER"])]).toEqual(["showcase"]);
      expect([...permissionsForRoles(["RECRUTEUR"])]).toEqual(["recruitment"]);
    });

    it("grants every scope to ADMIN", () => {
      const perms = permissionsForRoles(["ADMIN"]);
      expect(perms).toEqual(new Set(["tournaments", "showcase", "recruitment", "roles"]));
    });

    it("cumulates permissions across roles", () => {
      const perms = permissionsForRoles(["ARBITRE", "RECRUTEUR"]);
      expect(perms).toEqual(new Set(["tournaments", "recruitment"]));
    });

    it("returns an empty set for no roles", () => {
      expect(permissionsForRoles([])).toEqual(new Set());
    });
  });

  describe("hasPermission", () => {
    it("checks a single scope", () => {
      expect(hasPermission(["ARBITRE"], "tournaments")).toBe(true);
      expect(hasPermission(["ARBITRE"], "showcase")).toBe(false);
      expect(hasPermission(["ARBITRE"], "roles")).toBe(false);
    });

    it("reserves the roles scope to ADMIN", () => {
      expect(hasPermission(["ADMIN"], "roles")).toBe(true);
      expect(hasPermission(["COMMUNITY_MANAGER", "RECRUTEUR"], "roles")).toBe(false);
    });

    it("is safe on null/undefined", () => {
      expect(hasPermission(null, "tournaments")).toBe(false);
      expect(hasPermission(undefined, "tournaments")).toBe(false);
    });
  });

  describe("can", () => {
    it("returns false for anonymous users", () => {
      expect(can(null, "tournaments")).toBe(false);
      expect(can(undefined, "showcase")).toBe(false);
    });

    it("grants everything to an admin (isAdmin shortcut)", () => {
      const admin = { isAdmin: true } as const;
      expect(can(admin, "tournaments")).toBe(true);
      expect(can(admin, "showcase")).toBe(true);
      expect(can(admin, "recruitment")).toBe(true);
      expect(can(admin, "roles")).toBe(true);
    });

    it("scopes a non-admin to its cumulative roles", () => {
      const user = { isAdmin: false, roles: ["ARBITRE", "RECRUTEUR"] as PlatformRole[] };
      expect(can(user, "tournaments")).toBe(true);
      expect(can(user, "recruitment")).toBe(true);
      expect(can(user, "showcase")).toBe(false);
      expect(can(user, "roles")).toBe(false);
    });
  });

  describe("metadata", () => {
    it("has a label for every role", () => {
      for (const role of PLATFORM_ROLES) {
        expect(typeof ROLE_LABELS[role]).toBe("string");
        expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
      }
    });
  });
});
