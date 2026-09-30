import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/account-suspensions");

import { DELETE, POST } from "@/app/api/admin/users/[id]/suspension/route";
import { getCurrentUser } from "@/lib/server/auth";
import { liftSuspension, suspendAccount } from "@/lib/server/account-suspensions";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, pseudo: "Admin", isAdmin: true });
const referee = authUser({ id: 2, pseudo: "Arbitre", roles: ["ARBITRE"] });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const body = { reason: "Propos haineux répétés pendant un match", ground: "BEHAVIOR", durationDays: 7 };
const post = (payload: unknown) =>
  new Request("http://localhost/api/admin/users/5/suspension", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
const del = () => new Request("http://localhost/api/admin/users/5/suspension", { method: "DELETE" });

const view = {
  id: 11,
  reason: body.reason,
  ground: "BEHAVIOR" as const,
  startsAt: "2026-10-01T10:00:00.000Z",
  endsAt: "2026-10-08T10:00:00.000Z",
  liftedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(suspendAccount).mockResolvedValue(view);
  jest.mocked(liftSuspension).mockResolvedValue(11);
});

describe("POST /api/admin/users/[id]/suspension", () => {
  it("prononce la suspension au nom de l'auteur, motif nettoyé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(post({ ...body, reason: `  ${body.reason}\n` }), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suspension: view });
    expect(suspendAccount).toHaveBeenCalledWith(
      5,
      { reason: body.reason, ground: "BEHAVIOR", durationDays: 7 },
      { id: 1, pseudo: "Admin" },
    );
  });

  it.each<[string, typeof admin | null, number]>([
    ["sans session", null, 401],
    ["sans la permission moderation", referee, 403],
  ])("refuse %s", async (_label, user, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    expect((await POST(post(body), params("5"))).status).toBe(status);
    expect(suspendAccount).not.toHaveBeenCalled();
  });

  it.each<[string, unknown, string]>([
    ["sans motif", { ...body, reason: "" }, "SUSPENSION_REASON_REQUIRED"],
    ["sans clause", { ...body, ground: undefined }, "SUSPENSION_INVALID_GROUND"],
    ["sans durée", { reason: body.reason, ground: "BEHAVIOR" }, "SUSPENSION_DURATION_REQUIRED"],
    ["durée invalide", { ...body, durationDays: 1000 }, "SUSPENSION_INVALID_DURATION"],
  ])("refuse en 400 une demande %s", async (_label, payload, code) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await POST(post(payload), params("5"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
    expect(suspendAccount).not.toHaveBeenCalled();
  });

  it("refuse un identifiant invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    expect((await POST(post(body), params("abc"))).status).toBe(400);
  });

  it.each<[string, number]>([
    ["USER_NOT_FOUND", 404],
    ["CANNOT_SUSPEND_SELF", 409],
    ["CANNOT_SUSPEND_ADMIN", 409],
    ["ACCOUNT_ALREADY_SUSPENDED", 409],
  ])("traduit %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(suspendAccount).mockRejectedValue(new Error(code));
    const res = await POST(post(body), params("5"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });

  it("rend une panne en 500 générique, sans le message brut", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(suspendAccount).mockRejectedValue(new Error("Table 'bg.bg_account_suspensions' doesn't exist"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(post(body), params("5"));
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "SUSPENSION_FAILED" });
  });

  it("ne prend pas un nom hérité d'Object pour un refus connu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(suspendAccount).mockRejectedValue(new Error("toString"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(post(body), params("5"));
    spy.mockRestore();
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/admin/users/[id]/suspension", () => {
  it("lève la suspension en cours", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await DELETE(del(), params("5"));
    expect(res.status).toBe(200);
    expect(liftSuspension).toHaveBeenCalledWith(5, { id: 1, pseudo: "Admin" });
  });

  it("réserve le geste à la modération", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);
    expect((await DELETE(del(), params("5"))).status).toBe(403);
    expect(liftSuspension).not.toHaveBeenCalled();
  });

  it("traduit l'absence de suspension en 409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(liftSuspension).mockRejectedValue(new Error("NO_ACTIVE_SUSPENSION"));
    expect((await DELETE(del(), params("5"))).status).toBe(409);
  });
});
