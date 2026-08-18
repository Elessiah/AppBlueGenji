import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/teams-service");

import { DELETE, POST } from "@/app/api/teams/[id]/logo/route";
import { getCurrentUser } from "@/lib/server/auth";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { canManageTeam, getTeamLogoUrl, updateTeamLogo } from "@/lib/server/teams-service";

const user = { id: 7 } as Awaited<ReturnType<typeof getCurrentUser>>;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function fileReq(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/teams/3/logo", { method: "POST", body: form });
}

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
}

describe("POST /api/teams/[id]/logo", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await POST(fileReq(pngFile()), params("3"))).status).toBe(401);
  });

  it("rejects an invalid team id with 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    expect((await POST(fileReq(pngFile()), params("abc"))).status).toBe(400);
  });

  it("rejects users who cannot manage the team with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (canManageTeam as jest.Mock).mockResolvedValue(false as never);
    expect((await POST(fileReq(pngFile()), params("3"))).status).toBe(403);
  });

  it("returns 400 when no file is provided", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (canManageTeam as jest.Mock).mockResolvedValue(true as never);
    const res = await POST(fileReq(), params("3"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FILE_MISSING" });
  });

  it("stores the logo under its served url (not the raw disk path)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (canManageTeam as jest.Mock).mockResolvedValue(true as never);
    (getTeamLogoUrl as jest.Mock).mockResolvedValue(null as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/teams/3-abc.webp" as never);

    const res = await POST(fileReq(pngFile()), params("3"));
    expect(res.status).toBe(200);
    // Servi via `/api/uploads/...` (le static Turbopack ne sert pas les fichiers
    // écrits après démarrage → 404) : c'est cette URL qui est persistée/rendue.
    expect(await res.json()).toEqual({ logoUrl: "/api/uploads/teams/3-abc.webp" });
    // Le dernier argument = « le viewer administre les équipes fantômes »
    // (permission `tournaments`) ; faux pour un simple membre.
    expect(updateTeamLogo).toHaveBeenCalledWith(7, 3, "/api/uploads/teams/3-abc.webp", false);
    expect(processAndStoreImage).toHaveBeenCalledWith(expect.any(File), "team-logo", 3);
  });

  it("deletes the previous logo file (served url → disk path)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (canManageTeam as jest.Mock).mockResolvedValue(true as never);
    (getTeamLogoUrl as jest.Mock).mockResolvedValue("/api/uploads/teams/old.webp" as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/teams/new.webp" as never);

    await POST(fileReq(pngFile()), params("3"));
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/teams/old.webp");
  });

  it("does not delete external logo urls", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (canManageTeam as jest.Mock).mockResolvedValue(true as never);
    (getTeamLogoUrl as jest.Mock).mockResolvedValue("https://cdn.example.com/x.png" as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/teams/new.webp" as never);

    await POST(fileReq(pngFile()), params("3"));
    expect(deleteStoredImage).toHaveBeenCalledWith(null);
  });

  it("surfaces processing errors as 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (canManageTeam as jest.Mock).mockResolvedValue(true as never);
    (getTeamLogoUrl as jest.Mock).mockResolvedValue(null as never);
    (processAndStoreImage as jest.Mock).mockRejectedValue(new Error("IMAGE_TOO_LARGE") as never);

    const res = await POST(fileReq(pngFile()), params("3"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IMAGE_TOO_LARGE" });
  });
});

describe("DELETE /api/teams/[id]/logo", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await DELETE(new Request("http://localhost/api/teams/3/logo"), params("3"));
    expect(res.status).toBe(401);
  });

  it("clears the logo and removes the stored file", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
    (getTeamLogoUrl as jest.Mock).mockResolvedValue("/api/uploads/teams/old.webp" as never);

    const res = await DELETE(new Request("http://localhost/api/teams/3/logo"), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logoUrl: null });
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/teams/old.webp");
    expect(updateTeamLogo).toHaveBeenCalledWith(7, 3, null, false);
  });
});
