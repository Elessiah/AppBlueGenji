import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  FALLBACK_ABOUT_STATS,
  createAboutStat,
  deleteAboutStat,
  listAboutStats,
  updateAboutStat,
} from "@/lib/server/about-stats-service";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

describe("about-stats-service", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  describe("listAboutStats", () => {
    it("returns rows from the database", async () => {
      const rows = [{ id: 1, value: "100%", label: "Bénévole" }];
      await mockDb(jest.fn().mockResolvedValue([rows]));

      const result = await listAboutStats();
      expect(result).toEqual([{ id: 1, value: "100%", label: "Bénévole" }]);
    });

    it("returns the fallback when the table is empty", async () => {
      await mockDb(jest.fn().mockResolvedValue([[]]));
      expect(await listAboutStats()).toBe(FALLBACK_ABOUT_STATS);
    });

    it("returns the fallback when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      (getDatabase as jest.Mock).mockRejectedValue(new Error("down"));
      expect(await listAboutStats()).toBe(FALLBACK_ABOUT_STATS);
    });
  });

  describe("createAboutStat", () => {
    it("inserts and returns the new stat", async () => {
      const execute = jest.fn().mockResolvedValue([{ insertId: 42 }]);
      await mockDb(execute);

      const stat = await createAboutStat({ value: "12", label: "Arbitres" });
      expect(stat).toEqual({ id: 42, value: "12", label: "Arbitres" });
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("rejects invalid input before touching the database", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(createAboutStat({ value: "", label: "Arbitres" })).rejects.toThrow("VALUE_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("updateAboutStat", () => {
    it("updates and returns the stat", async () => {
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);

      const stat = await updateAboutStat(7, { value: "0 €", label: "Frais d'inscription" });
      expect(stat).toEqual({ id: 7, value: "0 €", label: "Frais d'inscription" });
    });

    it("throws NOT_FOUND when no row matches", async () => {
      await mockDb(jest.fn().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(updateAboutStat(999, { value: "X", label: "Y" })).rejects.toThrow("ABOUT_STAT_NOT_FOUND");
    });

    it("rejects invalid input", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(updateAboutStat(1, { value: "X", label: "" })).rejects.toThrow("LABEL_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("deleteAboutStat", () => {
    it("deletes an existing stat", async () => {
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);
      await expect(deleteAboutStat(3)).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [3]);
    });

    it("throws NOT_FOUND when nothing is deleted", async () => {
      await mockDb(jest.fn().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(deleteAboutStat(999)).rejects.toThrow("ABOUT_STAT_NOT_FOUND");
    });
  });
});
