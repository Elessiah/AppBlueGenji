import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/image-upload");

import { getDatabase } from "@/lib/server/database";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { deleteUnreferencedUpload, isUploadReferenced } from "@/lib/server/stored-upload-cleanup";

/**
 * Remplacer ou supprimer une image effaçait l'ancienne adresse sans regarder ni
 * son dossier ni qui d'autre la désignait : un avatar collé comme logo de
 * partenaire partait avec le partenaire. Le fichier n'est désormais effacé que
 * s'il vit dans le dossier du geste et que plus aucune ligne ne le désigne.
 */
function mockDb(referencedBy: RegExp | null = null) {
  const execute = jest.fn<SqlQuery>(async (sql: string) => [
    referencedBy && referencedBy.test(sql) ? [{ 1: 1 }] : [],
    [],
  ]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

describe("deleteUnreferencedUpload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(deleteStoredImage).mockResolvedValue(undefined);
  });

  it("efface un fichier du dossier visé que plus rien ne désigne", async () => {
    mockDb();
    await expect(deleteUnreferencedUpload("/api/uploads/sponsors/7-abc.webp", "sponsors")).resolves.toBe(true);
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/sponsors/7-abc.webp");
  });

  it("n'efface jamais un fichier d'un autre dossier, sans même interroger la base", async () => {
    const execute = mockDb();
    for (const url of [
      "/api/uploads/avatars/12-abc.webp",
      "/api/uploads/teams/3-abc.webp",
      "/uploads/tournaments/4-abc.webp",
    ]) {
      await expect(deleteUnreferencedUpload(url, "sponsors")).resolves.toBe(false);
    }
    expect(execute).not.toHaveBeenCalled();
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it("ignore une adresse étrangère, une traversée de chemin et l'absence d'adresse", async () => {
    mockDb();
    await expect(deleteUnreferencedUpload("https://cdn.exemple.fr/logo.png", "sponsors")).resolves.toBe(false);
    await expect(deleteUnreferencedUpload("/api/uploads/sponsors/../avatars/1.webp", "sponsors")).resolves.toBe(false);
    await expect(deleteUnreferencedUpload(null, "sponsors")).resolves.toBe(false);
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it.each([
    ["un compte", /bg_users/],
    ["une équipe", /bg_teams/],
    ["un tournoi", /bg_tournaments/],
    ["un autre partenaire", /bg_sponsors/],
    ["un bénévole", /bg_benevoles/],
    ["un logo masqué par la modération", /bg_logo_quarantines/],
  ])("garde le fichier que désigne encore %s", async (_label, table) => {
    mockDb(table);
    await expect(deleteUnreferencedUpload("/api/uploads/teams/3-abc.webp", "teams")).resolves.toBe(false);
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it("n'échoue pas quand l'effacement lève : la base est déjà écrite", async () => {
    mockDb();
    jest.mocked(deleteStoredImage).mockRejectedValue(new Error("EPERM"));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(deleteUnreferencedUpload("/api/uploads/benevoles/1-abc.webp", "benevoles")).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("isUploadReferenced", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("cherche l'adresse sous sa forme servie et sa forme disque", async () => {
    const execute = mockDb();
    await isUploadReferenced("/uploads/teams/3-abc.webp");
    for (const call of execute.mock.calls) {
      expect(call[1]).toEqual(expect.arrayContaining(["/api/uploads/teams/3-abc.webp", "/uploads/teams/3-abc.webp"]));
    }
    expect(execute.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("ne compte un logo en quarantaine que tant qu'il est masqué", async () => {
    const execute = mockDb();
    await isUploadReferenced("/api/uploads/teams/3-abc.webp");
    const quarantine = execute.mock.calls.map((c) => String(c[0])).find((sql) => sql.includes("bg_logo_quarantines"));
    expect(quarantine).toMatch(/status = 'HIDDEN'/);
  });
});
