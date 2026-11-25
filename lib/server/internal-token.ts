/**
 * Jeton des appels **du bot vers le site** (`SITE_INTERNAL_TOKEN`).
 *
 * Le sens ordinaire est app → bot (`BOT_INTERNAL_TOKEN`, `bot-integration.ts`).
 * Une seule route va dans l'autre sens, `/message-tournoi`
 * (`docs/features/TOURNAMENT_STAFF_MESSAGE.md`) : elle n'a ni session ni
 * cookie, seul ce jeton l'ouvre. Un jeton distinct de celui du bot — chaque
 * sens a le sien : un secret fuité ne donne que la moitié du canal.
 *
 * Module serveur.
 */
import crypto from "node:crypto";
import type { NextResponse } from "next/server";
import { fail, type ApiError } from "@/lib/server/http";

/** En-tête porté par le bot, le même nom que dans l'autre sens. */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/** Le site n'a pas de jeton : la route est fermée, jamais ouverte sans secret. */
export const SITE_INTERNAL_TOKEN_NOT_CONFIGURED = "SITE_INTERNAL_TOKEN_NOT_CONFIGURED";

/** Jeton absent ou faux. */
export const INTERNAL_TOKEN_REFUSED = "UNAUTHORIZED";

/**
 * Comparaison en temps constant, longueur comprise : les deux côtés sont
 * réduits à leur SHA-256 (32 octets) avant `timingSafeEqual`, si bien que la
 * durée ne dit pas non plus combien de caractères le jeton reçu partage avec
 * le vrai, ni sa longueur.
 */
export function internalTokenMatches(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b) && given.length === expected.length;
}

/**
 * Longueur minimale du jeton : la route est joignable derrière nginx comme
 * toute route `/api/` ; un secret court se devinerait. `openssl rand -hex 32`
 * en donne 64 caractères (`docs/ENVIRONMENT.md`).
 */
export const SITE_INTERNAL_TOKEN_MIN_LENGTH = 32;

/** L'appel est passé par le mandataire public (nginx) : refusé, quel que soit le jeton. */
export const INTERNAL_ROUTE_LOOPBACK_ONLY = "INTERNAL_ROUTE_LOOPBACK_ONLY";

/** Adresse de boucle locale (IPv4 `127.0.0.0/8`, IPv6 `::1`, IPv4 mappée en IPv6). */
export function isLoopbackAddress(value: string): boolean {
  const address = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return address === "::1" || /^127(?:\.\d{1,3}){3}$/.test(ipv4);
}

/**
 * L'appel vient-il de la machine elle-même ? Le bot joint le site en boucle
 * locale (`http://127.0.0.1:3000`), sans mandataire. nginx, lui, pose
 * `X-Forwarded-For` sur toute requête et y **ajoute en dernier** l'adresse de
 * son client — un en-tête forgé ne peut que précéder cette entrée. Next pose
 * de lui-même l'adresse de la socket quand l'en-tête manque. Refusé, donc :
 * une dernière entrée de `X-Forwarded-For`, ou un `X-Real-IP`, qui n'est pas
 * une adresse de boucle locale. Sans aucun des deux, l'appel est direct.
 */
export function cameThroughPublicProxy(headers: Pick<Headers, "get">): boolean {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const last = forwarded.split(",").at(-1)?.trim() ?? "";
    if (!isLoopbackAddress(last)) return true;
  }
  const realIp = headers.get("x-real-ip");
  return realIp !== null && !isLoopbackAddress(realIp);
}

/**
 * Le jeton attendu, ou `null` si la route doit rester fermée : absent, plus
 * court que {@link SITE_INTERNAL_TOKEN_MIN_LENGTH}, ou égal à
 * `BOT_INTERNAL_TOKEN` — chaque sens a son secret.
 */
function expectedSiteInternalToken(): string | null {
  const expected = process.env.SITE_INTERNAL_TOKEN?.trim() ?? "";
  if (expected.length < SITE_INTERNAL_TOKEN_MIN_LENGTH) return null;
  if (expected === (process.env.BOT_INTERNAL_TOKEN?.trim() ?? "")) return null;
  return expected;
}

/**
 * Refuse un appel qui ne porte pas le jeton du site. Rend la réponse à
 * retourner telle quelle, ou `null` si l'appel peut continuer.
 *
 * - passé par nginx (`X-Forwarded-For` ou `X-Real-IP` hors boucle locale) :
 *   403, avant même de regarder le jeton — personne ne l'essaie depuis Internet ;
 * - `SITE_INTERNAL_TOKEN` absent, trop court ou égal à `BOT_INTERNAL_TOKEN` :
 *   503, la route reste fermée ;
 * - en-tête absent ou différent : 401.
 */
export function rejectWithoutSiteInternalToken(req: Request): NextResponse<ApiError> | null {
  if (cameThroughPublicProxy(req.headers)) return fail(INTERNAL_ROUTE_LOOPBACK_ONLY, 403);
  const expected = expectedSiteInternalToken();
  if (expected === null) return fail(SITE_INTERNAL_TOKEN_NOT_CONFIGURED, 503);
  const given = req.headers.get(INTERNAL_TOKEN_HEADER) ?? "";
  if (!internalTokenMatches(given, expected)) return fail(INTERNAL_TOKEN_REFUSED, 401);
  return null;
}
