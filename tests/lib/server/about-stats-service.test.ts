import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  FALLBACK_ABOUT_STATS,
  createAboutStat,
  deleteAboutStat,
  listAboutStats,
  updateAboutStat,
} from "@/lib/server/about-stats-service";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

describe("about-stats-service", () => {
  // La vitrine est mutualisée (`lib/server/showcase-cache.ts`) : sans cette
  // remise à zéro, chaque cas resservirait la valeur du précédent.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("listAboutStats", () => {
    it("returns rows from the database", async () => {
      const rows = [
        { id: 1, value: "100%", value_en: null, label: "Bénévole", label_en: "Volunteer-run" },
        { id: 2, value: "0 €", value_en: "€0", label: "Frais", label_en: "Fee" },
      ];
      const execute = jest.fn<SqlQuery>().mockResolvedValue([rows]);
      await mockDb(execute);

      const result = await listAboutStats();
      expect(result).toEqual([
        { id: 1, value: "100%", valueEn: null, label: "Bénévole", labelEn: "Volunteer-run" },
        { id: 2, value: "0 €", valueEn: "€0", label: "Frais", labelEn: "Fee" },
      ]);
      expect(String(execute.mock.calls[0][0])).toContain("value_en");
    });

    it("returns the fallback when the table is empty", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));
      expect(await listAboutStats()).toBe(FALLBACK_ABOUT_STATS);
    });

    it("returns the fallback when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
      expect(await listAboutStats()).toBe(FALLBACK_ABOUT_STATS);
    });
  });

  describe("createAboutStat", () => {
    it("inserts and returns the new stat", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ insertId: 42 }]);
      await mockDb(execute);

      const stat = await createAboutStat({ labelEn: "EN", value: "12", label: "Arbitres" });
      expect(stat).toEqual({ id: 42, value: "12", valueEn: null, label: "Arbitres", labelEn: "EN" });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(String(execute.mock.calls[0][0])).toContain("value_en");
      expect(execute.mock.calls[0][1]).toEqual(["12", null, "Arbitres", "EN"]);
    });

    it("stores the trimmed English value", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ insertId: 43 }]);
      await mockDb(execute);

      const stat = await createAboutStat({ labelEn: "Fee", value: "0 €", valueEn: "  Free ", label: "Frais" });
      expect(stat.valueEn).toBe("Free");
      expect(execute.mock.calls[0][1]).toEqual(["0 €", "Free", "Frais", "Fee"]);
    });

    it("rejects an over-long English value before touching the database", async () => {
      const execute = jest.fn<SqlQuery>();
      await mockDb(execute);
      await expect(
        createAboutStat({ labelEn: "EN", value: "12", valueEn: "x".repeat(41), label: "Arbitres" }),
      ).rejects.toThrow("VALUE_EN_TOO_LONG");
      expect(execute).not.toHaveBeenCalled();
    });

    it("rejects invalid input before touching the database", async () => {
      const execute = jest.fn<SqlQuery>();
      await mockDb(execute);
      await expect(createAboutStat({ labelEn: "EN", value: "", label: "Arbitres" })).rejects.toThrow("VALUE_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("updateAboutStat", () => {
    it("updates and returns the stat", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);

      const stat = await updateAboutStat(7, { labelEn: "EN", value: "0 €", valueEn: "€0", label: "Frais d'inscription" });
      expect(stat).toEqual({ id: 7, value: "0 €", valueEn: "€0", label: "Frais d'inscription", labelEn: "EN" });
      expect(String(execute.mock.calls[0][0])).toContain("value_en = ?");
      expect(execute.mock.calls[0][1]).toEqual(["0 €", "€0", "Frais d'inscription", "EN", 7]);
    });

    it("clears the English value when it is emptied", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);

      const stat = await updateAboutStat(7, { labelEn: "EN", value: "12", valueEn: "  ", label: "Arbitres" });
      expect(stat.valueEn).toBeNull();
      expect(execute.mock.calls[0][1]).toEqual(["12", null, "Arbitres", "EN", 7]);
    });

    it("keeps the stored English value when the key is absent (stale admin tab)", async () => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ value_en: "€4,200" }]]);
      await mockDb(execute);

      const stat = await updateAboutStat(7, { labelEn: "EN", value: "€5 000", label: "Prizepool" });
      expect(String(execute.mock.calls[0][0])).not.toContain("value_en");
      expect(execute.mock.calls[0][1]).toEqual(["€5 000", "Prizepool", "EN", 7]);
      expect(stat).toEqual({ id: 7, value: "€5 000", valueEn: "€4,200", label: "Prizepool", labelEn: "EN" });
    });

    it("returns null when the key is absent and nothing was stored", async () => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ value_en: null }]]);
      await mockDb(execute);

      const stat = await updateAboutStat(7, { labelEn: "EN", value: "12", label: "Arbitres" });
      expect(stat.valueEn).toBeNull();
    });

    it("an explicit null clears the English value (key present)", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);

      await updateAboutStat(7, { labelEn: "EN", value: "12", valueEn: null, label: "Arbitres" });
      expect(String(execute.mock.calls[0][0])).toContain("value_en = ?");
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("throws NOT_FOUND when no row matches", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(updateAboutStat(999, { labelEn: "EN", value: "X", label: "Y" })).rejects.toThrow("ABOUT_STAT_NOT_FOUND");
    });

    it("rejects invalid input", async () => {
      const execute = jest.fn<SqlQuery>();
      await mockDb(execute);
      await expect(updateAboutStat(1, { labelEn: "EN", value: "X", label: "" })).rejects.toThrow("LABEL_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("deleteAboutStat", () => {
    it("deletes an existing stat", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);
      await expect(deleteAboutStat(3)).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [3]);
    });

    it("throws NOT_FOUND when nothing is deleted", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(deleteAboutStat(999)).rejects.toThrow("ABOUT_STAT_NOT_FOUND");
    });
  });
});
