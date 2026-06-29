import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/image-upload");

import { POST } from "@/app/api/landing/sponsors/logo/route";
import { getCurrentUser } from "@/lib/server/auth";
import { processAndStoreImage } from "@/lib/server/image-upload";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function fileReq(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/landing/sponsors/logo", { method: "POST", body: form });
}

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
}

describe("POST /api/landing/sponsors/logo", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await POST(fileReq(pngFile()))).status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    expect((await POST(fileReq(pngFile()))).status).toBe(403);
  });

  it("returns 400 when no file is provided", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    const res = await POST(fileReq());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FILE_MISSING" });
  });

  it("stores the logo and returns its served url for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (processAndStoreImage as jest.Mock).mockResolvedValue("/uploads/sponsors/1-abc.webp" as never);

    const res = await POST(fileReq(pngFile()));
    expect(res.status).toBe(200);
    // Le fichier reste sur disque sous `/uploads/...`, mais l'URL exposée passe
    // par `/api/uploads/...` (servie par un route handler, cf. bug Turbopack).
    expect(await res.json()).toEqual({ logoUrl: "/api/uploads/sponsors/1-abc.webp" });
    expect(processAndStoreImage).toHaveBeenCalledWith(expect.any(File), "sponsor-logo", 1);
  });

  it("surfaces processing errors as 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (processAndStoreImage as jest.Mock).mockRejectedValue(new Error("IMAGE_TOO_LARGE") as never);

    const res = await POST(fileReq(pngFile()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IMAGE_TOO_LARGE" });
  });
});
