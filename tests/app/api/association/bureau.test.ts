import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bureau-service");

import { GET, POST } from "@/app/api/association/bureau/route";
import { PUT, DELETE } from "@/app/api/association/bureau/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/bureau-service";
import { resetIdempotencyForTests } from "@/lib/server/idempotency";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/association/bureau", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/association/bureau", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the public list without auth", async () => {
    const members = [{ id: 1, name: "Léo", role: "Président", roleEn: null, initials: "LP", color: "c" }];
    jest.mocked(service.listBureauMembers).mockResolvedValue(members);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ members });
  });
});

describe("POST /api/association/bureau", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(403);
  });

  it("creates a member for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const member = { id: 5, name: "X", role: "Y", roleEn: null, initials: "X", color: "c" };
    jest.mocked(service.createBureauMember).mockResolvedValue(member);

    const res = await POST(jsonReq("POST", { name: "X", role: "Y" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ member });
  });

  it("returns 400 with the validation error message", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBureauMember).mockRejectedValue(new Error("NAME_REQUIRED"));

    const res = await POST(jsonReq("POST", { name: "", role: "Y" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "NAME_REQUIRED" });
  });
});

describe("PUT /api/association/bureau/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a member for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const member = { id: 3, name: "X", role: "Y", roleEn: null, initials: "X", color: "c" };
    jest.mocked(service.updateBureauMember).mockResolvedValue(member);

    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ member });
  });

  it("returns 404 when the member does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateBureauMember).mockRejectedValue(new Error("BUREAU_MEMBER_NOT_FOUND"));

    const res = await PUT(jsonReq("PUT", { name: "X", role: "Y" }), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/association/bureau/[id]", () => {
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

  it("deletes a member for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBureauMember).mockResolvedValue(undefined);

    const res = await DELETE(jsonReq("DELETE", {}), params("4"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when the member does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteBureauMember).mockRejectedValue(new Error("BUREAU_MEMBER_NOT_FOUND"));

    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/association/bureau — renvoi du même ajout", () => {
  const KEY = "0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f";
  const OTHER = authUser({ id: 3, isAdmin: true });
  const created = { id: 7, name: "Léo", role: "Président", roleEn: "President", initials: "L", color: "#5ac8ff" };
  const input = { name: "Léo", role: "Président", roleEn: "President" };

  beforeEach(() => {
    jest.clearAllMocks();
    resetIdempotencyForTests();
    jest.mocked(service.findBureauMember).mockImplementation(async () => created);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POST_sameRequestKeyTwice_createsOnceAndReturnsSameResource", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBureauMember).mockResolvedValue(created);

    const first = await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const second = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(service.createBureauMember).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
  });

  it("POST_sameRequestKeyOtherUser_createsAgain", async () => {
    jest.mocked(service.createBureauMember).mockResolvedValue(created);
    jest.mocked(getCurrentUser).mockResolvedValueOnce(admin).mockResolvedValueOnce(OTHER);

    await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(service.createBureauMember).toHaveBeenCalledTimes(2);
  });

  it("POST_noRequestKey_createsEachTime", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBureauMember).mockResolvedValue(created);

    await POST(jsonReq("POST", input));
    await POST(jsonReq("POST", input));

    expect(service.createBureauMember).toHaveBeenCalledTimes(2);
  });

  it("POST_firstAttemptFails_retryWithSameKeyCreates", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBureauMember).mockRejectedValueOnce(new Error("BUREAU_ROLE_REQUIRED")).mockResolvedValueOnce(created);

    const failed = await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const retried = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(failed.status).toBe(400);
    expect(retried.status).toBe(201);
    expect(service.createBureauMember).toHaveBeenCalledTimes(2);
  });

  it("POST_replayAfterDelete_createsAgain", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBureauMember).mockResolvedValue(created);
    jest.mocked(service.findBureauMember).mockResolvedValueOnce(null);

    await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const replay = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(replay.status).toBe(201);
    expect(service.createBureauMember).toHaveBeenCalledTimes(2);
  });

  it("POST_replayAfterEdit_returnsCurrentVersion", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createBureauMember).mockResolvedValue(created);
    const current = { ...created, name: "Léa" };
    jest.mocked(service.findBureauMember).mockResolvedValueOnce(current);

    await POST(jsonReq("POST", { ...input, requestKey: KEY }));
    const replay = await POST(jsonReq("POST", { ...input, requestKey: KEY }));

    expect(await replay.json()).toEqual({ member: current });
    expect(service.createBureauMember).toHaveBeenCalledTimes(1);
  });

  it("POST_nullBody_returns400InvalidBody", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(jsonReq("POST", null));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_BODY" });
    expect(service.createBureauMember).not.toHaveBeenCalled();
  });

  it("POST_arrayBody_returns400InvalidBody", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(jsonReq("POST", [input]));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_BODY" });
    expect(service.createBureauMember).not.toHaveBeenCalled();
  });
});
