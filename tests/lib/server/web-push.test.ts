import crypto from "node:crypto";
import { describe, expect, it, jest } from "@jest/globals";
import {
  encryptPushPayload,
  generateVapidKeys,
  sendWebPush,
  vapidJwt,
  vapidKeyPair,
  webPushConfig,
  type WebPushConfig,
} from "@/lib/server/web-push";

/** Un « navigateur » : sa paire ECDH et son secret, comme `PushSubscription` les rend. */
function browser() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    },
  };
}

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));
}

/** Déchiffrement RFC 8291 écrit **indépendamment** du module, depuis la RFC. */
function decrypt(body: Buffer, ua: ReturnType<typeof browser>): string {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  expect(recordSize).toBe(4096);
  expect(idLength).toBe(65);

  const shared = ua.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ua.ecdh.getPublicKey(), asPublic]);
  const ikm = hkdf(shared, ua.auth, info, 32);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(0x02);
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

function config(): WebPushConfig {
  const keys = generateVapidKeys();
  return { publicKey: keys.publicKey, privateKey: vapidKeyPair(keys.publicKey, keys.privateKey)!, subject: "mailto:a@b.test" };
}

describe("encryptPushPayload", () => {
  it("fait l'aller-retour : seul le navigateur abonné relit le message", () => {
    const ua = browser();
    const body = encryptPushPayload(ua.subscription, JSON.stringify({ title: "Ton match commence 🎮" }));
    expect(JSON.parse(decrypt(body, ua))).toEqual({ title: "Ton match commence 🎮" });
  });

  it("tire un sel et une clé éphémère à chaque message", () => {
    const ua = browser();
    const a = encryptPushPayload(ua.subscription, "x");
    const b = encryptPushPayload(ua.subscription, "x");
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
    expect(a.subarray(21, 86).equals(b.subarray(21, 86))).toBe(false);
  });

  it("ne se déchiffre pas avec un autre secret", () => {
    const ua = browser();
    const body = encryptPushPayload(ua.subscription, "secret");
    expect(() => decrypt(body, { ...ua, auth: crypto.randomBytes(16) })).toThrow();
  });

  it("refuse un abonnement aux clés illisibles, et un message trop gros", () => {
    const ua = browser();
    expect(() => encryptPushPayload({ p256dh: "xx", auth: ua.subscription.auth }, "a")).toThrow(
      "INVALID_PUSH_SUBSCRIPTION",
    );
    expect(() => encryptPushPayload(ua.subscription, "a".repeat(5000))).toThrow("PUSH_PAYLOAD_TOO_LARGE");
  });
});

describe("VAPID", () => {
  it("signe un jeton ES256 que la clé publique vérifie, pour l'origine du service", () => {
    const cfg = config();
    const now = Date.UTC(2026, 8, 28, 12);
    const token = vapidJwt(cfg, "https://fcm.googleapis.com/fcm/send/abc", now);
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString());
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    expect(payload.sub).toBe("mailto:a@b.test");
    expect(payload.exp - now / 1000).toBeLessThanOrEqual(24 * 3600);

    const publicKey = crypto.createPublicKey(cfg.privateKey);
    const valid = crypto.verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(valid).toBe(true);
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
  });

  it("tire toujours une clé privée de 32 octets, et accepte un scalaire écrit court", () => {
    for (let i = 0; i < 600; i += 1) {
      const keys = generateVapidKeys();
      expect(Buffer.from(keys.privateKey, "base64url")).toHaveLength(32);
    }
    // Un scalaire dont l'octet de tête est nul, écrit sans lui (31 octets).
    let ecdh = crypto.createECDH("prime256v1");
    do {
      ecdh = crypto.createECDH("prime256v1");
      ecdh.generateKeys();
    } while (ecdh.getPrivateKey().length === 32);
    const short = ecdh.getPrivateKey().toString("base64url");
    expect(vapidKeyPair(ecdh.getPublicKey().toString("base64url"), short)).not.toBeNull();
  });

  it("refuse une paire dépareillée ou mal formée", () => {
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    expect(vapidKeyPair(a.publicKey, a.privateKey)).not.toBeNull();
    expect(vapidKeyPair(a.publicKey, b.privateKey)).toBeNull();
    expect(vapidKeyPair("court", a.privateKey)).toBeNull();
    expect(vapidKeyPair(a.publicKey, "court")).toBeNull();
  });
});

describe("webPushConfig", () => {
  it("est éteint sans clés", () => {
    expect(webPushConfig({})).toBeNull();
  });

  it("lit les clés, et prend APP_URL en https comme contact par défaut", () => {
    const keys = generateVapidKeys();
    const cfg = webPushConfig({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      APP_URL: "https://site.test/",
    });
    expect(cfg?.publicKey).toBe(keys.publicKey);
    expect(cfg?.subject).toBe("https://site.test");
  });

  it("s'éteint (en le disant une fois) sur une paire invalide ou sans contact", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const keys = generateVapidKeys();
    expect(webPushConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: generateVapidKeys().privateKey, VAPID_SUBJECT: "mailto:x@y.test" })).toBeNull();
    expect(webPushConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, APP_URL: "http://localhost:3000" })).toBeNull();
    expect(webPushConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "ftp://x" })).toBeNull();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    spy.mockRestore();
  });
});

describe("sendWebPush", () => {
  function fetchReturning(status: number) {
    return jest.fn<typeof fetch>(async () => new Response(null, { status }));
  }

  it("poste le message chiffré avec l'en-tête VAPID, sans suivre de redirection", async () => {
    const cfg = config();
    const ua = browser();
    const fetchImpl = fetchReturning(201);

    expect(await sendWebPush(cfg, ua.subscription, '{"a":1}', { fetchImpl, urgency: "high", ttlSeconds: 60 })).toBe("SENT");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ua.subscription.endpoint);
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=[^,]+, k=${cfg.publicKey}$`));
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe("60");
    expect(headers.Urgency).toBe("high");
    expect(init!.redirect).toBe("manual");
    expect(decrypt(Buffer.from(init!.body as Uint8Array), ua)).toBe('{"a":1}');
  });

  it.each([
    [404, "GONE"],
    [410, "GONE"],
    [429, "FAILED"],
    [500, "FAILED"],
    [301, "FAILED"],
  ] as [number, string][])("rend %s → %s", async (status, outcome) => {
    expect(await sendWebPush(config(), browser().subscription, "x", { fetchImpl: fetchReturning(status) })).toBe(outcome);
  });

  it("ne lève pas sur une panne réseau ni sur un abonnement illisible", async () => {
    const failing = jest.fn<typeof fetch>(async () => {
      throw new Error("réseau");
    });
    expect(await sendWebPush(config(), browser().subscription, "x", { fetchImpl: failing })).toBe("FAILED");
    expect(
      await sendWebPush(config(), { endpoint: "https://fcm.googleapis.com/x", p256dh: "x", auth: "y" }, "x", {
        fetchImpl: failing,
      }),
    ).toBe("FAILED");
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
