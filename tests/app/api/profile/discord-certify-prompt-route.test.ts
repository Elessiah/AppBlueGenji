import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/discord-certify-prompt", () => ({
  markDiscordCertifyPromptSeen: jest.fn(),
  recordDiscordCertifyPromptOff: jest.fn(),
}));

import { POST } from "@/app/api/profile/discord/certify-prompt/route";
import { currentTokenHash, getCurrentUser } from "@/lib/server/auth";
import { markDiscordCertifyPromptSeen, recordDiscordCertifyPromptOff } from "@/lib/server/users/discord-certify-prompt";
import { middleware } from "@/middleware";
import { authUser } from "../../../helpers/auth-user";

/** `POST /api/profile/discord/certify-prompt` : « Plus tard » pour la session, « Ne plus voir » pour le compte. Ne certifie jamais. */

const HASH = "b".repeat(64);
const PATH = "/api/profile/discord/certify-prompt";

function post(body: unknown): Request {
  return new Request(`https://bluegenji.example${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(currentTokenHash).mockResolvedValue(HASH);
  jest.mocked(markDiscordCertifyPromptSeen).mockResolvedValue(undefined);
  jest.mocked(recordDiscordCertifyPromptOff).mockResolvedValue(true);
});

describe("POST /api/profile/discord/certify-prompt", () => {
  it("LATER : lève la proposition de cette session, rien sur le compte", async () => {
    const response = await POST(post({ action: "LATER" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ action: "LATER" });
    expect(markDiscordCertifyPromptSeen).toHaveBeenCalledWith(7, HASH);
    expect(recordDiscordCertifyPromptOff).not.toHaveBeenCalled();
  });

  it("NEVER : posé sur le compte, puis la session", async () => {
    const response = await POST(post({ action: "NEVER" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ action: "NEVER" });
    expect(recordDiscordCertifyPromptOff).toHaveBeenCalledWith(7);
    expect(markDiscordCertifyPromptSeen).toHaveBeenCalledWith(7, HASH);
  });

  it("sans session : 401, rien n'est écrit", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await POST(post({ action: "NEVER" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(recordDiscordCertifyPromptOff).not.toHaveBeenCalled();
    expect(markDiscordCertifyPromptSeen).not.toHaveBeenCalled();
  });

  it("action inconnue, absente ou corps illisible : 400 INVALID_ACTION", async () => {
    for (const body of [{ action: "CERTIFY" }, {}, "pas du json"]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "INVALID_ACTION" });
    }
    expect(markDiscordCertifyPromptSeen).not.toHaveBeenCalled();
  });

  it("compte supprimé entre-temps : 409 ACCOUNT_DELETED, session non touchée", async () => {
    jest.mocked(recordDiscordCertifyPromptOff).mockResolvedValue(false);
    const response = await POST(post({ action: "NEVER" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ACCOUNT_DELETED" });
    expect(markDiscordCertifyPromptSeen).not.toHaveBeenCalled();
  });

  it("colonne absente : 503 CERTIFY_PROMPT_UNAVAILABLE ; autre panne : 500, un code seulement", async () => {
    jest.mocked(markDiscordCertifyPromptSeen).mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ER_BAD_FIELD_ERROR" }));
    const missing = await POST(post({ action: "LATER" }));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "CERTIFY_PROMPT_UNAVAILABLE" });

    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(markDiscordCertifyPromptSeen).mockRejectedValueOnce(new Error("gone"));
    const failed = await POST(post({ action: "LATER" }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "CERTIFY_PROMPT_FAILED" });
    spy.mockRestore();
  });

  it("une écriture venue d'un sous-domaine voisin est refusée par le middleware (403 CROSS_SITE_REQUEST)", async () => {
    const response = middleware(
      new NextRequest(`https://bluegenji.example${PATH}`, { method: "POST", headers: { "sec-fetch-site": "same-site" } }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "CROSS_SITE_REQUEST" });
  });
});
