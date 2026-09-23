import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/users-service");

import { DELETE, POST } from "@/app/api/profile/avatar/route";
import { getCurrentUser } from "@/lib/server/auth";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { getUserById, updateUserAvatar } from "@/lib/server/users-service";

const user = { id: 42 } as Awaited<ReturnType<typeof getCurrentUser>>;

function fileReq(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/profile/avatar", { method: "POST", body: form });
}

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "avatar.png", { type: "image/png" });
}

describe("POST /api/profile/avatar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // L'écriture réussit, sauf mention contraire : un compte vivant.
    (updateUserAvatar as jest.Mock).mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await POST(fileReq(pngFile()))).status).toBe(401);
  });

  it("returns 400 when no file is provided", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    const res = await POST(fileReq());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FILE_MISSING" });
  });

  it("stores the avatar under its served url (not the raw disk path)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({ avatarUrl: null } as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/avatars/42-abc.webp" as never);

    const res = await POST(fileReq(pngFile()));
    expect(res.status).toBe(200);
    // Le fichier est écrit sur disque sous `/uploads/...` mais servi via
    // `/api/uploads/...` (le static Turbopack ne sert pas les fichiers écrits
    // après démarrage → 404). C'est cette URL servie qui est persistée/rendue.
    expect(await res.json()).toEqual({ avatarUrl: "/api/uploads/avatars/42-abc.webp" });
    expect(updateUserAvatar).toHaveBeenCalledWith(42, "/api/uploads/avatars/42-abc.webp");
    expect(processAndStoreImage).toHaveBeenCalledWith(expect.any(File), "avatar", 42);
  });

  it("deletes the previous avatar file (served url → disk path)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({ avatarUrl: "/api/uploads/avatars/old.webp" } as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/avatars/new.webp" as never);

    await POST(fileReq(pngFile()));
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/old.webp");
  });

  it("does not delete external avatar urls (google/discord)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({ avatarUrl: "https://cdn.discord.com/x.png" } as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/avatars/new.webp" as never);

    await POST(fileReq(pngFile()));
    expect(deleteStoredImage).toHaveBeenCalledWith(null);
  });

  it("surfaces processing errors as 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({ avatarUrl: null } as never);
    (processAndStoreImage as jest.Mock).mockRejectedValue(new Error("IMAGE_TOO_LARGE") as never);

    const res = await POST(fileReq(pngFile()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IMAGE_TOO_LARGE" });
  });
});

describe("DELETE /api/profile/avatar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Le compte est vivant, sauf mention contraire — et le dire ici plutôt que
    // de l'hériter du bloc précédent : `clearAllMocks` ne retire pas les
    // implémentations, si bien que ce bloc vivait sur le réglage du voisin.
    (updateUserAvatar as jest.Mock).mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await DELETE()).status).toBe(401);
  });

  it("clears the avatar and removes the stored file", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({ avatarUrl: "/api/uploads/avatars/old.webp" } as never);

    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatarUrl: null });
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/old.webp");
    expect(updateUserAvatar).toHaveBeenCalledWith(42, null);
  });

  /**
   * **La base d'abord, le fichier ensuite.** L'ordre inverse effaçait l'image
   * avant l'écriture qui la déréférence : cette route n'a pas de `try/catch`,
   * et une écriture en échec laissait `avatar_url` pointer sur un fichier
   * disparu — une image cassée, que plus rien ne répare.
   */
  it("n'efface le fichier qu'une fois la ligne mise à jour", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({
      avatarUrl: "/api/uploads/avatars/old.webp",
    } as never);
    const order: string[] = [];
    (updateUserAvatar as jest.Mock).mockImplementation(async () => {
      order.push("db");
      return true;
    });
    (deleteStoredImage as jest.Mock).mockImplementation(async () => {
      order.push("file");
    });

    await DELETE();

    expect(order).toEqual(["db", "file"]);
  });

  it("refuse en 409 quand la ligne n'accepte plus rien, et garde le fichier", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({
      avatarUrl: "/api/uploads/avatars/old.webp",
    } as never);
    (updateUserAvatar as jest.Mock).mockResolvedValue(false as never);

    const res = await DELETE();

    // Annoncer « avatar supprimé » sur une écriture qui n'a rien apparié serait
    // faux ; et il n'y a rien à reprendre ici, la suppression du compte
    // emportant la photo de son côté.
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ACCOUNT_DELETED" });
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });
});

describe("POST /api/profile/avatar — course avec la suppression du compte", () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Un téléversement parti avant la suppression reprend **après** son commit,
   * bloqué jusque-là sur le verrou de la ligne. L'écriture est refusée ; le
   * fichier, lui, est déjà sur le disque et serait servi seul par
   * `/api/uploads/avatars/…` — survivant à un compte dont on vient de promettre
   * qu'il ne resterait rien.
   */
  it("reprend le fichier qu'il vient d'écrire quand la ligne n'accepte plus rien", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({ avatarUrl: null } as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/avatars/42-new.webp" as never);
    (updateUserAvatar as jest.Mock).mockResolvedValue(false as never);

    const res = await POST(fileReq(pngFile()));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ACCOUNT_DELETED" });
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/42-new.webp");
  });

  it("ne touche pas à l'ancienne photo d'un compte qu'il n'a pas modifié", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getUserById as jest.Mock).mockResolvedValue({
      avatarUrl: "/api/uploads/avatars/old.webp",
    } as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/avatars/42-new.webp" as never);
    (updateUserAvatar as jest.Mock).mockResolvedValue(false as never);

    await POST(fileReq(pngFile()));

    expect(deleteStoredImage).toHaveBeenCalledTimes(1);
    expect(deleteStoredImage).not.toHaveBeenCalledWith("/uploads/avatars/old.webp");
  });
});

/**
 * Le ménage du fichier est un **résidu**, jamais un échec.
 *
 * `deleteStoredImage` relève tout ce qui n'est pas `ENOENT` (disque en lecture
 * seule, droits qui ont glissé après un déploiement), et il est appelé **après**
 * l'écriture qui déréférence l'image. Laisser l'erreur remonter rendait donc un
 * refus sur une modification déjà commitée : le `DELETE` n'ayant aucun
 * `try/catch`, un `EACCES` sortait en 500 alors qu'`avatar_url` était bien
 * vidée — l'écran ne posait pas son `setData` et continuait d'afficher l'avatar
 * retiré jusqu'au rechargement suivant.
 */
describe("avatar — l'échec du ménage ne dément pas la base", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (updateUserAvatar as jest.Mock).mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  function unlinkRefused(): Error {
    const error = new Error("EACCES: permission denied") as Error & { code: string };
    error.code = "EACCES";
    return error;
  }

  it("DELETE rend 200 quand l'ancien fichier ne peut pas être retiré", async () => {
    (getUserById as jest.Mock).mockResolvedValue({
      avatarUrl: "/api/uploads/avatars/42-old.webp",
    } as never);
    (deleteStoredImage as jest.Mock).mockRejectedValue(unlinkRefused() as never);

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatarUrl: null });
    // L'écriture, elle, a bien eu lieu : c'est ce que la réponse décrit.
    expect(updateUserAvatar).toHaveBeenCalledWith(42, null);
  });

  it("POST rend 200 quand l'ancien fichier ne peut pas être retiré", async () => {
    (getUserById as jest.Mock).mockResolvedValue({
      avatarUrl: "/api/uploads/avatars/42-old.webp",
    } as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/avatars/42-new.webp" as never);
    (deleteStoredImage as jest.Mock).mockRejectedValue(unlinkRefused() as never);

    const res = await POST(fileReq(pngFile()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatarUrl: "/api/uploads/avatars/42-new.webp" });
  });

  it("POST garde son 409 quand le compte est supprimé et le fichier irretirable", async () => {
    // Deux faits se disputent la réponse : le compte supprimé et l'`unlink`
    // refusé. Seul le premier intéresse l'écran, qui n'a de phrase française
    // que pour lui — le second sortait en 400 par le `catch` de la route.
    (getUserById as jest.Mock).mockResolvedValue({ avatarUrl: null } as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/avatars/42-new.webp" as never);
    (updateUserAvatar as jest.Mock).mockResolvedValue(false as never);
    (deleteStoredImage as jest.Mock).mockRejectedValue(unlinkRefused() as never);

    const res = await POST(fileReq(pngFile()));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ACCOUNT_DELETED" });
  });

  it("laisse tout de même passer un échec d'écriture du fichier téléversé", async () => {
    // La garde ne couvre que le **ménage**. Un téléversement qui ne s'écrit pas
    // n'a rien produit : le refus est le fait à rendre.
    (getUserById as jest.Mock).mockResolvedValue({ avatarUrl: null } as never);
    (processAndStoreImage as jest.Mock).mockRejectedValue(new Error("IMAGE_TOO_LARGE") as never);

    const res = await POST(fileReq(pngFile()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IMAGE_TOO_LARGE" });
  });
});
