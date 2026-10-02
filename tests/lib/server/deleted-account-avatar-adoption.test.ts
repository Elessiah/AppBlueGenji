import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/user-avatar-import");

import { adoptRemoteAvatar } from "@/lib/server/users/sign-in";
import { getDatabase } from "@/lib/server/database";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { importRemoteAvatar, shouldImportRemoteAvatar } from "@/lib/server/user-avatar-import";
import { fakePool } from "../../helpers/sql-double";

/**
 * La copie de la photo d'un fournisseur, et la course la plus longue de toutes.
 *
 * Entre la lecture de `avatar_url` et son écriture, `adoptRemoteAvatar`
 * télécharge une image chez un tiers et la retraite : des secondes, pendant
 * lesquelles le joueur peut supprimer son compte dans un autre onglet. Deux
 * dégâts distincts, et le second survit même au mode « effacement » :
 *
 * 1. **la ligne anonymisée récupérait une photo personnelle**, publiquement
 *    servie par `/api/uploads/avatars/…` et republiée sur l'entrée solo à la
 *    prochaine resynchronisation ;
 * 2. **le fichier reste sur le disque quoi qu'il arrive** — l'écriture refusée
 *    ne le reprend pas d'elle-même, et sur un compte effacé plus aucune ligne
 *    ne le désigne : une donnée personnelle orpheline, derrière un compte dont
 *    on vient de promettre qu'il ne resterait rien.
 */
type Query = { sql: string; params: unknown[] };

function fakeDb(options: { alive: boolean }) {
  const queries: Query[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (q.startsWith("UPDATE bg_users")) {
      return [{ affectedRows: options.alive ? 1 : 0 }];
    }
    // La lecture ne rend la ligne que si elle est vivante : c'est la condition
    // que porte la requête elle-même.
    return [options.alive ? [{ avatar_url: null }] : []];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return { queries };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(shouldImportRemoteAvatar).mockReturnValue(true);
  jest.mocked(importRemoteAvatar).mockResolvedValue(
    "/api/uploads/avatars/7-new.webp",
  );
  jest.mocked(deleteStoredImage).mockResolvedValue(undefined);
});

describe("adoptRemoteAvatar — la photo ne se pose pas sur une ligne morte", () => {
  it("borne lecture et écriture aux comptes vivants", async () => {
    const { queries } = fakeDb({ alive: true });

    await adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png");

    for (const q of queries) expect(q.sql).toContain("is_deleted = 0");
    expect(queries.some((q) => q.sql.startsWith("UPDATE bg_users"))).toBe(true);
  });

  it("écrit normalement sur un compte vivant, sans rien reprendre", async () => {
    fakeDb({ alive: true });

    await adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png");

    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it("n'ouvre même pas le téléchargement quand la ligne est déjà morte", async () => {
    fakeDb({ alive: false });

    await adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png");

    // La lecture ne rend rien : rien à copier, rien à écrire, aucun appel
    // sortant. C'est la moitié gratuite de la garde.
    expect(importRemoteAvatar).not.toHaveBeenCalled();
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it("reprend le fichier quand la suppression est passée pendant le téléchargement", async () => {
    // La lecture voit une ligne vivante ; l'écriture, quelques secondes plus
    // tard, n'apparie plus rien. Le fichier, lui, est déjà sur le disque.
    let alive = true;
    const execute = jest.fn(async (sql: string) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (q.startsWith("UPDATE bg_users")) return [{ affectedRows: 0 }];
      const rows = alive ? [{ avatar_url: null }] : [];
      alive = false;
      return [rows];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png");

    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/7-new.webp");
  });

  it("ne remonte jamais un disque récalcitrant — la fonction est silencieuse par contrat", async () => {
    fakeDb({ alive: false });
    // Lecture vivante forcée : on veut atteindre le ménage.
    jest.mocked(getDatabase).mockResolvedValue(fakePool({
      execute: jest.fn(async (sql: string) =>
        String(sql).trim().startsWith("UPDATE")
          ? [{ affectedRows: 0 }]
          : [[{ avatar_url: null }]],
      ),
    }));
    jest.mocked(deleteStoredImage).mockRejectedValue(new Error("EROFS"));

    await expect(
      adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png"),
    ).resolves.toBeUndefined();
  });
});

/**
 * **La photo importée naît masquée.** Elle vient du fournisseur, pas d'un choix
 * du joueur : la publier d'office l'aurait mise à disposition de tout membre
 * connecté — et, par l'entrée solo, de la vitrine publique — sans qu'il ait rien
 * fait (RGPD art. 25.2).
 */
describe("adoptRemoteAvatar — protection par défaut", () => {
  it("pose l'avatar et le masque dans la même écriture", async () => {
    const { queries } = fakeDb({ alive: true });

    await adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png");

    const update = queries.find((q) => q.sql.startsWith("UPDATE bg_users"))!;
    expect(update.sql).toContain("avatar_url = ?");
    expect(update.sql).toContain("visible_avatar = 0");
    expect(update.params).toEqual(["/api/uploads/avatars/7-new.webp", 7]);
  });

  it("ne touche pas au réglage quand rien n'est importé", async () => {
    const { queries } = fakeDb({ alive: true });
    jest.mocked(importRemoteAvatar).mockResolvedValue(null);

    await adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png");

    expect(queries.some((q) => q.sql.startsWith("UPDATE bg_users"))).toBe(false);
  });

  it("ne touche pas au réglage d'un compte qui a déjà son propre avatar", async () => {
    const { queries } = fakeDb({ alive: true });
    jest.mocked(shouldImportRemoteAvatar).mockReturnValue(false);

    await adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png");

    expect(importRemoteAvatar).not.toHaveBeenCalled();
    expect(queries.some((q) => q.sql.startsWith("UPDATE bg_users"))).toBe(false);
  });
});
