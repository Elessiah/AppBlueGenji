import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("node:fs/promises", () => ({
  rename: jest.fn(),
  copyFile: jest.fn(),
  unlink: jest.fn(),
  readFile: jest.fn(),
  readdir: jest.fn(),
  rm: jest.fn(),
}));
jest.mock("@/lib/server/stored-upload-cleanup");

import crypto from "node:crypto";
import path from "node:path";
import { copyFile, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { isUploadReferenced } from "@/lib/server/stored-upload-cleanup";
import { getDatabase } from "@/lib/server/database";
import {
  optimizedImageCacheDirectory,
  purgeOptimizedCopies,
  rotateHiddenAvatarFile,
  rotatedAvatarTarget,
} from "@/lib/server/avatar-rotation";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/**
 * Masquer son avatar doit rendre l'ancienne adresse du fichier **morte** : le
 * fichier sous `public/uploads/avatars` est servi sans session, et retirer la
 * seule URL des réponses laissait l'image à quiconque l'avait déjà vue.
 */

const renameMock = jest.mocked(rename);
const copyMock = jest.mocked(copyFile);
const unlinkMock = jest.mocked(unlink);
const readFileMock = jest.mocked(readFile);
// `readdir` a plusieurs surcharges : le double est typé sur celle qui rend des noms.
const readdirMock = readdir as unknown as jest.Mock<(dir: string) => Promise<string[]>>;
const rmMock = jest.mocked(rm);
const referencedMock = jest.mocked(isUploadReferenced);
const AVATARS = path.join(process.cwd(), "public", "uploads", "avatars");
const OLD_URL = "/api/uploads/avatars/42-aaaa.webp";
const BYTES = Buffer.from("avatar");
const UPSTREAM = crypto.createHash("sha256").update(BYTES).digest("base64url");

type Row = { avatar_url: string | null; visible_avatar: 0 | 1 } | null;

/** Lecture initiale, écriture, puis (course perdue) relecture de la ligne. */
function mockDb(row: Row, affectedRows = 1, current: string | null = null) {
  const execute = jest
    .fn<SqlQuery>()
    .mockResolvedValueOnce([row ? [row] : []])
    .mockResolvedValueOnce([{ affectedRows }])
    .mockResolvedValueOnce([[{ avatar_url: current }]]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

describe("rotatedAvatarTarget", () => {
  it("garde la forme de l'URL et ne change que le nom du fichier", () => {
    const target = rotatedAvatarTarget(OLD_URL, 42);
    expect(target).not.toBeNull();
    expect(target!.from).toBe(path.join(AVATARS, "42-aaaa.webp"));
    expect(target!.url).toMatch(/^\/api\/uploads\/avatars\/42-[0-9a-f]{16}\.webp$/);
    expect(target!.to).toBe(path.join(AVATARS, target!.url.split("/").pop()!));
    expect(rotatedAvatarTarget("/uploads/avatars/42-aaaa.webp", 42)!.url).toMatch(/^\/uploads\/avatars\/42-/);
  });

  it("tire un nom neuf à chaque fois", () => {
    expect(rotatedAvatarTarget(OLD_URL, 42)!.url).not.toBe(rotatedAvatarTarget(OLD_URL, 42)!.url);
  });

  it.each<[string]>([
    ["https://lh3.googleusercontent.com/a/photo"],
    ["/api/uploads/teams/42-aaaa.webp"],
    ["/api/uploads/avatars/../teams/x.webp"],
    ["/api/uploads/avatars/42-aaaa.png"],
  ])("refuse ce qui n'est pas un avatar téléversé : %s", (url) => {
    expect(rotatedAvatarTarget(url, 42)).toBeNull();
  });

  it("refuse un identifiant invalide", () => {
    expect(rotatedAvatarTarget(OLD_URL, 0)).toBeNull();
  });
});

describe("rotateHiddenAvatarFile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    renameMock.mockResolvedValue(undefined);
    copyMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(BYTES);
    readdirMock.mockResolvedValue([]);
    rmMock.mockResolvedValue(undefined);
    referencedMock.mockResolvedValue(false);
  });

  it("renomme le fichier puis écrit la nouvelle URL, bornée à l'ancienne", async () => {
    const execute = mockDb({ avatar_url: OLD_URL, visible_avatar: 0 });
    const url = await rotateHiddenAvatarFile(42);
    expect(url).toMatch(/^\/api\/uploads\/avatars\/42-[0-9a-f]{16}\.webp$/);
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(renameMock.mock.calls[0][0]).toBe(path.join(AVATARS, "42-aaaa.webp"));
    const [sql, params] = execute.mock.calls[1];
    expect(sql).toMatch(/avatar_url = \? AND visible_avatar = 0 AND is_deleted = 0/);
    expect(params).toEqual([url, 42, OLD_URL]);
  });

  it("purge les variantes de l'optimiseur d'images une fois l'adresse changée", async () => {
    mockDb({ avatar_url: OLD_URL, visible_avatar: 0 });
    readdirMock.mockResolvedValueOnce(["k1", "k2"]).mockResolvedValueOnce([`60.123.etag.${UPSTREAM}.webp`]).mockResolvedValueOnce([
      "60.123.etag.autre.webp",
    ]);
    await rotateHiddenAvatarFile(42);
    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith(path.join(optimizedImageCacheDirectory(), "k1"), { recursive: true, force: true });
  });

  it("ne touche à rien si l'avatar est visible", async () => {
    mockDb({ avatar_url: OLD_URL, visible_avatar: 1 });
    expect(await rotateHiddenAvatarFile(42)).toBeNull();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("ne touche à rien sans avatar, ni pour un compte introuvable ou supprimé", async () => {
    mockDb({ avatar_url: null, visible_avatar: 0 });
    expect(await rotateHiddenAvatarFile(42)).toBeNull();
    mockDb(null);
    expect(await rotateHiddenAvatarFile(42)).toBeNull();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("n'écrit rien si le fichier a déjà disparu (quarantaine, ménage)", async () => {
    const execute = mockDb({ avatar_url: OLD_URL, visible_avatar: 0 });
    readFileMock.mockRejectedValueOnce(Object.assign(new Error("absent"), { code: "ENOENT" }));
    expect(await rotateHiddenAvatarFile(42)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("propage une autre erreur de disque", async () => {
    mockDb({ avatar_url: OLD_URL, visible_avatar: 0 });
    renameMock.mockRejectedValueOnce(Object.assign(new Error("disque"), { code: "EACCES" }));
    await expect(rotateHiddenAvatarFile(42)).rejects.toThrow("disque");
  });

  it("remet le fichier en place si la ligne désigne encore l'ancienne adresse (réaffiché entre-temps)", async () => {
    mockDb({ avatar_url: OLD_URL, visible_avatar: 0 }, 0, OLD_URL);
    expect(await rotateHiddenAvatarFile(42)).toBeNull();
    expect(renameMock).toHaveBeenCalledTimes(2);
    const [[from, to], [back, origin]] = renameMock.mock.calls;
    expect([back, origin]).toEqual([to, from]);
    expect(unlinkMock).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
  });

  it("supprime le fichier renommé si un téléversement concurrent a remplacé l'avatar", async () => {
    // Le téléversement a tenté d'effacer l'ancien fichier, en vain : le remettre
    // en place republierait un avatar masqué que plus rien ne désigne.
    mockDb({ avatar_url: OLD_URL, visible_avatar: 0 }, 0, "/api/uploads/avatars/42-neuf.webp");
    expect(await rotateHiddenAvatarFile(42)).toBeNull();
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledWith(renameMock.mock.calls[0][1]);
  });

  it("supprime le fichier renommé quand l'écriture échoue, et propage", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ avatar_url: OLD_URL, visible_avatar: 0 }]])
      .mockRejectedValueOnce(new Error("base"))
      .mockRejectedValueOnce(new Error("base"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await expect(rotateHiddenAvatarFile(42)).rejects.toThrow("base");
    expect(unlinkMock).toHaveBeenCalledWith(renameMock.mock.calls[0][1]);
  });

  it("copie au lieu de renommer quand une autre ligne désigne le fichier", async () => {
    // Un logo de partenaire collé depuis l'adresse d'un avatar : le renommer
    // casserait cette image-là sans bruit.
    mockDb({ avatar_url: OLD_URL, visible_avatar: 0 });
    referencedMock.mockResolvedValueOnce(true);
    const url = await rotateHiddenAvatarFile(42);
    expect(url).not.toBeNull();
    expect(referencedMock).toHaveBeenCalledWith(OLD_URL, { exceptUserAvatar: 42 });
    expect(renameMock).not.toHaveBeenCalled();
    expect(copyMock.mock.calls[0][0]).toBe(path.join(AVATARS, "42-aaaa.webp"));
    expect(rmMock).not.toHaveBeenCalled();
  });

  it("efface la copie quand l'écriture n'aboutit pas", async () => {
    mockDb({ avatar_url: OLD_URL, visible_avatar: 0 }, 0, OLD_URL);
    referencedMock.mockResolvedValueOnce(true);
    expect(await rotateHiddenAvatarFile(42)).toBeNull();
    expect(unlinkMock).toHaveBeenCalledWith(copyMock.mock.calls[0][1]);
    expect(renameMock).not.toHaveBeenCalled();
  });
});

describe("purgeOptimizedCopies", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rmMock.mockResolvedValue(undefined);
  });

  it("reconnaît les variantes au SHA-256 base64url de la source, comme Next", async () => {
    readdirMock
      .mockResolvedValueOnce(["a", "b", "c"])
      .mockResolvedValueOnce([`31536000.1.e1.${UPSTREAM}.webp`])
      .mockResolvedValueOnce([`31536000.1.e2.${UPSTREAM}.avif`])
      .mockResolvedValueOnce(["31536000.1.e3.ailleurs.webp"]);
    expect(await purgeOptimizedCopies(BYTES)).toBe(2);
  });

  it("ne fait rien sans cache", async () => {
    readdirMock.mockRejectedValueOnce(Object.assign(new Error("absent"), { code: "ENOENT" }));
    expect(await purgeOptimizedCopies(BYTES)).toBe(0);
    expect(rmMock).not.toHaveBeenCalled();
  });
});
