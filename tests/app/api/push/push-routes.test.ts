import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/push-subscriptions");
jest.mock("@/lib/server/web-push", () => ({ webPushConfig: jest.fn() }));

import { GET } from "@/app/api/push/route";
import { DELETE, POST } from "@/app/api/push/subscriptions/route";
import { PUT } from "@/app/api/push/topics/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  countDevices,
  deleteSubscription,
  loadDisabledTopics,
  saveDisabledTopics,
  saveSubscription,
} from "@/lib/server/push-subscriptions";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { webPushConfig, type WebPushConfig } from "@/lib/server/web-push";
import { authUser } from "../../../helpers/auth-user";

const CONFIG = { publicKey: "BPUB", privateKey: {} as WebPushConfig["privateKey"], subject: "mailto:a@b.test" };
const P256DH = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString("base64url");
const AUTH = Buffer.alloc(16, 3).toString("base64url");
const SUBSCRIPTION = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: P256DH, auth: AUTH } };

function request(method: string, body?: unknown): Request {
  return new Request("https://site.test/api/push", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(webPushConfig).mockReturnValue(CONFIG);
  jest.mocked(loadDisabledTopics).mockResolvedValue(["MATCH_REMINDER"]);
  jest.mocked(countDevices).mockResolvedValue(2);
});

describe("GET /api/push", () => {
  it("exige une session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("rend la clé publique, les sujets visibles et les réglages", async () => {
    const body = await (await GET()).json();
    expect(body.publicKey).toBe("BPUB");
    expect(body.topics).toContain("MATCH_START");
    expect(body.topics).not.toContain("REFEREE_ALERT");
    expect(body.disabledTopics).toEqual(["MATCH_REMINDER"]);
    expect(body.devices).toBe(2);
  });

  it("montre les alertes d'arbitrage à un arbitre", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7, roles: ["ARBITRE"] }));
    expect((await (await GET()).json()).topics).toContain("REFEREE_ALERT");
  });

  it("annonce un push éteint par une clé nulle, et survit à une lecture en panne", async () => {
    jest.mocked(webPushConfig).mockReturnValue(null);
    jest.mocked(loadDisabledTopics).mockRejectedValue(new Error("panne"));
    const body = await (await GET()).json();
    expect(body.publicKey).toBeNull();
    expect(body.disabledTopics).toEqual([]);
  });
});

describe("POST /api/push/subscriptions", () => {
  it("range l'abonnement de l'appareil pour le compte connecté", async () => {
    const response = await POST(request("POST", { subscription: SUBSCRIPTION }));
    expect(response.status).toBe(200);
    expect(saveSubscription).toHaveBeenCalledWith(7, {
      endpoint: SUBSCRIPTION.endpoint,
      p256dh: P256DH,
      auth: AUTH,
    });
  });

  it("refuse sans session, sans clés, et un service de push inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValueOnce(null);
    expect((await POST(request("POST", { subscription: SUBSCRIPTION }))).status).toBe(401);

    jest.mocked(webPushConfig).mockReturnValueOnce(null);
    const off = await POST(request("POST", { subscription: SUBSCRIPTION }));
    expect(off.status).toBe(503);
    expect((await off.json()).error).toBe("PUSH_NOT_CONFIGURED");

    const foreign = await POST(
      request("POST", { subscription: { ...SUBSCRIPTION, endpoint: "https://10.0.0.1/interne" } }),
    );
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error).toBe("PUSH_SERVICE_NOT_ALLOWED");

    const garbage = await POST(request("POST", "pas du json"));
    expect((await garbage.json()).error).toBe("INVALID_PUSH_SUBSCRIPTION");
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it("plafonne les écritures par compte", async () => {
    let last = 200;
    for (let i = 0; i < 31; i += 1) last = (await POST(request("POST", { subscription: SUBSCRIPTION }))).status;
    expect(last).toBe(429);
  });
});

describe("DELETE /api/push/subscriptions", () => {
  it("retire l'abonnement du compte connecté", async () => {
    expect((await DELETE(request("DELETE", { endpoint: SUBSCRIPTION.endpoint }))).status).toBe(200);
    expect(deleteSubscription).toHaveBeenCalledWith(7, SUBSCRIPTION.endpoint);
  });

  it("refuse une adresse absente ou démesurée", async () => {
    expect((await DELETE(request("DELETE", {}))).status).toBe(400);
    expect((await DELETE(request("DELETE", { endpoint: "x".repeat(3000) }))).status).toBe(400);
    expect(deleteSubscription).not.toHaveBeenCalled();
  });
});

describe("PUT /api/push/topics", () => {
  it("remplace les sujets coupés, nettoyés", async () => {
    const response = await PUT(request("PUT", { disabledTopics: ["MATCH_REMINDER", "INCONNU"] }));
    expect(await response.json()).toEqual({ disabledTopics: ["MATCH_REMINDER"] });
    expect(saveDisabledTopics).toHaveBeenCalledWith(7, ["MATCH_REMINDER"]);
  });

  it("refuse un corps qui n'est pas une liste", async () => {
    expect((await PUT(request("PUT", { disabledTopics: "MATCH_START" }))).status).toBe(400);
    expect((await PUT(request("PUT", "{"))).status).toBe(400);
    expect(saveDisabledTopics).not.toHaveBeenCalled();
  });
});
