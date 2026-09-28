import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");

import { POST } from "@/app/api/auth/logout/route";
import { clearSession } from "@/lib/server/auth";

/**
 * La déconnexion ne lit aucun corps : seul le contrôle de provenance empêche un
 * formulaire d'un autre site de la déclencher (déconnexion forcée).
 */
const clearSessionMock = jest.mocked(clearSession);

const logout = (headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers }));

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSessionMock.mockResolvedValue(undefined);
  });

  it("déconnecte depuis le site", async () => {
    const res = await logout({ "sec-fetch-site": "same-origin" });

    expect(res.status).toBe(200);
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it("déconnecte sans corps ni `Content-Type` : le bouton n'en envoie pas", async () => {
    const res = await logout({ origin: "http://localhost:3000" });

    expect(res.status).toBe(200);
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Record<string, string>]>([
    ["un autre site", { "sec-fetch-site": "cross-site" }],
    ["un sous-domaine voisin", { "sec-fetch-site": "same-site" }],
    ["une origine étrangère", { origin: "https://attaquant.example" }],
    ["une origine opaque", { origin: "null" }],
  ])("refuse une demande venue d'%s", async (_label, headers) => {
    const res = await logout(headers);

    expect(res.status).toBe(403);
    expect(clearSessionMock).not.toHaveBeenCalled();
  });
});
