import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");

import { itemRoutes, reorderRoute } from "@/lib/server/admin-collection-routes";
import { getCurrentUser } from "@/lib/server/auth";
import { authUser } from "../../helpers/auth-user";

/**
 * Déroulé commun des routes d'administration des listes (vitrine, recrutement) :
 * l'ordre des refus et la traduction des erreurs du service, que chaque route
 * reprend sans plus l'écrire.
 */

const admin = authUser({ id: 1, isAdmin: true });
const member = authUser({ id: 2, isAdmin: false });

const update = jest.fn<(id: number, body: Record<string, unknown>) => Promise<object>>();
const remove = jest.fn<(id: number) => Promise<void>>();
const reorder = jest.fn<(ids: number[]) => Promise<void>>();

const item = itemRoutes({
  permission: "showcase",
  notFound: "THING_NOT_FOUND",
  updateFailed: "THING_UPDATE_FAILED",
  deleteFailed: "THING_DELETE_FAILED",
  update,
  remove,
});
const order = reorderRoute({
  permission: "showcase",
  reorder,
  failed: "THING_REORDER_FAILED",
  statusOf: (message) => (message === "THING_CONFLICT" ? 409 : 400),
});
const plainOrder = reorderRoute({ permission: "showcase", reorder, failed: "THING_REORDER_FAILED" });

function request(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost/api/things/1", {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function reply(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(admin);
});

describe("itemRoutes — PUT", () => {
  it("rend le corps du service", async () => {
    update.mockResolvedValue({ thing: { id: 4 } });
    expect(await reply(await item.PUT(request('{"name":"A"}'), params("4")))).toEqual({
      status: 200,
      body: { thing: { id: 4 } },
    });
    expect(update).toHaveBeenCalledWith(4, { name: "A" });
  });

  it("refuse dans l'ordre : session, permission, identifiant, corps", async () => {
    jest.mocked(getCurrentUser).mockResolvedValueOnce(null);
    expect(await reply(await item.PUT(request("{}"), params("x")))).toEqual({ status: 401, body: { error: "UNAUTHORIZED" } });
    jest.mocked(getCurrentUser).mockResolvedValueOnce(member);
    expect(await reply(await item.PUT(request("{}"), params("x")))).toEqual({ status: 403, body: { error: "FORBIDDEN" } });
    for (const raw of ["x", "0", "-1", "1.5"]) {
      expect(await reply(await item.PUT(request("{}"), params(raw)))).toEqual({ status: 400, body: { error: "INVALID_ID" } });
    }
    expect(await reply(await item.PUT(request("{"), params("1")))).toEqual({ status: 400, body: { error: "INVALID_BODY" } });
    expect(await reply(await item.PUT(request("{}", "text/plain"), params("1")))).toEqual({
      status: 400,
      body: { error: "INVALID_BODY" },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("traduit l'erreur du service : 404 introuvable, 400 sinon, code de repli si vide", async () => {
    update.mockRejectedValueOnce(new Error("THING_NOT_FOUND"));
    expect(await reply(await item.PUT(request("{}"), params("1")))).toEqual({ status: 404, body: { error: "THING_NOT_FOUND" } });
    update.mockRejectedValueOnce(new Error("THING_NAME_REQUIRED"));
    expect(await reply(await item.PUT(request("{}"), params("1")))).toEqual({ status: 400, body: { error: "THING_NAME_REQUIRED" } });
    update.mockRejectedValueOnce(new Error(""));
    expect(await reply(await item.PUT(request("{}"), params("1")))).toEqual({ status: 400, body: { error: "THING_UPDATE_FAILED" } });
  });

  it.each(["null", "[]", "42", '"texte"', "true"])("refuse un corps JSON qui n'est pas un objet (%s)", async (raw) => {
    expect(await reply(await item.PUT(request(raw), params("1")))).toEqual({ status: 400, body: { error: "INVALID_BODY" } });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("itemRoutes — DELETE", () => {
  it("supprime et rend un objet vide", async () => {
    remove.mockResolvedValue();
    expect(await reply(await item.DELETE(request(""), params("7")))).toEqual({ status: 200, body: {} });
    expect(remove).toHaveBeenCalledWith(7);
  });

  it("refuse sans session, sans permission, ou sur un identifiant invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValueOnce(null);
    expect((await item.DELETE(request(""), params("7"))).status).toBe(401);
    jest.mocked(getCurrentUser).mockResolvedValueOnce(member);
    expect((await item.DELETE(request(""), params("7"))).status).toBe(403);
    expect((await item.DELETE(request(""), params("abc"))).status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
  });

  it("traduit l'erreur du service", async () => {
    remove.mockRejectedValueOnce(new Error("THING_NOT_FOUND"));
    expect(await reply(await item.DELETE(request(""), params("7")))).toEqual({ status: 404, body: { error: "THING_NOT_FOUND" } });
    remove.mockRejectedValueOnce(new Error(""));
    expect(await reply(await item.DELETE(request(""), params("7")))).toEqual({ status: 400, body: { error: "THING_DELETE_FAILED" } });
  });
});

describe("reorderRoute", () => {
  it("réordonne la liste validée", async () => {
    reorder.mockResolvedValue();
    expect(await reply(await order(request('{"ids":[3,1,2]}')))).toEqual({ status: 200, body: {} });
    expect(reorder).toHaveBeenCalledWith([3, 1, 2]);
  });

  it("refuse session, permission, corps et liste invalides avant le service", async () => {
    jest.mocked(getCurrentUser).mockResolvedValueOnce(null);
    expect((await order(request('{"ids":[1]}'))).status).toBe(401);
    jest.mocked(getCurrentUser).mockResolvedValueOnce(member);
    expect((await order(request('{"ids":[1]}'))).status).toBe(403);
    expect(await reply(await order(request("{")))).toEqual({ status: 400, body: { error: "INVALID_BODY" } });
    expect(await reply(await order(request('{"ids":[]}')))).toEqual({ status: 400, body: { error: "IDS_EMPTY" } });
    expect(reorder).not.toHaveBeenCalled();
  });

  it.each(["null", "[]", "42", '"texte"', "true"])("refuse un corps JSON qui n'est pas un objet (%s)", async (raw) => {
    expect(await reply(await order(request(raw)))).toEqual({ status: 400, body: { error: "INVALID_BODY" } });
    expect(reorder).not.toHaveBeenCalled();
  });

  it("applique le statut propre à la route, 400 par défaut, et le code de repli", async () => {
    reorder.mockRejectedValueOnce(new Error("THING_CONFLICT"));
    expect(await reply(await order(request('{"ids":[1]}')))).toEqual({ status: 409, body: { error: "THING_CONFLICT" } });
    reorder.mockRejectedValueOnce(new Error("THING_CONFLICT"));
    expect((await plainOrder(request('{"ids":[1]}'))).status).toBe(400);
    reorder.mockRejectedValueOnce(new Error(""));
    expect(await reply(await plainOrder(request('{"ids":[1]}')))).toEqual({
      status: 400,
      body: { error: "THING_REORDER_FAILED" },
    });
  });
});
