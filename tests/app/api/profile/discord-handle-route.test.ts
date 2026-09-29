import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/discord-verification");

import { POST, PUT } from "@/app/api/profile/discord/handle/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  confirmDiscordHandleUpdate,
  startDiscordHandleUpdate,
} from "@/lib/server/discord-verification";
import {
  DISCORD_CODE_REQUEST_RULE,
  DISCORD_VERIFY_CONFIRM_RULE,
  DISCORD_VERIFY_TAG_RULE,
} from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { authUser } from "../../../helpers/auth-user";

/**
 * « Mettre à jour mon pseudo » (ligne « Bot Discord ») : gardes, plafonds, et
 * traduction des refus en statuts — la même que la certification, les deux
 * gestes partageant leurs refus.
 */

const USER = authUser({ id: 7 });

const call = (handler: typeof POST, method: "POST" | "PUT", body: unknown) =>
  handler(
    new Request("http://localhost:3000/api/profile/discord/handle", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const post = (body: unknown) => call(POST, "POST", body);
const put = (body: unknown) => call(PUT, "PUT", body);

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit(DISCORD_VERIFY_TAG_RULE.name);
  resetRateLimit(DISCORD_VERIFY_CONFIRM_RULE.name);
  resetRateLimit(DISCORD_CODE_REQUEST_RULE.name);
  jest.mocked(getCurrentUser).mockResolvedValue(USER);
});

describe("POST /api/profile/discord/handle", () => {
  it("refuse sans session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await post({ handle: "keryan" })).status).toBe(401);
    expect(
      (await put({ discordId: "900000000000000001", code: "123456" })).status,
    ).toBe(401);
    expect(startDiscordHandleUpdate).not.toHaveBeenCalled();
  });

  it("envoie le code et rend l'identifiant visé", async () => {
    jest.mocked(startDiscordHandleUpdate).mockResolvedValue({
      status: "CODE_SENT",
      discordId: "900000000000000001",
      expiresAt: "2026-09-20T12:10:00.000Z",
    });

    const response = await post({ handle: "keryan" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "CODE_SENT",
      discordId: "900000000000000001",
    });
    expect(startDiscordHandleUpdate).toHaveBeenCalledWith(
      7,
      "keryan",
      expect.any(Function),
    );
  });

  it("ne transmet jamais un pseudo qui n'est pas une chaîne", async () => {
    jest
      .mocked(startDiscordHandleUpdate)
      .mockRejectedValue(new Error("INVALID_DISCORD_HANDLE"));
    const response = await post({ handle: { $gt: "" } });
    expect(response.status).toBe(400);
    expect(startDiscordHandleUpdate).toHaveBeenCalledWith(
      7,
      "",
      expect.any(Function),
    );
  });

  it("rend `DISCORD_ID_MISMATCH` en 409 : un conflit d'état, pas une saisie malformée", async () => {
    jest
      .mocked(startDiscordHandleUpdate)
      .mockRejectedValue(new Error("DISCORD_ID_MISMATCH"));
    const response = await post({ handle: "quelquun" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "DISCORD_ID_MISMATCH",
    });
  });

  it("plafonne sur le compte Discord visé par le garde d'avant-envoi", async () => {
    let guard: ((discordId: string) => void) | undefined;
    jest
      .mocked(startDiscordHandleUpdate)
      .mockImplementation(async (_user, _handle, g) => {
        guard = g;
        g?.("900000000000000001");
        return {
          status: "CODE_SENT",
          discordId: "900000000000000001",
          expiresAt: "x",
        };
      });
    for (let i = 0; i < DISCORD_CODE_REQUEST_RULE.limit; i += 1) {
      expect((await post({ handle: "keryan" })).status).toBe(200);
    }
    expect(() => guard?.("900000000000000001")).toThrow(
      "TOO_MANY_CODE_REQUESTS",
    );
  });
});

describe("PUT /api/profile/discord/handle", () => {
  it("confirme et rend le pseudo retenu sur le défi", async () => {
    jest
      .mocked(confirmDiscordHandleUpdate)
      .mockResolvedValue({ tag: "keryan" });

    const response = await put({
      discordId: "900000000000000001",
      code: "123456",
      tag: "autre",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "UPDATED",
      tag: "keryan",
    });
    expect(confirmDiscordHandleUpdate).toHaveBeenCalledWith(
      7,
      "900000000000000001",
      "123456",
    );
  });

  it("refuse un code mal formé sans rien consommer", async () => {
    expect(
      (await put({ discordId: "900000000000000001", code: "12" })).status,
    ).toBe(400);
    expect((await put({ discordId: "abc", code: "123456" })).status).toBe(400);
    expect(confirmDiscordHandleUpdate).not.toHaveBeenCalled();
  });

  it("rend un code faux en 401", async () => {
    jest
      .mocked(confirmDiscordHandleUpdate)
      .mockRejectedValue(new Error("CODE_INVALID_OR_EXPIRED"));
    expect(
      (await put({ discordId: "900000000000000001", code: "000000" })).status,
    ).toBe(401);
  });

  it("ne laisse sortir qu'un code générique d'une panne sans nom", async () => {
    jest.mocked(confirmDiscordHandleUpdate).mockRejectedValue(new Error(""));
    const response = await put({
      discordId: "900000000000000001",
      code: "123456",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "DISCORD_HANDLE_UPDATE_FAILED",
    });
  });
});
