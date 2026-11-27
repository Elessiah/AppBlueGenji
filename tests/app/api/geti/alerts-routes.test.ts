import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/server/geti/alerts", () => ({
  listGetiAlerts: jest.fn(),
  createGetiAlert: jest.fn(),
  updateGetiAlert: jest.fn(),
  deleteGetiAlert: jest.fn(),
}));

import { DELETE, PATCH } from "@/app/api/geti/alerts/[id]/route";
import { GET, POST } from "@/app/api/geti/alerts/route";
import { getCurrentUser } from "@/lib/server/auth";
import { GETI_ALERT_WRITE_RULE, getiAlertRefusalStatus, parseGetiAlertId } from "@/lib/server/geti/alert-route";
import { createGetiAlert, deleteGetiAlert, listGetiAlerts, updateGetiAlert } from "@/lib/server/geti/alerts";
import { chargeRateLimit, resetRateLimit } from "@/lib/server/rate-limit";
import type { GetiAlert } from "@/lib/shared/geti/alerts";
import { authUser } from "../../../helpers/auth-user";

/** Routes `/api/geti/alerts*` : session, plafond d'écritures, codes de refus, propriété. */

const USER = authUser({ id: 42 });
const ALERT: GetiAlert = {
  id: 7,
  category: "lfp",
  name: "Tank EU",
  search: "?role=tank",
  paused: false,
  createdAt: "2026-11-27T10:00:00.000Z",
};

function jsonRequest(method: string, body: unknown, path = "/api/geti/alerts"): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.mocked(getCurrentUser).mockResolvedValue(USER);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("parseGetiAlertId", () => {
  it("parseGetiAlertId_digits_returnsTheNumber", () => {
    expect(parseGetiAlertId("12")).toBe(12);
  });

  it("parseGetiAlertId_zero_returnsNull", () => {
    expect(parseGetiAlertId("0")).toBeNull();
  });

  it("parseGetiAlertId_notDigitsOnly_returnsNull", () => {
    expect(parseGetiAlertId("12abc")).toBeNull();
  });
});

describe("getiAlertRefusalStatus", () => {
  it("getiAlertRefusalStatus_notFound_is404", () => {
    expect(getiAlertRefusalStatus("GETI_ALERT_NOT_FOUND")).toBe(404);
  });

  it("getiAlertRefusalStatus_limit_is409", () => {
    expect(getiAlertRefusalStatus("GETI_ALERT_LIMIT")).toBe(409);
  });

  it("getiAlertRefusalStatus_duplicate_is409", () => {
    expect(getiAlertRefusalStatus("GETI_ALERT_DUPLICATE")).toBe(409);
  });

  it("getiAlertRefusalStatus_invalid_is400", () => {
    expect(getiAlertRefusalStatus("GETI_ALERT_INVALID")).toBe(400);
  });
});

describe("GET /api/geti/alerts", () => {
  it("GET_withoutSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(listGetiAlerts).not.toHaveBeenCalled();
  });

  it("GET_signedIn_returns200WithOwnAlertsAndTheLimit", async () => {
    jest.mocked(listGetiAlerts).mockResolvedValue([ALERT]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alerts: [ALERT], max: 10 });
    expect(listGetiAlerts).toHaveBeenCalledWith(42);
  });

  it("GET_databaseFailure_returns503", async () => {
    jest.mocked(listGetiAlerts).mockRejectedValue(new Error("base injoignable"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "GETI_ALERT_UNAVAILABLE" });
  });
});

describe("POST /api/geti/alerts", () => {
  const body = { category: "lfp", search: "?role=tank", name: "Tank EU" };

  it("POST_withoutSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await POST(jsonRequest("POST", body));

    expect(response.status).toBe(401);
    expect(createGetiAlert).not.toHaveBeenCalled();
  });

  it("POST_validBody_returns201WithTheAlertOfTheSessionAccount", async () => {
    jest.mocked(createGetiAlert).mockResolvedValue(ALERT);

    const response = await POST(jsonRequest("POST", body));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ alert: ALERT });
    expect(createGetiAlert).toHaveBeenCalledWith(42, body);
  });

  it("POST_invalidJson_returns400", async () => {
    const response = await POST(jsonRequest("POST", "{"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "GETI_ALERT_INVALID" });
  });

  // Un refus du service part avec son code et son statut : forme, nom, plafond, doublon.
  it.each([
    ["GETI_ALERT_INVALID", 400],
    ["GETI_ALERT_NAME_TOO_LONG", 400],
    ["GETI_ALERT_LIMIT", 409],
    ["GETI_ALERT_DUPLICATE", 409],
  ])("POST_serviceRefusal%s_returnsItsStatus%i", async (code, status) => {
    jest.mocked(createGetiAlert).mockResolvedValue(code);

    const response = await POST(jsonRequest("POST", body));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it("POST_overTheWriteLimit_returns429", async () => {
    for (let attempt = 0; attempt < GETI_ALERT_WRITE_RULE.limit; attempt += 1) {
      chargeRateLimit(GETI_ALERT_WRITE_RULE, `user:${USER.id}`);
    }

    const response = await POST(jsonRequest("POST", body));

    expect(response.status).toBe(429);
    expect(createGetiAlert).not.toHaveBeenCalled();
  });

  it("POST_databaseFailure_returns503", async () => {
    jest.mocked(createGetiAlert).mockRejectedValue(new Error("base injoignable"));

    const response = await POST(jsonRequest("POST", body));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "GETI_ALERT_UNAVAILABLE" });
  });
});

describe("PATCH /api/geti/alerts/[id]", () => {
  it("PATCH_withoutSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await PATCH(jsonRequest("PATCH", { paused: true }), context("7"));

    expect(response.status).toBe(401);
    expect(updateGetiAlert).not.toHaveBeenCalled();
  });

  it("PATCH_ownAlert_returns200WithTheChangedAlert", async () => {
    jest.mocked(updateGetiAlert).mockResolvedValue({ ...ALERT, paused: true });

    const response = await PATCH(jsonRequest("PATCH", { paused: true }), context("7"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alert: { ...ALERT, paused: true } });
    expect(updateGetiAlert).toHaveBeenCalledWith(42, 7, { paused: true });
  });

  it("PATCH_idNotANumber_returns404", async () => {
    const response = await PATCH(jsonRequest("PATCH", { paused: true }), context("abc"));

    expect(response.status).toBe(404);
    expect(updateGetiAlert).not.toHaveBeenCalled();
  });

  it("PATCH_alertOfAnotherAccount_returns404", async () => {
    jest.mocked(updateGetiAlert).mockResolvedValue("GETI_ALERT_NOT_FOUND");

    const response = await PATCH(jsonRequest("PATCH", { paused: true }), context("7"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "GETI_ALERT_NOT_FOUND" });
  });

  it("PATCH_invalidPatch_returns400", async () => {
    jest.mocked(updateGetiAlert).mockResolvedValue("GETI_ALERT_INVALID");

    const response = await PATCH(jsonRequest("PATCH", {}), context("7"));

    expect(response.status).toBe(400);
  });

  it("PATCH_databaseFailure_returns503", async () => {
    jest.mocked(updateGetiAlert).mockRejectedValue(new Error("base injoignable"));

    const response = await PATCH(jsonRequest("PATCH", { paused: true }), context("7"));

    expect(response.status).toBe(503);
  });
});

describe("DELETE /api/geti/alerts/[id]", () => {
  const request = () => new Request("http://localhost/api/geti/alerts/7", { method: "DELETE" });

  it("DELETE_withoutSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await DELETE(request(), context("7"));

    expect(response.status).toBe(401);
    expect(deleteGetiAlert).not.toHaveBeenCalled();
  });

  it("DELETE_ownAlert_returns200", async () => {
    jest.mocked(deleteGetiAlert).mockResolvedValue(true);

    const response = await DELETE(request(), context("7"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(deleteGetiAlert).toHaveBeenCalledWith(42, 7);
  });

  it("DELETE_alertOfAnotherAccount_returns404", async () => {
    jest.mocked(deleteGetiAlert).mockResolvedValue(false);

    const response = await DELETE(request(), context("7"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "GETI_ALERT_NOT_FOUND" });
  });

  it("DELETE_idNotANumber_returns404", async () => {
    const response = await DELETE(request(), context("7;DROP"));

    expect(response.status).toBe(404);
    expect(deleteGetiAlert).not.toHaveBeenCalled();
  });

  it("DELETE_databaseFailure_returns503", async () => {
    jest.mocked(deleteGetiAlert).mockRejectedValue(new Error("base injoignable"));

    const response = await DELETE(request(), context("7"));

    expect(response.status).toBe(503);
  });
});
