import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/benevoles-service");
jest.mock("@/lib/server/stored-upload-cleanup");

import { GET, POST } from "@/app/api/benevoles/route";
import { PUT, DELETE } from "@/app/api/benevoles/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/benevoles-service";
import { resetIdempotencyForTests } from "@/lib/server/idempotency";
import { deleteUnreferencedUpload, storedUploadExists } from "@/lib/server/stored-upload-cleanup";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

const sampleBenevole = {
  id: 1,
  firstName: "Marie",
  pseudo: "MarieD",
  lastName: "Dupont",
  category: "Développeur",
  categoryEn: null,
  photoUrl: null,
  joinedAt: "2024-03-15",
};

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/benevoles", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/benevoles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the public list without auth", async () => {
    jest.mocked(service.listBenevoles).mockResolvedValue([sampleBenevole]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevoles: [sampleBenevole] });
  });

  it("returns an empty array when no benevoles exist", async () => {
    jest.mocked(service.listBenevoles).mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevoles: [] });
  });
});

describe("POST /api/benevoles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const body = {
    firstName: "Marie",
    lastName: "Dupont",
    category: "Développeur",
    joinedAt: "2024-03-15",
  };

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(403);
  });

  it("creates a benevole for admins and returns 201", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockResolvedValue(sampleBenevole);
    const res = await POST(jsonReq("POST", body));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ benevole: sampleBenevole });
  });

  it("returns 400 with the validation error code", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockRejectedValue(new Error("FIRST_NAME_REQUIRED"));
    const res = await POST(jsonReq("POST", { ...body, firstName: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FIRST_NAME_REQUIRED" });
  });

  it("returns 400 for invalid JSON body", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await POST(new Request("http://localhost/api/benevoles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_BODY" });
  });
});

describe("PUT /api/benevoles/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const body = {
    firstName: "Marie",
    lastName: "Dupont",
    category: "Développeur",
    joinedAt: "2024-03-15",
  };

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", body), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("rejects a non-positive id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", body), params("0"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a benevole for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateBenevole).mockResolvedValue(sampleBenevole);
    const res = await PUT(jsonReq("PUT", body), params("1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ benevole: sampleBenevole });
  });

  it("returns 404 when benevole does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateBenevole).mockRejectedValue(new Error("BENEVOLE_NOT_FOUND"));
    const res = await PUT(jsonReq("PUT", body), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/benevoles/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await DELETE(jsonReq("DELETE", {}), params("abc"));
    expect(res.status).toBe(400);
  });

  it("deletes a benevole for admins and returns 200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBenevole).mockResolvedValue(undefined);
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when benevole does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBenevole).mockRejectedValue(new Error("BENEVOLE_NOT_FOUND"));
    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/benevoles/[id] — photo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBenevole).mockResolvedValue(undefined);
  });

  // Le nettoyage ne touche qu'au dossier des bénévoles : une photo désignant
  // l'avatar d'un joueur ne fait plus effacer cet avatar.
  it("délègue au nettoyage borné au dossier des bénévoles", async () => {
    jest.mocked(service.getBenevolePhotoUrl).mockResolvedValue("/api/uploads/avatars/12-abc.webp");
    const res = await DELETE(jsonReq("DELETE", {}), params("1"));
    expect(res.status).toBe(200);
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith("/api/uploads/avatars/12-abc.webp", "benevoles");
  });
});

describe("POST /api/benevoles — renvoi du même ajout", () => {
  const KEY = "0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f";
  const OTHER = authUser({ id: 3, isAdmin: true });
  const created = { ...sampleBenevole, id: 7 };
  const input = { firstName: "Marie", lastName: "Dupont", category: "Développeur", categoryEn: "Developer", joinedAt: "2024-03-15" };

  beforeEach(() => {
    jest.clearAllMocks();
    resetIdempotencyForTests();
    jest.mocked(service.findBenevole).mockImplementation(async () => created);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POST_sameRequestKeyTwice_createsOnceAndReturnsSameResource", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockResolvedValue(created);

    const first = await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const second = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(service.createBenevole).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
  });

  it("POST_sameRequestKeyOtherUser_createsAgain", async () => {
    jest.mocked(service.createBenevole).mockResolvedValue(created);
    jest.mocked(getCurrentUser).mockResolvedValueOnce(admin).mockResolvedValueOnce(OTHER);

    await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(service.createBenevole).toHaveBeenCalledTimes(2);
  });

  it("POST_noRequestKey_createsEachTime", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockResolvedValue(created);

    await POST(jsonReq("POST", input));
    await POST(jsonReq("POST", input));

    expect(service.createBenevole).toHaveBeenCalledTimes(2);
  });

  it("POST_firstAttemptFails_retryWithSameKeyCreates", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockRejectedValueOnce(new Error("FIRST_NAME_REQUIRED")).mockResolvedValueOnce(created);

    const failed = await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const retried = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(failed.status).toBe(400);
    expect(retried.status).toBe(201);
    expect(service.createBenevole).toHaveBeenCalledTimes(2);
  });

  it("POST_replayAfterDelete_createsAgain", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockResolvedValue(created);
    jest.mocked(service.findBenevole).mockResolvedValueOnce(null);

    await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const replay = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(replay.status).toBe(201);
    expect(service.createBenevole).toHaveBeenCalledTimes(2);
  });

  it("POST_replayAfterEdit_returnsCurrentVersion", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockResolvedValue(created);
    const current = { ...created, lastName: "Martin" };
    jest.mocked(service.findBenevole).mockResolvedValueOnce(current);

    await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const replay = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(await replay.json()).toEqual({ benevole: current });
    expect(service.createBenevole).toHaveBeenCalledTimes(1);
  });

  it("POST_nullBody_returns400InvalidBody", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(jsonReq("POST", null));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_BODY" });
    expect(service.createBenevole).not.toHaveBeenCalled();
  });

  it("POST_arrayBody_returns400InvalidBody", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(jsonReq("POST", [input]));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_BODY" });
    expect(service.createBenevole).not.toHaveBeenCalled();
  });
});

describe("POST /api/benevoles — revue de sécurité EF-69", () => {
  const KEY = "0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f";
  const SAME_USER_WITHOUT_RIGHT = authUser({ id: 1, isAdmin: false });
  const created = { ...sampleBenevole, id: 7 };
  const input = { firstName: "Marie", lastName: "Dupont", category: "Développeur", categoryEn: "Developer", joinedAt: "2024-03-15" };

  beforeEach(() => {
    jest.clearAllMocks();
    resetIdempotencyForTests();
  });

  it("POST_permissionRevokedBeforeReplay_returns403AndNoReplay", async () => {
    jest.mocked(getCurrentUser).mockResolvedValueOnce(admin).mockResolvedValueOnce(SAME_USER_WITHOUT_RIGHT);
    jest.mocked(service.createBenevole).mockResolvedValue(created);

    await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const replay = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(replay.status).toBe(403);
    expect(await replay.json()).toEqual({ error: "FORBIDDEN" });
    expect(service.createBenevole).toHaveBeenCalledTimes(1);
  });

  it("POST_bodyTooLarge_returns413", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(jsonReq("POST", { ...input, pad: "x".repeat(300 * 1024) }));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
    expect(service.createBenevole).not.toHaveBeenCalled();
  });

  it("POST_nonJsonContentType_returns415", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(
      new Request("http://localhost/api/benevoles", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "name=x" }),
    );

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "UNSUPPORTED_CONTENT_TYPE" });
    expect(service.createBenevole).not.toHaveBeenCalled();
  });

  it("POST_photoFileMissing_createsWithoutPhoto", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockResolvedValue(created);
    jest.mocked(storedUploadExists).mockResolvedValue(false);

    await POST(jsonReq("POST", { ...input, photoUrl: "/api/uploads/benevoles/7-abc.webp" }));

    expect(jest.mocked(service.createBenevole).mock.calls[0][0].photoUrl).toBeNull();
  });

  it("POST_photoFilePresent_keepsPhoto", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBenevole).mockResolvedValue(created);
    jest.mocked(storedUploadExists).mockResolvedValue(true);

    await POST(jsonReq("POST", { ...input, photoUrl: "/api/uploads/benevoles/7-abc.webp" }));

    expect(jest.mocked(service.createBenevole).mock.calls[0][0].photoUrl).toBe("/api/uploads/benevoles/7-abc.webp");
  });
});
