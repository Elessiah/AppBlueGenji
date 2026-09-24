import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/teams-service");

import { DELETE, POST } from "@/app/api/teams/[id]/logo/route";
import { getCurrentUser } from "@/lib/server/auth";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { canManageTeam, getTeamLogoUrl, isGhostTeam, updateTeamLogo } from "@/lib/server/teams-service";
import { authUser } from "../../../helpers/auth-user";

const user = authUser({ id: 7 });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function fileReq(file?: File, rightsCertified: string | null = "1") {
  const form = new FormData();
  if (file) form.append("file", file);
  if (rightsCertified !== null) form.append("rightsCertified", rightsCertified);
  return new Request("http://localhost/api/teams/3/logo", { method: "POST", body: form });
}

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
}

describe("POST /api/teams/[id]/logo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await POST(fileReq(pngFile()), params("3"))).status).toBe(401);
  });

  it("rejects an invalid team id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    expect((await POST(fileReq(pngFile()), params("abc"))).status).toBe(400);
  });

  it("rejects users who cannot manage the team with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(canManageTeam).mockResolvedValue(false);
    expect((await POST(fileReq(pngFile()), params("3"))).status).toBe(403);
  });

  it("returns 400 when no file is provided", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(canManageTeam).mockResolvedValue(true);
    const res = await POST(fileReq(), params("3"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FILE_MISSING" });
  });

  it("stores the logo under its served url (not the raw disk path)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(canManageTeam).mockResolvedValue(true);
    jest.mocked(getTeamLogoUrl).mockResolvedValue(null);
    jest.mocked(processAndStoreImage).mockResolvedValue("/uploads/teams/3-abc.webp");

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
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(canManageTeam).mockResolvedValue(true);
    jest.mocked(getTeamLogoUrl).mockResolvedValue("/api/uploads/teams/old.webp");
    jest.mocked(processAndStoreImage).mockResolvedValue("/uploads/teams/new.webp");

    await POST(fileReq(pngFile()), params("3"));
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/teams/old.webp");
  });

  it("does not delete external logo urls", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(canManageTeam).mockResolvedValue(true);
    jest.mocked(getTeamLogoUrl).mockResolvedValue("https://cdn.example.com/x.png");
    jest.mocked(processAndStoreImage).mockResolvedValue("/uploads/teams/new.webp");

    await POST(fileReq(pngFile()), params("3"));
    expect(deleteStoredImage).toHaveBeenCalledWith(null);
  });

  it("surfaces processing errors as 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(canManageTeam).mockResolvedValue(true);
    jest.mocked(getTeamLogoUrl).mockResolvedValue(null);
    jest.mocked(processAndStoreImage).mockRejectedValue(new Error("IMAGE_TOO_LARGE"));

    const res = await POST(fileReq(pngFile()), params("3"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IMAGE_TOO_LARGE" });
  });
});

describe("POST /api/teams/[id]/logo — droits et conditions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(canManageTeam).mockResolvedValue(true);
    jest.mocked(getTeamLogoUrl).mockResolvedValue(null);
    jest.mocked(processAndStoreImage).mockResolvedValue("/uploads/teams/3-new.webp");
  });

  it.each<[string, string | null]>([
    ["case absente", null],
    ["case décochée", "0"],
    ["valeur quelconque", "true"],
  ])("refuse l'envoi sans la garantie des droits (%s), avant tout traitement du fichier", async (_label, value) => {
    const res = await POST(fileReq(pngFile(), value), params("3"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "LOGO_RIGHTS_NOT_CERTIFIED" });
    expect(processAndStoreImage).not.toHaveBeenCalled();
  });

  it("refuse en 409 à qui gère l'équipe sans avoir accepté les conditions, et efface le fichier neuf", async () => {
    jest.mocked(updateTeamLogo).mockRejectedValueOnce(new Error("TERMS_ACCEPTANCE_REQUIRED"));
    const res = await POST(fileReq(pngFile()), params("3"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TERMS_ACCEPTANCE_REQUIRED" });
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/teams/3-new.webp");
  });

  it("n'interroge la fantôme que si le rôle manque", async () => {
    await POST(fileReq(pngFile()), params("3"));
    expect(isGhostTeam).not.toHaveBeenCalled();

    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7, isAdmin: true, roles: ["ADMIN"] }));
    jest.mocked(canManageTeam).mockResolvedValue(false);
    jest.mocked(isGhostTeam).mockResolvedValue(true);
    const res = await POST(fileReq(pngFile()), params("3"));
    expect(res.status).toBe(200);
    expect(updateTeamLogo).toHaveBeenLastCalledWith(7, 3, "/api/uploads/teams/3-new.webp", true);
  });

  it("efface le fichier neuf quand l'écriture est refusée entre-temps", async () => {
    jest.mocked(updateTeamLogo).mockRejectedValueOnce(new Error("FORBIDDEN"));
    const res = await POST(fileReq(pngFile()), params("3"));
    expect(res.status).toBe(403);
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/teams/3-new.webp");
  });
});

describe("DELETE /api/teams/[id]/logo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost/api/teams/3/logo"), params("3"));
    expect(res.status).toBe(401);
  });

  it("clears the logo and removes the stored file", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(getTeamLogoUrl).mockResolvedValue("/api/uploads/teams/old.webp");

    const res = await DELETE(new Request("http://localhost/api/teams/3/logo"), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logoUrl: null });
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/teams/old.webp");
    expect(updateTeamLogo).toHaveBeenCalledWith(7, 3, null, false);
  });
});
