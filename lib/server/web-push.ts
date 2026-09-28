/**
 * Protocole Web Push, écrit sur `node:crypto` — sans dépendance.
 *
 * Deux RFC, et rien d'autre :
 *
 * - **RFC 8292 (VAPID)** : chaque envoi porte un jeton ES256 signé par la clé
 *   privée du site, que le service de push vérifie contre la clé publique
 *   donnée au navigateur à l'abonnement. Il prouve que le message vient de qui
 *   a créé l'abonnement — un tiers qui volerait l'adresse d'un abonnement ne
 *   pourrait rien y envoyer.
 * - **RFC 8291 (chiffrement `aes128gcm`)** : le corps est chiffré pour le seul
 *   navigateur abonné (ECDH P-256 + HKDF + AES-128-GCM). Le service de push
 *   relaie un message qu'il ne sait pas lire.
 *
 * Pourquoi pas le paquet `web-push` : quelque 150 lignes contre une dépendance
 * et ses transitives, sur un protocole figé depuis 2017 — et un test fait
 * l'aller-retour complet (chiffrement ici, déchiffrement dans le test avec la
 * clé du « navigateur »), si bien qu'une erreur de dérivation ne passerait pas.
 *
 * Configuration : `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (base64url, générées
 * par `npm run push:keys`) et `VAPID_SUBJECT` (`mailto:` ou `https:`). Sans
 * elles, le push est simplement éteint : `webPushConfig()` rend `null`.
 */
import crypto from "node:crypto";
import { decodeBase64Url, type PushSubscriptionInput } from "@/lib/shared/push-notifications";

export type WebPushConfig = {
  /** Clé publique, point P-256 non compressé en base64url (celle du navigateur). */
  publicKey: string;
  privateKey: crypto.KeyObject;
  subject: string;
};

function toBase64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Construit la clé privée depuis les deux moitiés stockées. `null` si elles ne
 * forment pas une paire P-256 valide — une clé mal recopiée ne doit pas faire
 * lever chaque envoi, elle doit éteindre le canal (et le journal le dit).
 */
export function vapidKeyPair(publicKey: string, privateKey: string): crypto.KeyObject | null {
  const pub = decodeBase64Url(publicKey);
  const priv = decodeBase64Url(privateKey);
  if (!pub || pub.length !== 65 || pub[0] !== 0x04 || !priv || priv.length !== 32) return null;
  try {
    // `createPrivateKey` ne vérifie pas que `d` correspond à (x, y) — et la clé
    // publique qu'on en tirerait ne ferait que relire le (x, y) fourni. On la
    // **recalcule** donc depuis `d`, et on compare : une paire dépareillée
    // signerait des jetons que tous les services refuseraient.
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(priv));
    if (!ecdh.getPublicKey().equals(Buffer.from(pub))) return null;
    return crypto.createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: toBase64Url(pub.subarray(1, 33)),
        y: toBase64Url(pub.subarray(33, 65)),
        d: toBase64Url(priv),
      },
      format: "jwk",
    });
  } catch {
    return null;
  }
}

let warned = false;

/** Configuration du push, ou `null` s'il est éteint. */
export function webPushConfig(env: Readonly<Record<string, string | undefined>> = process.env): WebPushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKeyRaw = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKeyRaw) return null;
  const privateKey = vapidKeyPair(publicKey, privateKeyRaw);
  const subject = env.VAPID_SUBJECT?.trim() || defaultSubject(env);
  if (!privateKey || !subject || !/^(mailto:|https:\/\/)/.test(subject)) {
    if (!warned) {
      warned = true;
      console.error("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT invalides : notifications push éteintes.");
    }
    return null;
  }
  return { publicKey, privateKey, subject };
}

function defaultSubject(env: Readonly<Record<string, string | undefined>>): string | null {
  const appUrl = env.APP_URL?.trim();
  return appUrl && appUrl.startsWith("https://") ? appUrl.replace(/\/+$/, "") : null;
}

/** Durée de validité d'un jeton VAPID (RFC 8292 : 24 h au plus). */
const VAPID_TTL_SECONDS = 12 * 60 * 60;

/** Jeton VAPID pour un service de push donné (`aud` = son origine). */
export function vapidJwt(config: WebPushConfig, endpoint: string, now: number = Date.now()): string {
  const header = toBase64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + VAPID_TTL_SECONDS,
        sub: config.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  // ES256 en JWS : signature brute r || s (64 octets), pas le DER par défaut.
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${toBase64Url(signature)}`;
}

/** Taille d'enregistrement annoncée — un seul enregistrement, le message tient dedans. */
const RECORD_SIZE = 4096;

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));
}

/**
 * Chiffre un message pour un abonnement (RFC 8291, `aes128gcm`).
 *
 * `ephemeral` et `salt` sont injectables pour les tests ; en production ils
 * sont tirés à chaque message, et ne doivent jamais servir deux fois.
 */
export function encryptPushPayload(
  subscription: Pick<PushSubscriptionInput, "p256dh" | "auth">,
  plaintext: string,
  options: { ephemeral?: crypto.ECDH; salt?: Buffer } = {},
): Buffer {
  const uaPublic = decodeBase64Url(subscription.p256dh);
  const authSecret = decodeBase64Url(subscription.auth);
  if (!uaPublic || uaPublic.length !== 65 || !authSecret || authSecret.length !== 16) {
    throw new Error("INVALID_PUSH_SUBSCRIPTION");
  }
  const ecdh = options.ephemeral ?? crypto.createECDH("prime256v1");
  if (!options.ephemeral) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(Buffer.from(uaPublic));
  const salt = options.salt ?? crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), Buffer.from(uaPublic), asPublic]);
  const ikm = hkdf(sharedSecret, Buffer.from(authSecret), keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);

  // Délimiteur 0x02 : dernier (et unique) enregistrement, sans remplissage.
  const record = Buffer.concat([Buffer.from(plaintext, "utf8"), Buffer.from([0x02])]);
  if (record.length + 16 > RECORD_SIZE) throw new Error("PUSH_PAYLOAD_TOO_LARGE");
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/**
 * Issue d'un envoi :
 * - `SENT` : le service a pris le message ;
 * - `GONE` : l'abonnement n'existe plus (404/410) — **à supprimer**, sans quoi
 *   on écrirait à jamais à un navigateur désinstallé ;
 * - `FAILED` : refus ou panne passagère, l'abonnement est gardé.
 */
export type WebPushOutcome = "SENT" | "GONE" | "FAILED";

const PUSH_FETCH_TIMEOUT_MS = 10_000;

/** Durée de conservation par le service de push si l'appareil est éteint. */
export const DEFAULT_PUSH_TTL_SECONDS = 60 * 60;

export async function sendWebPush(
  config: WebPushConfig,
  subscription: PushSubscriptionInput,
  payload: string,
  options: { ttlSeconds?: number; urgency?: "normal" | "high"; fetchImpl?: typeof fetch } = {},
): Promise<WebPushOutcome> {
  let body: Buffer;
  try {
    body = encryptPushPayload(subscription, payload);
  } catch {
    return "FAILED";
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${vapidJwt(config, subscription.endpoint)}, k=${config.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS),
        Urgency: options.urgency ?? "normal",
      },
      body: new Uint8Array(body),
      // L'adresse a été filtrée à l'abonnement : on ne suit aucune redirection,
      // qui mènerait ailleurs que chez le service de push validé.
      redirect: "manual",
      signal: AbortSignal.timeout(PUSH_FETCH_TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 410) return "GONE";
    return response.status >= 200 && response.status < 300 ? "SENT" : "FAILED";
  } catch {
    return "FAILED";
  }
}

/** Nouvelle paire de clés VAPID, en base64url (`npm run push:keys`). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: toBase64Url(ecdh.getPublicKey()),
    privateKey: toBase64Url(ecdh.getPrivateKey()),
  };
}
