import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getSiteCopy, resetSiteCopy, setSiteCopy } from "@/lib/server/site-copy-service";
import { defaultSiteCopy } from "@/lib/shared/site-copy";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

describe("getSiteCopy", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("sert les défauts quand rien n'est enregistré", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await expect(getSiteCopy()).resolves.toEqual(defaultSiteCopy());
  });

  it("écrase le défaut par la valeur enregistrée", async () => {
    const execute = jest
      .fn()
      .mockResolvedValue([[{ setting_key: "copy_home.hero.title", setting_value: "Nouveau titre" }]]);
    await mockDb(execute);

    const copy = await getSiteCopy();

    expect(copy["home.hero.title"]).toBe("Nouveau titre");
    // Les autres textes restent aux défauts.
    expect(copy["home.hero.lede"]).toBe(defaultSiteCopy()["home.hero.lede"]);
  });

  it("ignore une valeur vide en base plutôt que de vider la page", async () => {
    const execute = jest
      .fn()
      .mockResolvedValue([[{ setting_key: "copy_home.hero.title", setting_value: "   " }]]);
    await mockDb(execute);

    expect((await getSiteCopy())["home.hero.title"]).toBe(defaultSiteCopy()["home.hero.title"]);
  });

  it("retombe sur les défauts si la base est injoignable", async () => {
    const execute = jest.fn().mockRejectedValue(new Error("DB_DOWN"));
    await mockDb(execute);

    await expect(getSiteCopy()).resolves.toEqual(defaultSiteCopy());
  });
});

describe("setSiteCopy", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("upsert la valeur normalisée puis relit l'ensemble", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // upsert
      .mockResolvedValueOnce([[{ setting_key: "copy_home.hero.title", setting_value: "Titre" }]]);
    await mockDb(execute);

    const copy = await setSiteCopy("home.hero.title", "  Titre  ");

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO bg_settings/);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(params).toEqual(["copy_home.hero.title", "Titre"]);
    expect(copy["home.hero.title"]).toBe("Titre");
  });

  it.each([
    ["nope", "x", "UNKNOWN_COPY_KEY"],
    ["home.hero.title", "   ", "COPY_EMPTY"],
  ])("refuse (%s, %s) sans écrire", async (key, value, error) => {
    const execute = jest.fn();
    await mockDb(execute);

    await expect(setSiteCopy(key, value)).rejects.toThrow(error);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("resetSiteCopy", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("supprime la ligne pour revenir au texte d'origine", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const copy = await resetSiteCopy("home.hero.title");

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM bg_settings/);
    expect(params).toEqual(["copy_home.hero.title"]);
    expect(copy["home.hero.title"]).toBe(defaultSiteCopy()["home.hero.title"]);
  });

  it("refuse une clé inconnue", async () => {
    const execute = jest.fn();
    await mockDb(execute);

    await expect(resetSiteCopy("nope")).rejects.toThrow("UNKNOWN_COPY_KEY");
    expect(execute).not.toHaveBeenCalled();
  });
});
