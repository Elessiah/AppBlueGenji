import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/database", () => ({ getDatabase: jest.fn() }));
jest.mock("@/lib/server/geti/objections", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/geti/objections")>("@/lib/server/geti/objections");
  return { ...actual, recordGetiObjection: jest.fn(), liftGetiObjection: jest.fn() };
});
jest.mock("@/lib/server/staff-audit");

import { DELETE, POST } from "@/app/api/admin/geti/objections/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { liftGetiObjection, recordGetiObjection } from "@/lib/server/geti/objections";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { authUser } from "../../../helpers/auth-user";
import { fakePool } from "../../../helpers/sql-double";

/** `/api/admin/geti/objections` : opposition d'un auteur aux annonces GETI recopiées, et sa levée (permission `moderation`). */

const admin = authUser({ id: 1, pseudo: "Admin", isAdmin: true });
const referee = authUser({ id: 2, pseudo: "Arbitre", roles: ["ARBITRE"] });
const AUTHOR_ID = "100000000000000001";
const pool = fakePool({});

function request(method: "POST" | "DELETE", payload: unknown): Request {
  return new Request("http://localhost/api/admin/geti/objections", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getDatabase).mockResolvedValue(pool);
  jest.mocked(recordGetiObjection).mockResolvedValue(2);
  jest.mocked(liftGetiObjection).mockResolvedValue(true);
});

describe("POST /api/admin/geti/objections", () => {
  it("POST_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await POST(request("POST", { authorId: AUTHOR_ID }));

    expect(response.status).toBe(401);
    expect(recordGetiObjection).not.toHaveBeenCalled();
  });

  it("POST_withoutModerationPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);

    const response = await POST(request("POST", { authorId: AUTHOR_ID }));

    expect(response.status).toBe(403);
    expect(recordGetiObjection).not.toHaveBeenCalled();
  });

  it("POST_bothIds_returns400WithItsCode", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const response = await POST(request("POST", { authorId: AUTHOR_ID, messageId: "100000000000000901" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_GETI_OBJECTION" });
    expect(recordGetiObjection).not.toHaveBeenCalled();
  });

  it("POST_validAuthor_recordsItAndReturnsTheRemovedCount", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const response = await POST(request("POST", { authorId: AUTHOR_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: 2 });
    expect(recordGetiObjection).toHaveBeenCalledWith(pool, { kind: "author", targetId: AUTHOR_ID });
    expect(auditStaffAction).toHaveBeenCalledWith(expect.stringContaining("opposition enregistrée"), admin);
  });

  it("POST_databaseFailure_returns500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(recordGetiObjection).mockRejectedValue(new Error("connection lost"));

    const response = await POST(request("POST", { authorId: AUTHOR_ID }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "GETI_OBJECTION_FAILED" });
  });
});

describe("DELETE /api/admin/geti/objections", () => {
  it("DELETE_withoutModerationPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);

    const response = await DELETE(request("DELETE", { authorId: AUTHOR_ID }));

    expect(response.status).toBe(403);
    expect(liftGetiObjection).not.toHaveBeenCalled();
  });

  it("DELETE_validMessage_liftsItAndReturnsLifted", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const response = await DELETE(request("DELETE", { messageId: "100000000000000901" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lifted: true });
    expect(liftGetiObjection).toHaveBeenCalledWith(pool, { kind: "message", targetId: "100000000000000901" });
  });
});
