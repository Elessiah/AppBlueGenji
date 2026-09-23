import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/user-avatar-import");

import { adoptRemoteAvatar } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { importRemoteAvatar, shouldImportRemoteAvatar } from "@/lib/server/user-avatar-import";

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
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { queries };
}

beforeEach(() => {
  jest.clearAllMocks();
  (shouldImportRemoteAvatar as jest.Mock).mockReturnValue(true);
  (importRemoteAvatar as jest.Mock).mockResolvedValue(
    "/api/uploads/avatars/7-new.webp" as never,
  );
  (deleteStoredImage as jest.Mock).mockResolvedValue(undefined as never);
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
    const queries: Query[] = [];
    let alive = true;
    const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: q, params });
      if (q.startsWith("UPDATE bg_users")) return [{ affectedRows: 0 }];
      const rows = alive ? [{ avatar_url: null }] : [];
      alive = false;
      return [rows];
    });
    (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);

    await adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png");

    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/7-new.webp");
  });

  it("ne remonte jamais un disque récalcitrant — la fonction est silencieuse par contrat", async () => {
    fakeDb({ alive: false });
    // Lecture vivante forcée : on veut atteindre le ménage.
    (getDatabase as jest.Mock).mockResolvedValue({
      execute: jest.fn(async (sql: string) =>
        String(sql).trim().startsWith("UPDATE")
          ? [{ affectedRows: 0 }]
          : [[{ avatar_url: null }]],
      ),
    } as never);
    (deleteStoredImage as jest.Mock).mockRejectedValue(new Error("EROFS") as never);

    await expect(
      adoptRemoteAvatar(7, "https://cdn.example.invalid/a.png"),
    ).resolves.toBeUndefined();
  });
});
