import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/account-identities");
jest.mock("@/lib/server/google-one-tap");

import { POST } from "@/app/api/auth/google/one-tap/route";
import { createSession } from "@/lib/server/auth";
import { createOrGetOAuthUser } from "@/lib/server/account-identities";
import { verifyGoogleOneTapCredential } from "@/lib/server/google-one-tap";
import { GOOGLE_ONE_TAP_RULE } from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";

const verifyMock = verifyGoogleOneTapCredential as jest.MockedFunction<typeof verifyGoogleOneTapCredential>;
const createUserMock = createOrGetOAuthUser as jest.MockedFunction<typeof createOrGetOAuthUser>;
const createSessionMock = createSession as jest.MockedFunction<typeof createSession>;

const CALLER_IP = "203.0.113.7";

function attempt(credential: string | undefined, ip: string | null = CALLER_IP) {
  return POST(
    new Request("http://localhost:3000/api/auth/google/one-tap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ip === null ? {} : { "x-forwarded-for": ip }),
      },
      body: JSON.stringify({ credential }),
    }),
  );
}

describe("POST /api/auth/google/one-tap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit(GOOGLE_ONE_TAP_RULE.name);
    createUserMock.mockResolvedValue(42);
    createSessionMock.mockResolvedValue(undefined);
  });

  it("refuse un corps sans `credential`", async () => {
    const res = await attempt(undefined);
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("refuse un jeton que la vérification rejette", async () => {
    verifyMock.mockRejectedValue(new Error("GOOGLE_ONE_TAP_INVALID"));

    const res = await attempt("jeton-invalide");

    expect(res.status).toBe(401);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("ouvre une session sur un jeton valide, par le même aiguillage que les trois autres portes", async () => {
    verifyMock.mockResolvedValue({ sub: "google-sub-1", name: "Nova", picture: "https://example/pic.png" });

    const res = await attempt("jeton-valide");

    expect(res.status).toBe(200);
    expect(createUserMock).toHaveBeenCalledWith(
      {
        provider: "GOOGLE",
        subject: "google-sub-1",
        handle: null,
        avatarUrl: "https://example/pic.png",
        displayName: "Nova",
      },
      { termsAccepted: false },
    );
    expect(createSessionMock).toHaveBeenCalledWith(42);
  });

  it("plafonne après la validation de forme, pas avant", async () => {
    // Un corps sans `credential` ne doit pas consommer le quota d'une IP dont
    // quelqu'un d'autre a besoin — même règle que la vérification du code Discord.
    for (let i = 0; i < GOOGLE_ONE_TAP_RULE.limit * 2; i += 1) {
      expect((await attempt(undefined)).status).toBe(400);
    }

    verifyMock.mockRejectedValue(new Error("GOOGLE_ONE_TAP_INVALID"));
    expect((await attempt("jeton")).status).toBe(401);
  });

  it("coupe court en 429 une fois le plafond par IP atteint", async () => {
    verifyMock.mockRejectedValue(new Error("GOOGLE_ONE_TAP_INVALID"));
    for (let i = 0; i < GOOGLE_ONE_TAP_RULE.limit; i += 1) {
      expect((await attempt("jeton")).status).toBe(401);
    }

    const blocked = await attempt("jeton");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("ne plafonne pas du tout quand aucune IP n'est lisible", async () => {
    verifyMock.mockRejectedValue(new Error("GOOGLE_ONE_TAP_INVALID"));
    for (let i = 0; i < GOOGLE_ONE_TAP_RULE.limit * 2; i += 1) {
      expect((await attempt("jeton", null)).status).toBe(401);
    }
  });
});
