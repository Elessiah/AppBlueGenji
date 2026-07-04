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
  beforeEach(() => jest.clearAllMocks());
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
  beforeEach(() => jest.clearAllMocks());
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
});
