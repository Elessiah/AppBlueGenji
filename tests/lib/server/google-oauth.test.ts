import { beforeEach, describe, expect, it } from "@jest/globals";
import { buildGoogleAuthorizationUrl, getGoogleRedirectUri } from "@/lib/server/google-oauth";

const originalEnv = { ...process.env };

describe("google-oauth helpers", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.APP_URL;
  });

  it("uses GOOGLE_REDIRECT_URI when provided", () => {
    process.env.GOOGLE_REDIRECT_URI = "https://arena.bluegenji.fr/api/auth/google/callback";

    expect(getGoogleRedirectUri()).toBe("https://arena.bluegenji.fr/api/auth/google/callback");
  });

  it("builds redirect URI from APP_URL when GOOGLE_REDIRECT_URI is missing", () => {
    process.env.APP_URL = "http://localhost:3000/";

    expect(getGoogleRedirectUri()).toBe("http://localhost:3000/api/auth/google/callback");
  });

  it("throws if redirect URI cannot be computed", () => {
    expect(() => getGoogleRedirectUri()).toThrow("Missing GOOGLE_REDIRECT_URI or APP_URL");
  });

  it("builds a valid Google authorization URL", () => {
    process.env.GOOGLE_CLIENT_ID = "client-123";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

    const url = buildGoogleAuthorizationUrl("state-token");

    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(url).toContain("client_id=client-123");
    expect(url).toContain("state=state-token");
    expect(url).toContain("scope=openid+profile+email");
  });

  it("throws when GOOGLE_CLIENT_ID is missing", () => {
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

    expect(() => buildGoogleAuthorizationUrl("state-token")).toThrow("Missing GOOGLE_CLIENT_ID");
  });
});
