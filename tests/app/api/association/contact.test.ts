import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/contact-service");

import { GET, PUT } from "@/app/api/association/contact/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/contact-service";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const normalUser = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/association/contact", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/association/contact", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("returns the press email without auth", async () => {
    (service.getPressEmail as jest.Mock).mockResolvedValue("presse@bg.fr" as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "presse@bg.fr" });
  });
});

describe("PUT /api/association/contact", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejects anonymous users with 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await PUT(jsonReq({ email: "x@y.fr" }));
    expect(res.status).toBe(401);
    expect(service.setPressEmail).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(normalUser as never);
    const res = await PUT(jsonReq({ email: "x@y.fr" }));
    expect(res.status).toBe(403);
    expect(service.setPressEmail).not.toHaveBeenCalled();
  });

  it("updates the email for admins", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.setPressEmail as jest.Mock).mockResolvedValue("new@bg.fr" as never);

    const res = await PUT(jsonReq({ email: "New@BG.fr" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "new@bg.fr" });
  });

  it("returns 400 with the validation error message", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (service.setPressEmail as jest.Mock).mockRejectedValue(new Error("EMAIL_INVALID") as never);

    const res = await PUT(jsonReq({ email: "bad" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "EMAIL_INVALID" });
  });
});
