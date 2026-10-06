import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getSiteCopy, getSiteCopyBundle, resetSiteCopy, setSiteCopy } from "@/lib/server/site-copy-service";
import { defaultSiteCopy } from "@/lib/shared/site-copy";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

describe("getSiteCopy", () => {
  // La vitrine est mutualisée (`lib/server/showcase-cache.ts`) : sans cette
  // remise à zéro, chaque cas resservirait la valeur du précédent.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sert les défauts quand rien n'est enregistré", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    await mockDb(execute);

    await expect(getSiteCopy()).resolves.toEqual(defaultSiteCopy());
  });

  it("écrase le défaut par la valeur enregistrée", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValue([[{
        setting_key: "copy_home.hero.title",
        setting_value: "Nouveau titre",
      }]]);
    await mockDb(execute);

    const copy = await getSiteCopy();

    expect(copy["home.hero.title"]).toBe("Nouveau titre");
    // Les autres textes restent aux défauts.
    expect(copy["home.hero.lede"]).toBe(defaultSiteCopy()["home.hero.lede"]);
  });

  it("ignore une valeur vide en base plutôt que de vider la page", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValue([[{ setting_key: "copy_home.hero.title", setting_value: "   " }]]);
    await mockDb(execute);

    expect((await getSiteCopy())["home.hero.title"]).toBe(defaultSiteCopy()["home.hero.title"]);
  });

  it("retombe sur les défauts si la base est injoignable", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("DB_DOWN"));
    await mockDb(execute);

    await expect(getSiteCopy()).resolves.toEqual(defaultSiteCopy());
  });
});

describe("setSiteCopy", () => {
  // La vitrine est mutualisée (`lib/server/showcase-cache.ts`) : sans cette
  // remise à zéro, chaque cas resservirait la valeur du précédent.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("upsert la valeur normalisée puis relit l'ensemble", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // upsert
      .mockResolvedValueOnce([[{ setting_key: "copy_home.hero.title", setting_value: "Titre" }]]);
    await mockDb(execute);

    const copy = await setSiteCopy("home.hero.title", "  Titre  ", " Title ");

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO bg_settings/);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    // Les deux langues dans **une** instruction : jamais l'une sans l'autre.
    expect(params).toEqual(["copy_home.hero.title", "Titre", "copy_home.hero.title__en", "Title"]);
    expect(copy["home.hero.title"]).toBe("Titre");
  });

  it.each([
    ["nope", "x", "y", "UNKNOWN_COPY_KEY"],
    ["home.hero.title", "   ", "Title", "COPY_EMPTY"],
    ["home.hero.title", "Titre", "", "COPY_EN_EMPTY"],
    ["home.hero.title", "Titre", "   ", "COPY_EN_EMPTY"],
    ["home.hero.title", "Titre", undefined, "COPY_EN_EMPTY"],
    ["home.hero.title", "Titre", "x".repeat(161), "COPY_EN_TOO_LONG"],
  ])("refuse (%s, %s, %s) sans écrire", async (key, value, valueEn, error) => {
    const execute = jest.fn<SqlQuery>();
    await mockDb(execute);

    await expect(setSiteCopy(key, value, valueEn)).rejects.toThrow(error);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("getSiteCopy — anglais et rattrapage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });

  it("sert l'anglais d'origine quand rien n'est enregistré", async () => {
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[]]));
    await expect(getSiteCopy("en")).resolves.toEqual(defaultSiteCopy("en"));
  });

  it("sert l'anglais enregistré", async () => {
    await mockDb(
      jest.fn<SqlQuery>().mockResolvedValue([[
        { setting_key: "copy_home.hero.title", setting_value: "Titre" },
        { setting_key: "copy_home.hero.title__en", setting_value: "Title" },
      ]]),
    );
    expect((await getSiteCopy("en"))["home.hero.title"]).toBe("Title");
    expect((await getSiteCopy())["home.hero.title"]).toBe("Titre");
  });

  it("français édité sans anglais : jamais le français sous /en, et le texte entre dans la liste de rattrapage", async () => {
    await mockDb(
      jest.fn<SqlQuery>().mockResolvedValue([[{ setting_key: "copy_home.hero.title", setting_value: "Titre édité" }]]),
    );
    const bundle = await getSiteCopyBundle();
    expect(bundle.en["home.hero.title"]).toBe(defaultSiteCopy("en")["home.hero.title"]);
    expect(bundle.missingEn).toEqual(["home.hero.title"]);
    expect(bundle.editor["home.hero.title"]).toEqual({ fr: "Titre édité", en: "", enMissing: true });
  });

  it("lit les deux clés de chaque texte", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    await mockDb(execute);
    await getSiteCopyBundle();
    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(params).toContain("copy_ranking.hero.lede");
    expect(params).toContain("copy_ranking.hero.lede__en");
  });
});

describe("resetSiteCopy", () => {
  // La vitrine est mutualisée (`lib/server/showcase-cache.ts`) : sans cette
  // remise à zéro, chaque cas resservirait la valeur du précédent.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("supprime la ligne pour revenir au texte d'origine", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const copy = await resetSiteCopy("home.hero.title");

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM bg_settings/);
    expect(params).toEqual(["copy_home.hero.title", "copy_home.hero.title__en"]);
    expect(copy["home.hero.title"]).toBe(defaultSiteCopy()["home.hero.title"]);
  });

  it("refuse une clé inconnue", async () => {
    const execute = jest.fn<SqlQuery>();
    await mockDb(execute);

    await expect(resetSiteCopy("nope")).rejects.toThrow("UNKNOWN_COPY_KEY");
    expect(execute).not.toHaveBeenCalled();
  });
});
