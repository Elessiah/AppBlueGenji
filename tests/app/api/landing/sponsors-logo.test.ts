import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/image-upload");

import { POST } from "@/app/api/landing/sponsors/logo/route";
import { getCurrentUser } from "@/lib/server/auth";
import { processAndStoreImage } from "@/lib/server/image-upload";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function fileReq(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/landing/sponsors/logo", { method: "POST", body: form });
}

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
}

describe("POST /api/landing/sponsors/logo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await POST(fileReq(pngFile()))).status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    expect((await POST(fileReq(pngFile()))).status).toBe(403);
  });

  it("returns 400 when no file is provided", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await POST(fileReq());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FILE_MISSING" });
  });

  it("stores the logo and returns its served url for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(processAndStoreImage).mockResolvedValue("/uploads/sponsors/1-abc.webp");

    const res = await POST(fileReq(pngFile()));
    expect(res.status).toBe(200);
    // Le fichier reste sur disque sous `/uploads/...`, mais l'URL exposée passe
    // par `/api/uploads/...` (servie par un route handler, cf. bug Turbopack).
    expect(await res.json()).toEqual({ logoUrl: "/api/uploads/sponsors/1-abc.webp" });
    expect(processAndStoreImage).toHaveBeenCalledWith(expect.any(File), "sponsor-logo", 1);
  });

  it("surfaces processing errors as 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(processAndStoreImage).mockRejectedValue(new Error("IMAGE_TOO_LARGE"));

    const res = await POST(fileReq(pngFile()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "IMAGE_TOO_LARGE" });
  });
});
