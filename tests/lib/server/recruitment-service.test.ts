import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  createRecruitmentAd,
  deleteRecruitmentAd,
  getRecruitmentSpotlight,
  listRecruitmentAds,
  reorderRecruitmentAds,
  updateRecruitmentAd,
} from "@/lib/server/recruitment-service";
import { selectRecruitmentSpotlight } from "@/lib/shared/recruitment";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, type SqlMock, fakeConnection, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/reorder", () => ({ applyDisplayOrder: jest.fn() }));

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

/** Ligne minimale d'annonce mise en avant (banderole), telle que la remonte la requête. */
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
  priority: "IMPORTANT",
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
      const execute = jest.fn<SqlQuery>().mockResolvedValue([
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
            priority: "OPTIONAL",
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
          priority: "OPTIONAL",
          active: true,
        },
      ]);
      expect(execute.mock.calls[0][0]).toContain("WHERE active = 1");
    });

    it("range par statut, l'ordre d'affichage ne valant qu'à l'intérieur d'un statut", async () => {
      // La requête rend l'ordre d'affichage brut : une facultative placée en
      // tête ne doit pas pour autant passer devant une prioritaire.
      const execute = jest.fn<SqlQuery>().mockResolvedValue([
        [
          { ...HIGHLIGHT_ROW, id: 1, priority: "OPTIONAL" },
          { ...HIGHLIGHT_ROW, id: 2, priority: "IMPORTANT" },
          { ...HIGHLIGHT_ROW, id: 3, priority: "PRIORITY" },
          { ...HIGHLIGHT_ROW, id: 4, priority: "PRIORITY" },
        ],
      ]);
      await mockDb(execute);
      expect((await listRecruitmentAds()).map((a) => a.id)).toEqual([3, 4, 2, 1]);
    });

    it("includes inactive ads when asked (admin view)", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
      await mockDb(execute);
      await listRecruitmentAds(true);
      expect(execute.mock.calls[0][0]).not.toContain("WHERE active = 1");
    });

    it("returns [] when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
      expect(await listRecruitmentAds()).toEqual([]);
    });
  });

  describe("getRecruitmentSpotlight", () => {
    it("ne remonte que les annonces publiées qui demandent une mise en avant", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([[HIGHLIGHT_ROW]]);
      await mockDb(execute);
      const spotlight = await getRecruitmentSpotlight();
      expect(spotlight.modal).toEqual([]);
      expect(spotlight.banner.map((a) => a.id)).toEqual([5]);
      const sql = String(execute.mock.calls[0][0]);
      expect(sql).toContain("active = 1");
      expect(sql).toContain("priority <> 'OPTIONAL'");
    });

    it("rend des listes vides quand rien n'est mis en avant", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));
      expect(await getRecruitmentSpotlight()).toEqual({ modal: [], banner: [] });
    });

    it("rend des listes vides quand la base est injoignable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
      expect(await getRecruitmentSpotlight()).toEqual({ modal: [], banner: [] });
    });

    it("sert toutes les prioritaires à la modale, et non plus la seule première", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([
        [
          { ...HIGHLIGHT_ROW, id: 9, priority: "IMPORTANT" },
          { ...HIGHLIGHT_ROW, id: 7, priority: "PRIORITY" },
          { ...HIGHLIGHT_ROW, id: 8, priority: "PRIORITY" },
        ],
      ]);
      await mockDb(execute);
      const spotlight = await getRecruitmentSpotlight();
      expect(spotlight.modal.map((a) => a.id)).toEqual([7, 8]);
      // Prioritaires d'abord dans la banderole, quel que soit l'ordre brut.
      expect(spotlight.banner.map((a) => a.id)).toEqual([7, 8, 9]);
    });

    it("s'accorde avec la règle pure que partagent la page et la gestion", async () => {
      // Garde-fou anti-divergence : le site et la gestion doivent désigner les
      // mêmes annonces, sur exactement les mêmes données.
      const rows = [
        { ...HIGHLIGHT_ROW, id: 3, priority: "IMPORTANT" as const },
        { ...HIGHLIGHT_ROW, id: 4, priority: "PRIORITY" as const },
      ];
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([rows]));
      const served = await getRecruitmentSpotlight();
      const expected = selectRecruitmentSpotlight(
        rows.map((r) => ({ ...r, active: Boolean(r.active) })),
      );
      expect(served.modal.map((a) => a.id)).toEqual(expected.modal.map((a) => a.id));
      expect(served.banner.map((a) => a.id)).toEqual(expected.banner.map((a) => a.id));
    });
  });

  describe("createRecruitmentAd", () => {
    it("inserts and returns the new ad", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ insertId: 9 }]);
      await mockDb(execute);
      const ad = await createRecruitmentAd({ title: "Recherche caster", domain: "CASTING" });
      expect(ad.id).toBe(9);
      expect(ad.domain).toBe("CASTING");
      expect(ad.priority).toBe("OPTIONAL");
      expect(ad.contactPreferred).toBe("AUTO");
    });

    it("persists the contact tags (Discord id, preferred channel)", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ insertId: 10 }]);
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

    it("écrit le statut demandé", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ insertId: 11 }]);
      await mockDb(execute);
      const ad = await createRecruitmentAd({ title: "Urgent", priority: "PRIORITY" });
      expect(ad.priority).toBe("PRIORITY");
      const [sql, values] = execute.mock.calls[0];
      expect(sql).toContain("priority");
      expect(sql).not.toContain("highlight");
      expect(values).toContain("PRIORITY");
    });

    it("rejects invalid input before touching the database", async () => {
      const execute = jest.fn<SqlQuery>();
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
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[{ id: 3, priority: "OPTIONAL" }]]) // SELECT existence
        .mockResolvedValueOnce([{ affectedRows: 0 }]); // UPDATE no-op
      await mockDb(execute);

      const ad = await updateRecruitmentAd(3, { title: "Inchangé" });
      expect(ad.id).toBe(3);
      expect(ad.title).toBe("Inchangé");
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("garde son rang à une annonce qui garde son statut", async () => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[{ id: 3, priority: "IMPORTANT" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      await mockDb(execute);

      await updateRecruitmentAd(3, { title: "Même statut", priority: "IMPORTANT" });

      expect(execute).toHaveBeenCalledTimes(2);
      const [sql, values] = execute.mock.calls[1];
      expect(sql).toContain("display_order = COALESCE(?, display_order)");
      // `null` : le COALESCE garde le rang en place.
      expect(values).toEqual([
        "Même statut",
        null,
        "AUTRE",
        null,
        null,
        null,
        null,
        null,
        "AUTO",
        "IMPORTANT",
        1,
        null,
        3,
      ]);
    });

    it("met en fin de son nouveau groupe une annonce qui change de statut", async () => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[{ id: 3, priority: "OPTIONAL" }]])
        .mockResolvedValueOnce([[{ next_order: "70" }]]) // MAX(display_order) + 10
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      await mockDb(execute);

      const ad = await updateRecruitmentAd(3, { title: "Promue", priority: "PRIORITY" });

      expect(ad.priority).toBe("PRIORITY");
      expect(execute).toHaveBeenCalledTimes(3);
      expect(String(execute.mock.calls[1][0])).toContain("MAX(display_order)");
      const values = execute.mock.calls[2][1] as unknown[];
      // Rang d'affichage, puis id : les deux derniers paramètres de l'UPDATE.
      expect(values.slice(-2)).toEqual([70, 3]);
    });

    it("throws NOT_FOUND when the ad does not exist", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValueOnce([[]]));
      await expect(updateRecruitmentAd(999, { title: "X" })).rejects.toThrow(
        "RECRUITMENT_NOT_FOUND",
      );
    });

    it("rejects invalid input", async () => {
      const execute = jest.fn<SqlQuery>();
      await mockDb(execute);
      await expect(updateRecruitmentAd(1, { title: "X", domain: "LOL" })).rejects.toThrow(
        "INVALID_DOMAIN",
      );
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("reorderRecruitmentAds", () => {
    /**
     * `applyDisplayOrder` simulé : il joue le contrôle sur la connexion de sa
     * transaction, comme le vrai, et ne « réécrit » que s'il passe.
     */
    async function runReorder(rows: object[], ids: number[]) {
      const { applyDisplayOrder } = await import("@/lib/server/reorder");
      const execute = jest.fn<SqlQuery>().mockResolvedValue([rows]);
      const written: number[][] = [];
      jest.mocked(applyDisplayOrder).mockImplementation(async (_table, order, beforeWrite) => {
        await beforeWrite?.(fakeConnection({ execute }));
        written.push(order);
      });
      await reorderRecruitmentAds(ids);
      return { execute, written, applyDisplayOrder };
    }

    it("réécrit l'ordre quand il reste groupé par statut", async () => {
      const { written, applyDisplayOrder } = await runReorder(
        [
          { id: 1, priority: "PRIORITY" },
          { id: 2, priority: "PRIORITY" },
          { id: 3, priority: "OPTIONAL" },
        ],
        [2, 1, 3],
      );
      expect(jest.mocked(applyDisplayOrder).mock.calls[0][0]).toBe("bg_recruitment_ads");
      expect(written).toEqual([[2, 1, 3]]);
    });

    it("relit les statuts sous verrou, dans la transaction de l'écriture", async () => {
      // Lus avant, un statut changé entre la lecture et l'écriture laisserait
      // passer un ordre mêlé.
      const { execute } = await runReorder([{ id: 1, priority: "PRIORITY" }], [1]);
      expect(String(execute.mock.calls[0][0])).toContain("FOR UPDATE");
    });

    it("refuse un ordre qui mêle les statuts, sans rien écrire", async () => {
      await expect(
        runReorder(
          [
            { id: 1, priority: "PRIORITY" },
            { id: 3, priority: "OPTIONAL" },
          ],
          [3, 1],
        ),
      ).rejects.toThrow("RECRUITMENT_ORDER_MIXES_PRIORITIES");
    });
  });

  describe("deleteRecruitmentAd", () => {
    it("deletes an existing ad", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);
      await expect(deleteRecruitmentAd(4)).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [4]);
    });

    it("throws NOT_FOUND when nothing is deleted", async () => {
      await mockDb(jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(deleteRecruitmentAd(999)).rejects.toThrow("RECRUITMENT_NOT_FOUND");
    });
  });
});

/**
 * Deux lectures publiques, deux fréquences très différentes.
 *
 * `getRecruitmentSpotlight` est appelée par la **mise en page racine** : elle est donc
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
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[HIGHLIGHT_ROW]]);
    await mockDb(execute);

    const results = await Promise.all(Array.from({ length: 100 }, () => getRecruitmentSpotlight()));

    expect(execute).toHaveBeenCalledTimes(1);
    for (const spotlight of results) expect(spotlight.banner[0]?.id).toBe(5);
  });

  it("ne lit qu'une fois la liste publique pour cent visiteurs simultanés", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[HIGHLIGHT_ROW]]);
    await mockDb(execute);

    await Promise.all(Array.from({ length: 100 }, () => listRecruitmentAds()));

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("ne met jamais la vue du staff en cache", async () => {
    // Elle contient les brouillons : partager sa réponse sous la même clé que la
    // liste publique les servirait à tout le monde. Même règle que la portée
    // `hiddenOnly` de la liste des tournois.
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[HIGHLIGHT_ROW]]);
    await mockDb(execute);

    await listRecruitmentAds(true);
    await listRecruitmentAds(true);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("ne sert pas la liste du staff au public", async () => {
    const execute = jest
      .fn<SqlQuery>()
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
          priority: "OPTIONAL",
          active: true,
        }),
    ],
    ["deleteRecruitmentAd", () => deleteRecruitmentAd(5)],
  ])("oublie la bannière après %s", async (_name, write) => {
    const execute = jest.fn<any>().mockImplementation(async (sql: string) =>
      String(sql).trim().startsWith("SELECT")
        ? [[HIGHLIGHT_ROW]]
        : [{ insertId: 9, affectedRows: 1 }],
    );
    await mockDb(execute);

    await getRecruitmentSpotlight();
    execute.mockClear();

    // Le staff vient d'écrire : la bannière du site doit suivre sans attendre la
    // fin de la fenêtre de cache.
    await write();
    await getRecruitmentSpotlight();

    expect(execute.mock.calls.some(([sql]) => String(sql).trim().startsWith("SELECT"))).toBe(true);
  });
});
