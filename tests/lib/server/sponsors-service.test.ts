import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  FALLBACK_SPONSORS,
  createSponsor,
  deleteSponsor,
  listSponsors,
  updateSponsor,
} from "@/lib/server/sponsors-service";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

describe("sponsors-service", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  describe("listSponsors", () => {
    it("returns rows from the database", async () => {
      const rows = [
        { id: 1, name: "HyperX", slug: "hyperx", tier: "GOLD", logoUrl: null, websiteUrl: "https://x", description: null },
      ];
      await mockDb(jest.fn().mockResolvedValue([rows]));

      const result = await listSponsors();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("HyperX");
    });

    it("returns the fallback when the table is empty", async () => {
      await mockDb(jest.fn().mockResolvedValue([[]]));
      expect(await listSponsors()).toBe(FALLBACK_SPONSORS);
    });

    it("returns the fallback when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      (getDatabase as jest.Mock).mockRejectedValue(new Error("down"));
      expect(await listSponsors()).toBe(FALLBACK_SPONSORS);
    });
  });

  describe("createSponsor", () => {
    it("derives a unique slug, inserts and returns the new sponsor", async () => {
      // 1st execute: slug uniqueness check (free) → []. 2nd: INSERT.
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[]]) // slug "logitech-g" is free
        .mockResolvedValueOnce([{ insertId: 7 }]);
      await mockDb(execute);

      const sponsor = await createSponsor({ name: "Logitech G", tier: "SILVER", websiteUrl: "https://l" });
      expect(sponsor).toEqual({
        id: 7,
        name: "Logitech G",
        slug: "logitech-g",
        tier: "SILVER",
        logoUrl: null,
        websiteUrl: "https://l",
        description: null,
      });
    });

    it("suffixes the slug when it already exists", async () => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[{ id: 99 }]]) // "razer" taken
        .mockResolvedValueOnce([[]]) // "razer-2" free
        .mockResolvedValueOnce([{ insertId: 8 }]);
      await mockDb(execute);

      const sponsor = await createSponsor({ name: "Razer" });
      expect(sponsor.slug).toBe("razer-2");
    });

    it("rejects invalid input before touching the database", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(createSponsor({ name: "" })).rejects.toThrow("NAME_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("updateSponsor", () => {
    it("keeps the existing slug and returns the updated sponsor", async () => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[{ slug: "hyperx" }]]) // SELECT existing slug
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE
      await mockDb(execute);

      const sponsor = await updateSponsor(3, { name: "HyperX Pro", tier: "GOLD" });
      expect(sponsor).toEqual({
        id: 3,
        name: "HyperX Pro",
        slug: "hyperx",
        tier: "GOLD",
        logoUrl: null,
        websiteUrl: null,
        description: null,
      });
    });

    it("throws NOT_FOUND when the sponsor does not exist", async () => {
      await mockDb(jest.fn().mockResolvedValueOnce([[]]));
      await expect(updateSponsor(999, { name: "X" })).rejects.toThrow("SPONSOR_NOT_FOUND");
    });

    it("rejects invalid input", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(updateSponsor(1, { name: "X", tier: "BOGUS" })).rejects.toThrow("INVALID_TIER");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("deleteSponsor", () => {
    it("deletes an existing sponsor", async () => {
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);
      await expect(deleteSponsor(4)).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [4]);
    });

    it("throws NOT_FOUND when nothing is deleted", async () => {
      await mockDb(jest.fn().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(deleteSponsor(999)).rejects.toThrow("SPONSOR_NOT_FOUND");
    });
  });
});
