import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/auth/google/start/route";
import { saveGoogleOAuthState } from "@/lib/server/auth";

jest.mock("@/lib/server/auth", () => ({
  saveGoogleOAuthState: jest.fn(),
}));

const saveGoogleOAuthStateMock = saveGoogleOAuthState as jest.MockedFunction<typeof saveGoogleOAuthState>;
const originalEnv = { ...process.env };

describe("GET /api/auth/google/start", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    saveGoogleOAuthStateMock.mockReset();
    jest.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.alloc(24, 1));
  });

  it("redirects to Google authorization URL when config exists", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

    const request = new NextRequest("http://localhost:3000/api/auth/google/start?redirect=%2Ftournois");
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location") || "";
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
    expect(location).toContain("client_id=client-id");
    expect(location).toContain("state=010101010101010101010101010101010101010101010101");
    expect(saveGoogleOAuthStateMock).toHaveBeenCalledWith(
      "010101010101010101010101010101010101010101010101",
      "/tournois",
    );
  });

  it("redirects back to login with a clear error when Google config is missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

    const request = new NextRequest("http://localhost:3000/api/auth/google/start?redirect=%2Ftournois");
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/connexion?error=google_not_configured");
    expect(saveGoogleOAuthStateMock).not.toHaveBeenCalled();
  });
});
