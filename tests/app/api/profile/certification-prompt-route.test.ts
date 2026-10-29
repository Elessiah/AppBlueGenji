import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/certification-prompt", () => ({
  recordCertificationPromptOff: jest.fn(),
}));

import { POST } from "@/app/api/profile/certification-prompt/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordCertificationPromptOff } from "@/lib/server/tournaments/certification-prompt";
import { CERTIFICATION_PROMPT_OFF_RULE } from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { authUser } from "../../../helpers/auth-user";

/** Le `POST` de la modale : le corps porte le compte à qui elle a été montrée. */
function postFor(body: unknown): Request {
  return new Request("http://localhost/api/profile/certification-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** `POST /api/profile/certification-prompt` : « Ne plus voir » gardé sur le compte (EF-04). */

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(recordCertificationPromptOff).mockResolvedValue(undefined);
});

describe("POST /api/profile/certification-prompt — quota (EF-23)", () => {
  it("POST_overQuota_answers429WithoutWriting", async () => {
    for (let i = 0; i < CERTIFICATION_PROMPT_OFF_RULE.limit; i += 1) {
      expect((await POST(postFor({ userId: 7 }))).status).toBe(200);
    }
    jest.mocked(recordCertificationPromptOff).mockClear();

    const response = await POST(postFor({ userId: 7 }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(recordCertificationPromptOff).not.toHaveBeenCalled();
  });

  it("POST_quotaIsPerAccount_otherAccountStillSaves", async () => {
    for (let i = 0; i <= CERTIFICATION_PROMPT_OFF_RULE.limit; i += 1) await POST(postFor({ userId: 7 }));
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 8 }));

    expect((await POST(postFor({ userId: 8 }))).status).toBe(200);
  });

  it("POST_otherAccountRefusal_doesNotSpendQuota", async () => {
    for (let i = 0; i < CERTIFICATION_PROMPT_OFF_RULE.limit; i += 1) await POST(postFor({ userId: 8 }));

    expect((await POST(postFor({ userId: 7 }))).status).toBe(200);
  });
});

describe("POST /api/profile/certification-prompt", () => {
  it("garde le choix sur le compte de la session", async () => {
    const response = await POST(postFor({ userId: 7 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(recordCertificationPromptOff).toHaveBeenCalledWith(7);
  });

  it("session changée depuis l'ouverture (autre compte) : 409 CERTIFY_PROMPT_OTHER_ACCOUNT, rien d'écrit", async () => {
    const response = await POST(postFor({ userId: 8 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "CERTIFY_PROMPT_OTHER_ACCOUNT" });
    expect(recordCertificationPromptOff).not.toHaveBeenCalled();
  });

  it.each([
    ["sans corps", ""],
    ["corps illisible", "{"],
    ["sans compte", {}],
    ["compte invalide", { userId: "7" }],
    ["compte nul", { userId: 0 }],
  ])("%s : 400 INVALID_ACTION, jamais « autre compte », rien d'écrit", async (_label, body) => {
    const response = await POST(postFor(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_ACTION" });
    expect(recordCertificationPromptOff).not.toHaveBeenCalled();
  });

  it("refuse sans session, sans rien écrire", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await POST(postFor({ userId: 7 }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(recordCertificationPromptOff).not.toHaveBeenCalled();
  });

  it("colonne absente (base pas encore migrée) : 503 CERTIFICATION_PROMPT_UNAVAILABLE", async () => {
    jest.mocked(recordCertificationPromptOff).mockRejectedValue(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 }));
    const response = await POST(postFor({ userId: 7 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "CERTIFICATION_PROMPT_UNAVAILABLE" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("autre échec : 500 CERTIFICATION_PROMPT_FAILED, journalisé", async () => {
    jest.mocked(recordCertificationPromptOff).mockRejectedValue(new Error("db down"));
    const response = await POST(postFor({ userId: 7 }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "CERTIFICATION_PROMPT_FAILED" });
    expect(console.error).toHaveBeenCalled();
  });
});
