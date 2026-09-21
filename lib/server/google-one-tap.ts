/**
 * Vérification du jeton d'identité (JWT) renvoyé par Google One Tap.
 *
 * One Tap ne suit pas l'aller-retour par code de `google-oauth.ts` : le script
 * client (`accounts.google.com/gsi/client`) rend directement au navigateur un
 * JWT signé par Google (`credential`), sans jamais passer par notre serveur —
 * il n'y a ni `code` ni échange à faire. Le site doit donc vérifier ce jeton
 * lui-même, et une vérification de JWT n'est que quatre contrôles, tous
 * obligatoires :
 *
 * 1. la **signature** (RS256, contre les clés publiques que Google publie) ;
 * 2. l'**émetteur** (`iss`) ;
 * 3. le **destinataire** (`aud`, comparé à `GOOGLE_CLIENT_ID`) — c'est lui qui
 *    empêche un jeton émis pour un autre site Google d'ouvrir une session ici,
 *    exactement ce qu'un `client_id` d'OAuth classique empêche déjà à
 *    l'échange du code ;
 * 4. l'**expiration** (`exp`).
 *
 * Node vérifie nativement une signature RSA depuis une clé publique au format
 * JWK (`crypto.createPublicKey({ format: "jwk" })`) : pas de dépendance de
 * plus pour ça, dans un projet qui n'en prend déjà aucune pour parler à
 * Google (voir `google-oauth.ts`, en `fetch` brut).
 *
 * Les clés sont publiées en JWKS et **tournent sans préavis** — les épingler
 * par `kid` casserait la connexion au premier renouvellement côté Google. On
 * les relit donc à chaque jeton dont le `kid` est inconnu, mais au plus une
 * fois par heure et **une seule fois à la fois** (`cached`, vol unique) : cent
 * connexions simultanées sur un jeu de clés froid ne déclenchent qu'un seul
 * appel sortant, pas cent.
 */
import crypto from "node:crypto";
import { cached } from "@/lib/server/cache";
import type { GoogleUserInfo } from "@/lib/server/google-oauth";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_CACHE_KEY = "google-one-tap:jwks";
const JWKS_TTL_MS = 60 * 60_000;

/**
 * Les deux formes sous lesquelles Google écrit son émetteur — `google-oauth.ts`
 * ne le contrôle pas parce que l'échange de code est déjà authentifié par le
 * secret client ; ici, la signature est la **seule** preuve, donc rien n'est
 * facultatif.
 */
const VALID_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

type GoogleJwk = {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
};

type OneTapHeader = { alg?: string; kid?: string };

type OneTapPayload = {
  iss?: string;
  aud?: string;
  exp?: number;
  sub?: string;
  name?: string;
  picture?: string;
};

async function loadGoogleJwks(): Promise<GoogleJwk[]> {
  return cached(JWKS_CACHE_KEY, JWKS_TTL_MS, async () => {
    const response = await fetch(JWKS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("GOOGLE_JWKS_FETCH_FAILED");
    const json = (await response.json()) as { keys?: GoogleJwk[] };
    if (!json.keys?.length) throw new Error("GOOGLE_JWKS_EMPTY");
    return json.keys;
  });
}

function decodeBase64Url(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

function decodeJsonSegment<T>(segment: string): T {
  try {
    return JSON.parse(decodeBase64Url(segment).toString("utf8")) as T;
  } catch {
    throw new Error("GOOGLE_ONE_TAP_INVALID");
  }
}

function requireGoogleClientId(): string {
  const value = process.env.GOOGLE_CLIENT_ID;
  if (!value) throw new Error("Missing GOOGLE_CLIENT_ID");
  return value;
}

/**
 * Vérifie un `credential` One Tap et rend l'identité qu'il porte.
 *
 * Rendu dans la même forme que `fetchGoogleUser` (`GoogleUserInfo`) : les deux
 * chemins d'entrée Google — code OAuth classique et One Tap — convergent
 * ensuite vers le même `createOrGetOAuthUser`, sans qu'aucun appelant n'ait à
 * savoir lequel des deux a produit l'identité.
 *
 * @throws GOOGLE_ONE_TAP_INVALID Jeton malformé, mal signé, expiré, ou dont
 *   l'émetteur ou le destinataire ne correspond pas. Un seul motif pour tous
 *   ces cas : aucun n'appelle un geste différent du joueur, qui n'a qu'à
 *   réessayer de se connecter.
 */
export async function verifyGoogleOneTapCredential(credential: string): Promise<GoogleUserInfo> {
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("GOOGLE_ONE_TAP_INVALID");
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = decodeJsonSegment<OneTapHeader>(headerPart);
  const payload = decodeJsonSegment<OneTapPayload>(payloadPart);

  if (header.alg !== "RS256" || !header.kid) throw new Error("GOOGLE_ONE_TAP_INVALID");

  const jwks = await loadGoogleJwks();
  const jwk = jwks.find((key) => key.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) throw new Error("GOOGLE_ONE_TAP_INVALID");

  const publicKey = crypto.createPublicKey({
    key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
    format: "jwk",
  });

  const signatureValid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    publicKey,
    decodeBase64Url(signaturePart),
  );
  if (!signatureValid) throw new Error("GOOGLE_ONE_TAP_INVALID");

  if (!payload.iss || !VALID_ISSUERS.has(payload.iss)) throw new Error("GOOGLE_ONE_TAP_INVALID");
  if (payload.aud !== requireGoogleClientId()) throw new Error("GOOGLE_ONE_TAP_INVALID");
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("GOOGLE_ONE_TAP_INVALID");
  }
  if (!payload.sub) throw new Error("GOOGLE_ONE_TAP_INVALID");

  return { sub: payload.sub, name: payload.name, picture: payload.picture };
}
