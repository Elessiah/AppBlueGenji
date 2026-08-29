import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  FALLBACK_ABOUT_PILLARS,
  createAboutPillar,
  deleteAboutPillar,
  listAboutPillars,
  updateAboutPillar,
} from "@/lib/server/about-pillars-service";
import { clearCache } from "@/lib/server/cache";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

describe("about-pillars-service", () => {
  // La vitrine est mutualisée (`lib/server/showcase-cache.ts`) : sans cette
  // remise à zéro, chaque cas resservirait la valeur du précédent.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => jest.restoreAllMocks());

  describe("listAboutPillars", () => {
    it("returns rows from the database", async () => {
      const rows = [{ id: 1, title: "Accessible", text: "Inscription gratuite." }];
      await mockDb(jest.fn().mockResolvedValue([rows]));

      const result = await listAboutPillars();
      expect(result).toEqual([{ id: 1, title: "Accessible", text: "Inscription gratuite." }]);
    });

    it("returns the fallback when the table is empty", async () => {
      await mockDb(jest.fn().mockResolvedValue([[]]));
      expect(await listAboutPillars()).toBe(FALLBACK_ABOUT_PILLARS);
    });

    it("returns the fallback when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      (getDatabase as jest.Mock).mockRejectedValue(new Error("down"));
      expect(await listAboutPillars()).toBe(FALLBACK_ABOUT_PILLARS);
    });
  });

  describe("createAboutPillar", () => {
    it("inserts and returns the new pillar", async () => {
      const execute = jest.fn().mockResolvedValue([{ insertId: 42 }]);
      await mockDb(execute);

      const pillar = await createAboutPillar({ title: "Compétitif", text: "Brackets arbitrés." });
      expect(pillar).toEqual({ id: 42, title: "Compétitif", text: "Brackets arbitrés." });
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("rejects invalid input before touching the database", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(createAboutPillar({ title: "", text: "Brackets arbitrés." })).rejects.toThrow(
        "TITLE_REQUIRED",
      );
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("updateAboutPillar", () => {
    it("updates and returns the pillar", async () => {
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);

      const pillar = await updateAboutPillar(7, { title: "Communautaire", text: "Watch parties." });
      expect(pillar).toEqual({ id: 7, title: "Communautaire", text: "Watch parties." });
    });

    it("throws NOT_FOUND when no row matches", async () => {
      await mockDb(jest.fn().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(updateAboutPillar(999, { title: "X", text: "Y" })).rejects.toThrow(
        "ABOUT_PILLAR_NOT_FOUND",
      );
    });

    it("rejects invalid input", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(updateAboutPillar(1, { title: "X", text: "" })).rejects.toThrow("TEXT_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("deleteAboutPillar", () => {
    it("deletes an existing pillar", async () => {
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);
      await expect(deleteAboutPillar(3)).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [3]);
    });

    it("throws NOT_FOUND when nothing is deleted", async () => {
      await mockDb(jest.fn().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(deleteAboutPillar(999)).rejects.toThrow("ABOUT_PILLAR_NOT_FOUND");
    });
  });
});
