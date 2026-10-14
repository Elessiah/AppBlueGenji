import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/match-dm-preference", () => ({
  INVALID_MATCH_DM_PREFERENCE: "INVALID_MATCH_DM_PREFERENCE",
  recordMatchDmPreference: jest.fn(),
}));

import { PUT } from "@/app/api/profile/match-dms/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordMatchDmPreference } from "@/lib/server/users/match-dm-preference";
import { authUser } from "../../../helpers/auth-user";

/** `PUT /api/profile/match-dms` : opposition aux messages privés de match. */

const put = (body: string, contentType = "application/json") =>
  PUT(
    new Request("http://localhost:3000/api/profile/match-dms", {
      method: "PUT",
      headers: { "content-type": contentType },
      body,
    }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(recordMatchDmPreference).mockResolvedValue(true);
});

describe("PUT /api/profile/match-dms", () => {
  it("enregistre le choix et le rend, dans les deux sens", async () => {
    const off = await put(JSON.stringify({ enabled: false }));
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ enabled: false });
    expect(recordMatchDmPreference).toHaveBeenCalledWith(7, false);
    const on = await put(JSON.stringify({ enabled: true }));
    expect(await on.json()).toEqual({ enabled: true });
    expect(recordMatchDmPreference).toHaveBeenLastCalledWith(7, true);
  });

  it("refuse sans session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await put(JSON.stringify({ enabled: false }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(recordMatchDmPreference).not.toHaveBeenCalled();
  });

  it.each([
    ["une valeur absente", JSON.stringify({})],
    ["une chaîne", JSON.stringify({ enabled: "false" })],
    ["un nombre", JSON.stringify({ enabled: 0 })],
    ["null", JSON.stringify({ enabled: null })],
  ])("refuse %s par un code seul", async (_label, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_MATCH_DM_PREFERENCE" });
    expect(recordMatchDmPreference).not.toHaveBeenCalled();
  });

  it("refuse un corps illisible ou non déclaré en JSON comme un corps invalide", async () => {
    for (const response of [await put("{pas du json"), await put(JSON.stringify({ enabled: true }), "text/plain")]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "INVALID_BODY" });
    }
    expect(recordMatchDmPreference).not.toHaveBeenCalled();
  });

  it("dit un compte supprimé entre-temps", async () => {
    jest.mocked(recordMatchDmPreference).mockResolvedValue(false);
    const response = await put(JSON.stringify({ enabled: false }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ACCOUNT_DELETED" });
  });

  it("rend un code générique sur une erreur de base", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(recordMatchDmPreference).mockRejectedValue(new Error("boom"));
    const response = await put(JSON.stringify({ enabled: false }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "PROFILE_UPDATE_FAILED" });
  });
});
