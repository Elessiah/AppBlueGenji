import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/account-locale", () => ({
  INVALID_LOCALE: "INVALID_LOCALE",
  recordAccountLocale: jest.fn(),
}));

import { PUT } from "@/app/api/profile/locale/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordAccountLocale } from "@/lib/server/users/account-locale";
import { authUser } from "../../../helpers/auth-user";

/** `PUT /api/profile/locale` : choix explicite de la langue du compte (lot 9-3). */

const put = (body: string) =>
  PUT(
    new Request("http://localhost:3000/api/profile/locale", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(recordAccountLocale).mockResolvedValue(true);
});

describe("PUT /api/profile/locale", () => {
  it("enregistre la langue choisie et la rend", async () => {
    const response = await put(JSON.stringify({ locale: "en" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: "en" });
    expect(recordAccountLocale).toHaveBeenCalledWith(7, "en");
  });

  it("refuse sans session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await put(JSON.stringify({ locale: "fr" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(recordAccountLocale).not.toHaveBeenCalled();
  });

  it.each([
    ["une langue inconnue", JSON.stringify({ locale: "de" })],
    ["une langue absente", JSON.stringify({})],
    ["une langue qui n'est pas du texte", JSON.stringify({ locale: 1 })],
    ["un préfixe d'adresse", JSON.stringify({ locale: "/en" })],
    ["une casse différente", JSON.stringify({ locale: "EN" })],
    ["une langue entourée d'espaces", JSON.stringify({ locale: " en" })],
    ["une langue en tableau", JSON.stringify({ locale: ["en"] })],
  ])("refuse %s par un code seul", async (_label, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_LOCALE" });
    expect(recordAccountLocale).not.toHaveBeenCalled();
  });

  it.each([
    ["un corps illisible", "{pas du json"],
    ["un corps nul", "null"],
  ])("refuse %s comme un corps invalide, sans le dire langue invalide", async (_label, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_BODY" });
    expect(recordAccountLocale).not.toHaveBeenCalled();
  });

  it("refuse un corps non déclaré en JSON sans le lire", async () => {
    const response = await PUT(
      new Request("http://localhost:3000/api/profile/locale", {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ locale: "en" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_BODY" });
    expect(recordAccountLocale).not.toHaveBeenCalled();
  });

  it("refuse un corps trop lourd", async () => {
    const response = await put(JSON.stringify({ locale: "en", pad: "x".repeat(40 * 1024) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_BODY" });
    expect(recordAccountLocale).not.toHaveBeenCalled();
  });

  it("dit le compte supprimé quand aucune ligne vivante n'a été touchée", async () => {
    jest.mocked(recordAccountLocale).mockResolvedValue(false);
    const response = await put(JSON.stringify({ locale: "fr" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ACCOUNT_DELETED" });
  });

  it("rend un code générique sur une panne de la base", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(recordAccountLocale).mockRejectedValue(new Error("panne"));
    const response = await put(JSON.stringify({ locale: "en" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "PROFILE_UPDATE_FAILED" });
    spy.mockRestore();
  });
});
