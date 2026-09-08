import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  createRecruitmentAd,
  deleteRecruitmentAd,
  getHighlightedAd,
  listRecruitmentAds,
  updateRecruitmentAd,
} from "@/lib/server/recruitment-service";
import { selectHighlightedAd } from "@/lib/shared/recruitment";
import { clearCache } from "@/lib/server/cache";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

/** Ligne minimale d'annonce mise en avant, telle que la remonte la requête. */
const HIGHLIGHT_ROW = {
  id: 5,
  title: "URGENT",
  team_name: null,
  domain: "AUTRE",
  roles: null,
  body: null,
  contact_url: null,
  contact_discord: null,
  contact_discord_id: null,
  contact_preferred: "AUTO",
  highlight: "BANNER",
  active: 1,
};

describe("recruitment-service", () => {
  // Les lectures publiques sont mutualisées (`showcase-cache`) : sans cette
  // remise à zéro, le premier cas resservirait sa réponse à tous les suivants.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    clearCache();
    jest.restoreAllMocks();
  });

  describe("listRecruitmentAds", () => {
    it("returns mapped rows and filters inactive by default", async () => {
      const execute = jest.fn().mockResolvedValue([
        [
          {
            id: 2,
            title: "Recherche arbitre",
            team_name: "Pôle arbitrage",
            domain: "ARBITRAGE",
            roles: "Arbitrage",
            body: null,
            contact_url: null,
            contact_discord: "arbitre_bg",
            contact_discord_id: "123456789012345678",
            contact_preferred: "DISCORD",
            highlight: "NONE",
            active: 1,
          },
        ],
      ]);
      await mockDb(execute);

      const result = await listRecruitmentAds();
      expect(result).toEqual([
        {
          id: 2,
          title: "Recherche arbitre",
          teamName: "Pôle arbitrage",
          domain: "ARBITRAGE",
          roles: "Arbitrage",
          body: null,
          contactUrl: null,
          contactDiscord: "arbitre_bg",
          contactDiscordId: "123456789012345678",
          contactPreferred: "DISCORD",
          highlight: "NONE",
          active: true,
        },
      ]);
      expect(execute.mock.calls[0][0]).toContain("WHERE active = 1");
    });

    it("includes inactive ads when asked (admin view)", async () => {
      const execute = jest.fn().mockResolvedValue([[]]);
      await mockDb(execute);
      await listRecruitmentAds(true);
      expect(execute.mock.calls[0][0]).not.toContain("WHERE active = 1");
    });

    it("returns [] when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      (getDatabase as jest.Mock).mockRejectedValue(new Error("down"));
      expect(await listRecruitmentAds()).toEqual([]);
    });
  });

  describe("getHighlightedAd", () => {
    it("returns the first highlighted active ad", async () => {
      const execute = jest.fn().mockResolvedValue([
        [
          {
            id: 5,
            title: "URGENT",
            team_name: null,
            domain: "AUTRE",
            roles: null,
            body: null,
            contact_url: null,
            highlight: "BANNER",
            active: 1,
          },
        ],
      ]);
      await mockDb(execute);
      const ad = await getHighlightedAd();
      expect(ad?.id).toBe(5);
      expect(ad?.highlight).toBe("BANNER");
    });

    it("returns null when there is nothing to highlight", async () => {
      await mockDb(jest.fn().mockResolvedValue([[]]));
      expect(await getHighlightedAd()).toBeNull();
    });

    it("serves a single ad when several ask for a modal, the highest one winning", async () => {
      // Le tri est fait par la requête ; c'est `selectHighlightedAd` qui tranche.
      const execute = jest.fn().mockResolvedValue([
        [
          { ...HIGHLIGHT_ROW, id: 7, highlight: "MODAL" },
          { ...HIGHLIGHT_ROW, id: 8, highlight: "MODAL" },
          { ...HIGHLIGHT_ROW, id: 9, highlight: "BANNER" },
        ],
      ]);
      await mockDb(execute);
      expect((await getHighlightedAd())?.id).toBe(7);
    });

    it("agrees with the shared selector the admin badges use", async () => {
      // Garde-fou anti-divergence : la route et les badges de gestion doivent
      // désigner la même annonce, sur exactement les mêmes données.
      const rows = [
        { ...HIGHLIGHT_ROW, id: 3, highlight: "BANNER" },
        { ...HIGHLIGHT_ROW, id: 4, highlight: "MODAL" },
      ];
      await mockDb(jest.fn().mockResolvedValue([rows]));
      const served = await getHighlightedAd();
      const expected = selectHighlightedAd(
        rows.map((r) => ({ ...r, active: Boolean(r.active), id: r.id })),
      );
      expect(served?.id).toBe(expected?.id);
    });
  });

  describe("createRecruitmentAd", () => {
    it("inserts and returns the new ad", async () => {
      const execute = jest.fn().mockResolvedValue([{ insertId: 9 }]);
      await mockDb(execute);
      const ad = await createRecruitmentAd({ title: "Recherche caster", domain: "CASTING" });
      expect(ad.id).toBe(9);
      expect(ad.domain).toBe("CASTING");
      expect(ad.highlight).toBe("NONE");
      expect(ad.contactPreferred).toBe("AUTO");
    });

    it("persists the contact tags (Discord id, preferred channel)", async () => {
      const execute = jest.fn().mockResolvedValue([{ insertId: 10 }]);
      await mockDb(execute);
      const ad = await createRecruitmentAd({
        title: "Recherche arbitre",
        contactDiscord: "marie",
        contactDiscordId: "123456789012345678",
        contactPreferred: "DISCORD",
      });
      expect(ad.contactDiscord).toBe("marie");
      expect(ad.contactDiscordId).toBe("123456789012345678");
      expect(ad.contactPreferred).toBe("DISCORD");
      // Les nouvelles colonnes figurent bien dans l'INSERT et ses paramètres.
      const [sql, values] = execute.mock.calls[0];
      expect(sql).toContain("contact_discord_id");
      expect(sql).toContain("contact_preferred");
      expect(sql).not.toContain("contact_email");
      expect(values).toEqual(expect.arrayContaining(["123456789012345678", "DISCORD"]));
    });

    it("rejects invalid input before touching the database", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(createRecruitmentAd({ title: "" })).rejects.toThrow("TITLE_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("updateRecruitmentAd", () => {
    it("succeeds even when no column value actually changes (no false 404)", async () => {
      // Régression : sans CLIENT_FOUND_ROWS, un UPDATE sans changement renvoie
      // affectedRows = 0. On s'appuie sur un SELECT d'existence, pas sur
      // affectedRows, donc l'enregistrement identique doit réussir.
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[{ id: 3 }]]) // SELECT existence
        .mockResolvedValueOnce([{ affectedRows: 0 }]); // UPDATE no-op
      await mockDb(execute);

      const ad = await updateRecruitmentAd(3, { title: "Inchangé" });
      expect(ad.id).toBe(3);
      expect(ad.title).toBe("Inchangé");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("throws NOT_FOUND when the ad does not exist", async () => {
      await mockDb(jest.fn().mockResolvedValueOnce([[]]));
      await expect(updateRecruitmentAd(999, { title: "X" })).rejects.toThrow(
        "RECRUITMENT_NOT_FOUND",
      );
    });

    it("rejects invalid input", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(updateRecruitmentAd(1, { title: "X", domain: "LOL" })).rejects.toThrow(
        "INVALID_DOMAIN",
      );
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("deleteRecruitmentAd", () => {
    it("deletes an existing ad", async () => {
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);
      await expect(deleteRecruitmentAd(4)).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [4]);
    });

    it("throws NOT_FOUND when nothing is deleted", async () => {
      await mockDb(jest.fn().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(deleteRecruitmentAd(999)).rejects.toThrow("RECRUITMENT_NOT_FOUND");
    });
  });
});

/**
 * Deux lectures publiques, deux fréquences très différentes.
 *
 * `getHighlightedAd` est appelée par la **mise en page racine** : elle est donc
 * demandée à chaque arrivée sur le site, par chaque visiteur. L'en-tête
 * `Cache-Control` de sa route épargne les rechargements d'un même navigateur,
 * mais rien ne protégeait d'une arrivée groupée. `listRecruitmentAds` sert la
 * page `/recrutement`, rendue à chaque visite et hors de portée d'un plafond de
 * débit — c'est un composant serveur, il ne peut pas répondre 429.
 */
describe("recruitment-service — mutualisation des lectures publiques", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    clearCache();
    jest.restoreAllMocks();
  });

  it("ne lit qu'une fois la bannière pour cent arrivées simultanées", async () => {
    const execute = jest.fn().mockResolvedValue([[HIGHLIGHT_ROW]]);
    await mockDb(execute);

    const results = await Promise.all(Array.from({ length: 100 }, () => getHighlightedAd()));

    expect(execute).toHaveBeenCalledTimes(1);
    for (const ad of results) expect(ad?.id).toBe(5);
  });

  it("ne lit qu'une fois la liste publique pour cent visiteurs simultanés", async () => {
    const execute = jest.fn().mockResolvedValue([[HIGHLIGHT_ROW]]);
    await mockDb(execute);

    await Promise.all(Array.from({ length: 100 }, () => listRecruitmentAds()));

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("ne met jamais la vue du staff en cache", async () => {
    // Elle contient les brouillons : partager sa réponse sous la même clé que la
    // liste publique les servirait à tout le monde. Même règle que la portée
    // `hiddenOnly` de la liste des tournois.
    const execute = jest.fn().mockResolvedValue([[HIGHLIGHT_ROW]]);
    await mockDb(execute);

    await listRecruitmentAds(true);
    await listRecruitmentAds(true);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("ne sert pas la liste du staff au public", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[HIGHLIGHT_ROW, { ...HIGHLIGHT_ROW, id: 6, active: 0 }]])
      .mockResolvedValueOnce([[HIGHLIGHT_ROW]]);
    await mockDb(execute);

    const staff = await listRecruitmentAds(true);
    const publicList = await listRecruitmentAds();

    expect(staff).toHaveLength(2);
    expect(publicList).toHaveLength(1);
  });

  it.each([
    [
      "createRecruitmentAd",
      () =>
        createRecruitmentAd({
          title: "Titre",
          teamName: null,
          domain: "AUTRE",
          roles: null,
          body: null,
          contactUrl: null,
          contactDiscord: null,
          contactDiscordId: null,
          contactPreferred: "AUTO",
          highlight: "NONE",
          active: true,
        }),
    ],
    ["deleteRecruitmentAd", () => deleteRecruitmentAd(5)],
  ])("oublie la bannière après %s", async (_name, write) => {
    const execute = jest.fn().mockImplementation(async (sql: string) =>
      String(sql).trim().startsWith("SELECT")
        ? [[HIGHLIGHT_ROW]]
        : [{ insertId: 9, affectedRows: 1 }],
    );
    await mockDb(execute);

    await getHighlightedAd();
    execute.mockClear();

    // Le staff vient d'écrire : la bannière du site doit suivre sans attendre la
    // fin de la fenêtre de cache.
    await write();
    await getHighlightedAd();

    expect(execute.mock.calls.some(([sql]) => String(sql).trim().startsWith("SELECT"))).toBe(true);
  });
});
