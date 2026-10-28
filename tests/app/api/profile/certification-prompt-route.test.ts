import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/certification-prompt", () => ({
  recordCertificationPromptOff: jest.fn(),
}));

import { POST } from "@/app/api/profile/certification-prompt/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordCertificationPromptOff } from "@/lib/server/tournaments/certification-prompt";
import { authUser } from "../../../helpers/auth-user";

/** `POST /api/profile/certification-prompt` : « Ne plus voir » gardé sur le compte (EF-04). */

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(recordCertificationPromptOff).mockResolvedValue(undefined);
});

describe("POST /api/profile/certification-prompt", () => {
  it("garde le choix sur le compte de la session", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(recordCertificationPromptOff).toHaveBeenCalledWith(7);
  });

  it("refuse sans session, sans rien écrire", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(recordCertificationPromptOff).not.toHaveBeenCalled();
  });

  it("colonne absente (base pas encore migrée) : 503 CERTIFICATION_PROMPT_UNAVAILABLE", async () => {
    jest.mocked(recordCertificationPromptOff).mockRejectedValue(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 }));
    const response = await POST();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "CERTIFICATION_PROMPT_UNAVAILABLE" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("autre échec : 500 CERTIFICATION_PROMPT_FAILED, journalisé", async () => {
    jest.mocked(recordCertificationPromptOff).mockRejectedValue(new Error("db down"));
    const response = await POST();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "CERTIFICATION_PROMPT_FAILED" });
    expect(console.error).toHaveBeenCalled();
  });
});
