import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  FALLBACK_SPONSORS,
  createSponsor,
  deleteSponsor,
  getSponsorImageUrls,
  getSponsorLogoUrl,
  listSponsors,
  updateSponsor,
} from "@/lib/server/sponsors-service";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

describe("sponsors-service", () => {
  // La vitrine est mutualisée (`lib/server/showcase-cache.ts`) : sans cette
  // remise à zéro, chaque cas resservirait la valeur du précédent.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("listSponsors", () => {
    it("returns rows from the database", async () => {
      const rows = [
        { id: 1, name: "HyperX", slug: "hyperx", tier: "GOLD", logoUrl: null, websiteUrl: "https://x", description: null },
      ];
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([rows]));

      const result = await listSponsors();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("HyperX");
      // Une ligne lue sans la colonne (base pas encore migrée) n'est pas `undefined`.
      expect(result[0].bannerUrl).toBeNull();
    });

    it("reads the banner column", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([[
        { id: 1, name: "A", slug: "a", tier: "GOLD", logoUrl: null, bannerUrl: "/api/uploads/sponsors/b.webp", websiteUrl: null, description: "Musique" },
      ]]);
      await mockDb(execute);

      const [sponsor] = await listSponsors();
      expect(sponsor.bannerUrl).toBe("/api/uploads/sponsors/b.webp");
      expect(sponsor.description).toBe("Musique");
      expect(execute.mock.calls[0][0]).toContain("banner_url as bannerUrl");
    });

    it("returns the fallback when the table is empty", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));
      expect(await listSponsors()).toBe(FALLBACK_SPONSORS);
    });

    it("returns the fallback when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
      expect(await listSponsors()).toBe(FALLBACK_SPONSORS);
    });
  });

  describe("createSponsor", () => {
    it("derives a unique slug, inserts and returns the new sponsor", async () => {
      // 1st execute: slug uniqueness check (free) → []. 2nd: INSERT.
      const execute = jest
        .fn<SqlQuery>()
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
        bannerUrl: null,
        websiteUrl: "https://l",
        description: null,
      });
    });

    it("suffixes the slug when it already exists", async () => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[{ id: 99 }]]) // "razer" taken
        .mockResolvedValueOnce([[]]) // "razer-2" free
        .mockResolvedValueOnce([{ insertId: 8 }]);
      await mockDb(execute);

      const sponsor = await createSponsor({ name: "Razer" });
      expect(sponsor.slug).toBe("razer-2");
    });

    it("writes the banner url in the INSERT", async () => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 9 }]);
      await mockDb(execute);

      const sponsor = await createSponsor({ name: "Akiu", bannerUrl: "/api/uploads/sponsors/b.webp" });
      expect(sponsor.bannerUrl).toBe("/api/uploads/sponsors/b.webp");
      const [sql, values] = execute.mock.calls[1];
      expect(sql).toContain("banner_url");
      expect(values).toContain("/api/uploads/sponsors/b.webp");
    });

    it("rejects invalid input before touching the database", async () => {
      const execute = jest.fn<SqlQuery>();
      await mockDb(execute);
      await expect(createSponsor({ name: "" })).rejects.toThrow("NAME_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("updateSponsor", () => {
    it("keeps the existing slug and returns the updated sponsor", async () => {
      const execute = jest
        .fn<SqlQuery>()
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
        bannerUrl: null,
        websiteUrl: null,
        description: null,
      });
    });

    it("writes the banner url in the UPDATE", async () => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[{ slug: "akiu" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      await mockDb(execute);

      await updateSponsor(3, { name: "Akiu", bannerUrl: "/uploads/sponsors/b.webp" });
      const [sql, values] = execute.mock.calls[1];
      expect(sql).toContain("banner_url = ?");
      expect(values).toContain("/uploads/sponsors/b.webp");
    });

    it("throws NOT_FOUND when the sponsor does not exist", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValueOnce([[]]));
      await expect(updateSponsor(999, { name: "X" })).rejects.toThrow("SPONSOR_NOT_FOUND");
    });

    it("rejects invalid input", async () => {
      const execute = jest.fn<SqlQuery>();
      await mockDb(execute);
      await expect(updateSponsor(1, { name: "X", tier: "BOGUS" })).rejects.toThrow("INVALID_TIER");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("getSponsorLogoUrl", () => {
    it("returns the stored logo url", async () => {
      await mockDb(jest
        .fn<SqlQuery>()
        .mockResolvedValue([[{ logoUrl: "/uploads/sponsors/1-a.webp" }]]));
      expect(await getSponsorLogoUrl(1)).toBe("/uploads/sponsors/1-a.webp");
    });

    it("returns null when the sponsor does not exist", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));
      expect(await getSponsorLogoUrl(999)).toBeNull();
    });

    it("ne relit que les partenaires publiés — un brouillon n'est pas relayé", async () => {
      // Le relais est public et sans compte : énumérer les identifiants ne doit
      // pas révéler le logo d'un partenariat en préparation.
      const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
      await mockDb(execute);
      expect(await getSponsorLogoUrl(3)).toBeNull();
      const [sql, params] = execute.mock.calls[0];
      expect(sql).toMatch(/WHERE id = \? AND active = 1/);
      expect(params).toEqual([3]);
    });
  });

  describe("getSponsorImageUrls", () => {
    it("returns both stored image urls", async () => {
      await mockDb(jest
        .fn<SqlQuery>()
        .mockResolvedValue([[{ logoUrl: "https://cdn/l.png", bannerUrl: "/uploads/sponsors/b.webp" }]]));
      expect(await getSponsorImageUrls(1)).toEqual({
        logoUrl: "https://cdn/l.png",
        bannerUrl: "/uploads/sponsors/b.webp",
      });
    });

    it("returns nulls when the sponsor does not exist", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));
      expect(await getSponsorImageUrls(999)).toEqual({ logoUrl: null, bannerUrl: null });
    });
  });

  describe("deleteSponsor", () => {
    it("deletes an existing sponsor", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);
      await expect(deleteSponsor(4)).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [4]);
    });

    it("throws NOT_FOUND when nothing is deleted", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(deleteSponsor(999)).rejects.toThrow("SPONSOR_NOT_FOUND");
    });
  });
});
