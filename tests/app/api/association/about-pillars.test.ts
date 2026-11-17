import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/about-pillars-service");

import { GET, POST } from "@/app/api/association/about-pillars/route";
import { PUT, DELETE } from "@/app/api/association/about-pillars/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/about-pillars-service";
import { authUser } from "../../../helpers/auth-user";
import { resetIdempotencyForTests } from "@/lib/server/idempotency";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/association/about-pillars", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/association/about-pillars", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the public list without auth", async () => {
    const pillars = [{ id: 1, title: "Accessible", text: "Inscription gratuite.", titleEn: null, textEn: null }];
    jest.mocked(service.listAboutPillars).mockResolvedValue(pillars);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pillars });
  });
});

describe("POST /api/association/about-pillars", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await POST(jsonReq("POST", { title: "X", text: "Y" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await POST(jsonReq("POST", { title: "X", text: "Y" }));
    expect(res.status).toBe(403);
  });

  it("creates a pillar for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const pillar = { id: 5, title: "X", text: "Y", titleEn: null, textEn: null };
    jest.mocked(service.createAboutPillar).mockResolvedValue(pillar);

    const res = await POST(jsonReq("POST", { title: "X", text: "Y" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pillar });
  });

  it("returns 400 with the validation error message", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createAboutPillar).mockRejectedValue(new Error("TITLE_REQUIRED"));

    const res = await POST(jsonReq("POST", { title: "", text: "Y" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "TITLE_REQUIRED" });
  });
});

describe("PUT /api/association/about-pillars/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq("PUT", { title: "X", text: "Y" }), params("1"));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid id with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await PUT(jsonReq("PUT", { title: "X", text: "Y" }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  it("updates a pillar for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const pillar = { id: 3, title: "X", text: "Y", titleEn: null, textEn: null };
    jest.mocked(service.updateAboutPillar).mockResolvedValue(pillar);

    const res = await PUT(jsonReq("PUT", { title: "X", text: "Y" }), params("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pillar });
  });

  it("returns 404 when the pillar does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.updateAboutPillar).mockRejectedValue(new Error("ABOUT_PILLAR_NOT_FOUND"));

    const res = await PUT(jsonReq("PUT", { title: "X", text: "Y" }), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/association/about-pillars/[id]", () => {
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

  it("deletes a pillar for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteAboutPillar).mockResolvedValue(undefined);

    const res = await DELETE(jsonReq("DELETE", {}), params("4"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when the pillar does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.deleteAboutPillar).mockRejectedValue(new Error("ABOUT_PILLAR_NOT_FOUND"));

    const res = await DELETE(jsonReq("DELETE", {}), params("99"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/association/about-pillars — renvoi du même ajout", () => {
  const KEY = "0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f";
  const OTHER = authUser({ id: 3, isAdmin: true });
  const created = { id: 7, title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." };

  beforeEach(() => {
    jest.clearAllMocks();
    resetIdempotencyForTests();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POST_sameRequestKeyTwice_createsOnceAndReturnsSameResource", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createAboutPillar).mockResolvedValue(created);

    const first = await POST(jsonReq("POST", { ...{ title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." }, requestKey: KEY }));
    const second = await POST(jsonReq("POST", { ...{ title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." }, requestKey: KEY }));

    expect(service.createAboutPillar).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
  });

  it("POST_sameRequestKeyOtherUser_createsAgain", async () => {
    jest.mocked(service.createAboutPillar).mockResolvedValue(created);
    jest.mocked(getCurrentUser).mockResolvedValueOnce(admin).mockResolvedValueOnce(OTHER);

    await POST(jsonReq("POST", { ...{ title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." }, requestKey: KEY }));
    await POST(jsonReq("POST", { ...{ title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." }, requestKey: KEY }));

    expect(service.createAboutPillar).toHaveBeenCalledTimes(2);
  });

  it("POST_noRequestKey_createsEachTime", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createAboutPillar).mockResolvedValue(created);

    await POST(jsonReq("POST", { title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." }));
    await POST(jsonReq("POST", { title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." }));

    expect(service.createAboutPillar).toHaveBeenCalledTimes(2);
  });

  it("POST_firstAttemptFails_retryWithSameKeyCreates", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.createAboutPillar).mockRejectedValueOnce(new Error("TITLE_REQUIRED")).mockResolvedValueOnce(created);

    const failed = await POST(jsonReq("POST", { ...{ title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." }, requestKey: KEY }));
    const retried = await POST(jsonReq("POST", { ...{ title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." }, requestKey: KEY }));

    expect(failed.status).toBe(400);
    expect(retried.status).toBe(201);
    expect(service.createAboutPillar).toHaveBeenCalledTimes(2);
  });
});
