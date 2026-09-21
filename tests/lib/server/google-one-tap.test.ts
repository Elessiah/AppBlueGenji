import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { clearCache } from "@/lib/server/cache";
import { verifyGoogleOneTapCredential } from "@/lib/server/google-one-tap";

const KID = "test-key-1";

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Fabrique un `credential` One Tap valide en forme (RS256, `kid` connu), signé
 * par la clé privée de test — jamais par les vraies clés de Google, ce module
 * n'ayant besoin de vérifier que **le mécanisme**, pas un vrai jeton.
 */
function signCredential(
  privateKey: crypto.KeyObject,
  overrides: Partial<{
    iss: string;
    aud: string;
    exp: number;
    sub: string;
    name: string;
    picture: string;
    kid: string;
    alg: string;
  }> = {},
): string {
  const header = { alg: overrides.alg ?? "RS256", kid: overrides.kid ?? KID };
  const payload = {
    iss: overrides.iss ?? "https://accounts.google.com",
    aud: overrides.aud ?? "test-client-id.apps.googleusercontent.com",
    exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 3600,
    sub: overrides.sub ?? "1234567890",
    name: overrides.name ?? "Joueuse Test",
    picture: overrides.picture ?? "https://lh3.googleusercontent.com/a/photo",
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

describe("verifyGoogleOneTapCredential", () => {
  const originalEnv = { ...process.env };
  let publicKey: crypto.KeyObject;
  let privateKey: crypto.KeyObject;
  let jwk: { kty: string; n: string; e: string };

  beforeEach(() => {
    process.env = { ...originalEnv, GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com" };
    clearCache();

    const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    publicKey = pair.publicKey;
    privateKey = pair.privateKey;
    jwk = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };

    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ kid: KID, ...jwk, alg: "RS256", use: "sig" }] }), {
        status: 200,
      }) as unknown as Response,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    clearCache();
  });

  it("accepte un jeton correctement signé et rend l'identité qu'il porte", async () => {
    const credential = signCredential(privateKey, { sub: "42", name: "Nova", picture: "https://example/pic.png" });

    const identity = await verifyGoogleOneTapCredential(credential);

    expect(identity).toEqual({ sub: "42", name: "Nova", picture: "https://example/pic.png" });
  });

  it("ne relit le jeu de clés qu'une fois pour deux vérifications", async () => {
    const fetchMock = global.fetch as jest.Mock;
    await verifyGoogleOneTapCredential(signCredential(privateKey));
    await verifyGoogleOneTapCredential(signCredential(privateKey));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuse un jeton dont la signature ne correspond pas à la clé publiée", async () => {
    const otherPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const credential = signCredential(otherPair.privateKey);

    await expect(verifyGoogleOneTapCredential(credential)).rejects.toThrow("GOOGLE_ONE_TAP_INVALID");
  });

  it("refuse un `aud` différent du client configuré", async () => {
    const credential = signCredential(privateKey, { aud: "un-autre-site.apps.googleusercontent.com" });

    await expect(verifyGoogleOneTapCredential(credential)).rejects.toThrow("GOOGLE_ONE_TAP_INVALID");
  });

  it("refuse un émetteur qui n'est pas Google", async () => {
    const credential = signCredential(privateKey, { iss: "https://exemple.invalid" });

    await expect(verifyGoogleOneTapCredential(credential)).rejects.toThrow("GOOGLE_ONE_TAP_INVALID");
  });

  it("refuse un jeton expiré", async () => {
    const credential = signCredential(privateKey, { exp: Math.floor(Date.now() / 1000) - 10 });

    await expect(verifyGoogleOneTapCredential(credential)).rejects.toThrow("GOOGLE_ONE_TAP_INVALID");
  });

  it("refuse un `kid` inconnu du jeu de clés", async () => {
    const credential = signCredential(privateKey, { kid: "kid-inconnu" });

    await expect(verifyGoogleOneTapCredential(credential)).rejects.toThrow("GOOGLE_ONE_TAP_INVALID");
  });

  it("refuse un algorithme qui n'est pas RS256", async () => {
    const credential = signCredential(privateKey, { alg: "none" });

    await expect(verifyGoogleOneTapCredential(credential)).rejects.toThrow("GOOGLE_ONE_TAP_INVALID");
  });

  it("refuse un jeton malformé", async () => {
    await expect(verifyGoogleOneTapCredential("pas.un.jwt.valide")).rejects.toThrow("GOOGLE_ONE_TAP_INVALID");
    await expect(verifyGoogleOneTapCredential("deux.segments")).rejects.toThrow("GOOGLE_ONE_TAP_INVALID");
  });

  it("lève si GOOGLE_CLIENT_ID n'est pas configuré", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const credential = signCredential(privateKey);

    await expect(verifyGoogleOneTapCredential(credential)).rejects.toThrow("Missing GOOGLE_CLIENT_ID");
  });
});
